import { useEffect, useRef, useCallback } from "react";
import { usePorcupine } from "@picovoice/porcupine-react";
import { MicVAD } from "@ricky0123/vad-web";
import { eventBus, RockyEvents } from "../lib/eventBus";
import { useRockyStore } from "../store/useRockyStore";

const LOG_TAG = "[WakeWord]";

/**
 * Wake-word model files — place in frontend/public/wakeword/
 *   hey_rocky.ppn       → generate at https://console.picovoice.ai/ (free tier)
 *   porcupine_params.pv → download from the Picovoice SDK for your language
 *
 * Set VITE_PICOVOICE_ACCESS_KEY in .env to activate the keyword stage.
 * Without it the hook falls back to VAD-only mode (any speech triggers the pipeline).
 */
const PICOVOICE_KEY = import.meta.env.VITE_PICOVOICE_ACCESS_KEY as string | undefined;

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: { exact: true } as ConstrainBoolean,
    noiseSuppression: { exact: true } as ConstrainBoolean,
    autoGainControl: { exact: true } as ConstrainBoolean,
    sampleRate: 16000,
  },
};

// "idle"    — nothing running
// "keyword" — Porcupine listening for "Hey Rocky" (or fallback VAD active)
// "speech"  — user utterance captured, WebRTC open, Silero VAD watching for end
type Stage = "idle" | "keyword" | "speech";

export function useWakeWord() {
  const [error, setError] = useState<string | null>(null);
  const isInitializing = useRef(false);
  const porcupineReady = useRef(false);

  const {
    keywordDetection,
    isLoaded: porcupineLoaded,
    isListening: porcupineListening,
    error: porcupineHookError,
    init: porcupineInit,
    start: porcupineStart,
    stop: porcupineStop,
    release: porcupineRelease,
  } = usePorcupine();

  const vadRef = useRef<MicVAD | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stageRef = useRef<Stage>("idle");

  const rockyStatus = useRockyStore((s) => s.status);
  const isListening = useRockyStore((s) => s.isListening);

  // ── Porcupine one-time init ───────────────────────────────────────────────
  useEffect(() => {
    if (!PICOVOICE_KEY || porcupineReady.current || isInitializing.current) return;

    const initialize = async () => {
      isInitializing.current = true;
      try {
        console.log(`${LOG_TAG} Initializing Porcupine...`);
        await porcupineInit(
          PICOVOICE_KEY,
          [{ publicPath: "/wakeword/hey_rocky.ppn", label: "Hey Rocky", sensitivity: 0.65 }],
          { publicPath: "/wakeword/porcupine_params.pv" },
        );
        porcupineReady.current = true;
        setError(null);
        console.log(`${LOG_TAG} Porcupine ready.`);
      } catch (err: any) {
        const msg = err.message || "Unknown Porcupine error";
        console.error(`${LOG_TAG} Porcupine init failed:`, msg);
        setError(`Porcupine Error: ${msg}`);
      } finally {
        isInitializing.current = false;
      }
    };

    initialize();

    // No release here — we manage it in the global cleanup to avoid race conditions 
    // when this effect might re-run due to dependency changes.
  }, [porcupineInit]);

  // ── VAD + mic stream teardown ────────────────────────────────────────────
  const releaseVAD = useCallback(() => {
    vadRef.current?.pause();
    vadRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // ── Stage 2: opened after keyword, monitors for end of user utterance ────
  const activateSpeechStage = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      streamRef.current = stream;

      eventBus.emit(RockyEvents.VAD_SPEECH_START, stream);

      vadRef.current = await MicVAD.new({
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        model: "legacy",
        positiveSpeechThreshold: 0.9,
        negativeSpeechThreshold: 0.5,
        minSpeechMs: 300,
        preSpeechPadMs: 100,
        redemptionMs: 750,
        getStream: async () => stream,
        resumeStream: async () => stream,
        ortConfig: (ort: any) => {
          ort.env.logLevel = "error";
          ort.env.wasm.numThreads = 1;
        },
        onSpeechEnd: () => {
          if (stageRef.current !== "speech") return;
          console.log(`${LOG_TAG} Utterance complete — closing pipeline.`);
          eventBus.emit(RockyEvents.VAD_SPEECH_STOP);
          stageRef.current = "keyword";
          releaseVAD();
          
          if (PICOVOICE_KEY && porcupineReady.current && !porcupineListening) {
            porcupineStart().catch(err => {
              console.error(`${LOG_TAG} Failed to restart Porcupine:`, err.message);
            });
          }
        },
        onVADMisfire: () => console.log(`${LOG_TAG} VAD misfire discarded.`),
      });

      await vadRef.current.start();
      console.log(`${LOG_TAG} Speech stage active.`);
    } catch (err: any) {
      console.error(`${LOG_TAG} Speech stage failed:`, err.message);
      stageRef.current = "keyword";
      if (PICOVOICE_KEY && porcupineReady.current) {
        porcupineStart().catch(() => {});
      }
    }
  }, [releaseVAD, porcupineStart, porcupineListening]);

  // ── Fallback: Silero VAD only (no Picovoice key configured) ─────────────
  const startFallbackVAD = useCallback(async () => {
    if (stageRef.current !== "idle") return;
    stageRef.current = "keyword";

    try {
      vadRef.current = await MicVAD.new({
        baseAssetPath: "/vad/",
        onnxWASMBasePath: "/vad/",
        model: "legacy",
        positiveSpeechThreshold: 0.9,
        negativeSpeechThreshold: 0.5,
        minSpeechMs: 300,
        preSpeechPadMs: 100,
        redemptionMs: 750,
        ortConfig: (ort: any) => {
          ort.env.logLevel = "error";
          ort.env.wasm.numThreads = 1;
        },
        getStream: async () => {
          const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
          streamRef.current = stream;
          return stream;
        },
        resumeStream: async () => {
          const stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
          streamRef.current = stream;
          return stream;
        },
        onSpeechStart: () => {
          const { status, isListening: listening } = useRockyStore.getState();
          if (status !== "idle" || !listening) return;
          const stream = streamRef.current;
          if (!stream?.active) return;
          console.log(`${LOG_TAG} [Fallback] Speech detected.`);
          eventBus.emit(RockyEvents.VAD_SPEECH_START, stream);
        },
        onSpeechEnd: () => {
          console.log(`${LOG_TAG} [Fallback] Speech ended.`);
          eventBus.emit(RockyEvents.VAD_SPEECH_STOP);
        },
        onVADMisfire: () => console.log(`${LOG_TAG} [Fallback] VAD misfire discarded.`),
      });

      await vadRef.current.start();
      console.log(`${LOG_TAG} [Fallback] VAD active.`);
    } catch (err: any) {
      console.error(`${LOG_TAG} [Fallback] VAD init failed:`, err.message);
      stageRef.current = "idle";
      setError(`VAD Error: ${err.message}`);
    }
  }, []);

  // ── Porcupine keyword detection → hand off to speech stage ──────────────
  useEffect(() => {
    if (!keywordDetection || stageRef.current !== "keyword") return;
    console.log(`${LOG_TAG} Wake word detected.`);
    stageRef.current = "speech";
    porcupineStop().then(activateSpeechStage).catch(err => {
      console.error(`${LOG_TAG} Error stopping Porcupine:`, err.message);
      activateSpeechStage(); // Try to move to speech stage anyway
    });
  }, [keywordDetection, porcupineStop, activateSpeechStage]);

  // ── Start / stop based on global listening toggle and Rocky idle state ───
  useEffect(() => {
    if (!isListening) {
      if (stageRef.current !== "idle") {
        if (porcupineReady.current && porcupineListening) {
          porcupineStop().catch(() => {});
        }
        releaseVAD();
        stageRef.current = "idle";
        console.log(`${LOG_TAG} Listening disabled.`);
      }
      return;
    }

    if (rockyStatus !== "idle" || stageRef.current !== "idle") return;

    if (PICOVOICE_KEY) {
      if (!porcupineLoaded || !porcupineReady.current) return; 
      stageRef.current = "keyword";
      porcupineStart()
        .then(() => console.log(`${LOG_TAG} Keyword listening started.`))
        .catch(err => {
          console.error(`${LOG_TAG} Keyword listening failed to start:`, err.message);
          stageRef.current = "idle";
          setError(`Porcupine Start Failed: ${err.message}`);
        });
    } else {
      startFallbackVAD();
    }
  }, [rockyStatus, isListening, porcupineLoaded, porcupineStart, porcupineStop, releaseVAD, startFallbackVAD, porcupineListening]);

  useEffect(() => {
    if (porcupineHookError) {
      console.error(`${LOG_TAG} Porcupine hook error:`, porcupineHookError);
      setError(`Porcupine Hook: ${porcupineHookError.message || porcupineHookError}`);
    }
  }, [porcupineHookError]);

  // Global Cleanup
  useEffect(() => {
    return () => {
      console.log(`${LOG_TAG} Cleaning up...`);
      const cleanup = async () => {
        try {
          if (porcupineReady.current) {
            await porcupineStop().catch(() => {});
            await porcupineRelease().catch(() => {});
            porcupineReady.current = false;
          }
        } catch (e) {
          // ignore
        }
        releaseVAD();
      };
      cleanup();
    };
  }, [porcupineStop, porcupineRelease, releaseVAD]);

  return {
    stage: stageRef.current,
    isWakeWordReady: PICOVOICE_KEY ? porcupineReady.current : true,
    error,
  };
}
