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
  const {
    keywordDetection,
    isLoaded: porcupineLoaded,
    isListening: porcupineListening,
    error: porcupineError,
    init: porcupineInit,
    start: porcupineStart,
    stop: porcupineStop,
    release: porcupineRelease,
  } = usePorcupine();

  const vadRef = useRef<MicVAD | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stageRef = useRef<Stage>("idle");
  const porcupineReady = useRef(false);

  const rockyStatus = useRockyStore((s) => s.status);
  const isListening = useRockyStore((s) => s.isListening);

  // ── Porcupine one-time init ───────────────────────────────────────────────
  useEffect(() => {
    if (!PICOVOICE_KEY || porcupineReady.current) return;

    porcupineInit(
      PICOVOICE_KEY,
      [{ publicPath: "/wakeword/hey_rocky.ppn", label: "Hey Rocky", sensitivity: 0.65 }],
      { publicPath: "/wakeword/porcupine_params.pv" },
    )
      .then(() => {
        porcupineReady.current = true;
        console.log(`${LOG_TAG} Porcupine ready.`);
      })
      .catch((err: Error) => console.error(`${LOG_TAG} Porcupine init failed:`, err.message));

    return () => { porcupineRelease().catch(() => {}); };
  }, [porcupineInit, porcupineRelease]);

  // ── VAD + mic stream teardown ────────────────────────────────────────────
  const releaseVAD = useCallback(() => {
    vadRef.current?.pause();
    vadRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  // ── Stage 2: opened after keyword, monitors for end of user utterance ────
  //
  // The VAD reuses the DSP mic stream that's already been handed to WebRTC.
  // Echo-cancellation in MIC_CONSTRAINTS prevents Rocky's TTS from triggering
  // a false speech-end, so Porcupine can safely restart before TTS is done.
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
          // Restart keyword listening immediately. The mic stream we held is now
          // gone, so Porcupine can reclaim the hardware without contention.
          if (PICOVOICE_KEY && porcupineReady.current && !porcupineListening) {
            porcupineStart().catch(console.error);
          }
        },
        onVADMisfire: () => console.log(`${LOG_TAG} VAD misfire discarded.`),
      });

      await vadRef.current.start();
      console.log(`${LOG_TAG} Speech stage active (Silero VAD + WebRTC open).`);
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
          console.log(`${LOG_TAG} [Fallback] Speech detected — activating pipeline.`);
          eventBus.emit(RockyEvents.VAD_SPEECH_START, stream);
        },
        onSpeechEnd: () => {
          console.log(`${LOG_TAG} [Fallback] Speech ended.`);
          eventBus.emit(RockyEvents.VAD_SPEECH_STOP);
        },
        onVADMisfire: () => console.log(`${LOG_TAG} [Fallback] VAD misfire discarded.`),
      });

      await vadRef.current.start();
      console.log(`${LOG_TAG} [Fallback] VAD-only mode active (set VITE_PICOVOICE_ACCESS_KEY to enable wake word).`);
    } catch (err: any) {
      console.error(`${LOG_TAG} [Fallback] VAD init failed:`, err.message);
      stageRef.current = "idle";
    }
  }, []);

  // ── Porcupine keyword detection → hand off to speech stage ──────────────
  useEffect(() => {
    if (!keywordDetection || stageRef.current !== "keyword") return;
    console.log(`${LOG_TAG} "Hey Rocky" detected — activating speech stage.`);
    stageRef.current = "speech";
    porcupineStop().then(activateSpeechStage).catch(console.error);
  }, [keywordDetection, porcupineStop, activateSpeechStage]);

  // ── Start / stop based on global listening toggle and Rocky idle state ───
  useEffect(() => {
    if (!isListening) {
      if (stageRef.current !== "idle") {
        porcupineStop().catch(() => {});
        releaseVAD();
        stageRef.current = "idle";
        console.log(`${LOG_TAG} Listening disabled — idle.`);
      }
      return;
    }

    // Only (re)start from a clean idle state; other transitions are self-managed
    if (rockyStatus !== "idle" || stageRef.current !== "idle") return;

    if (PICOVOICE_KEY) {
      if (!porcupineLoaded) return; // wait for WASM model
      stageRef.current = "keyword";
      porcupineStart()
        .then(() => console.log(`${LOG_TAG} Keyword listening started.`))
        .catch(console.error);
    } else {
      startFallbackVAD();
    }
  }, [rockyStatus, isListening, porcupineLoaded, porcupineStart, porcupineStop, releaseVAD, startFallbackVAD]);

  useEffect(() => {
    if (porcupineError) console.error(`${LOG_TAG} Porcupine error:`, porcupineError);
  }, [porcupineError]);

  useEffect(() => {
    return () => {
      porcupineStop().catch(() => {});
      porcupineRelease().catch(() => {});
      releaseVAD();
    };
  }, [porcupineStop, porcupineRelease, releaseVAD]);

  return {
    stage: stageRef.current,
    isWakeWordReady: PICOVOICE_KEY ? porcupineLoaded : true,
  };
}
