import { useEffect, useRef, useState, useCallback } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import { eventBus, RockyEvents } from "../lib/eventBus";
import { useRockyStore } from "../store/useRockyStore";
import { MIC_CONSTRAINTS } from "../lib/audioConstants";

const LOG_TAG = "[WakeWord]";

// Audio sent to the voice engine: 16kHz int16, 1280 samples per chunk (80ms)
const TARGET_SAMPLE_RATE = 16000;
const OWW_CHUNK = 1280;

const RAW_ENGINE_URL = import.meta.env['VITE_VOICE_ENGINE_URL'] as string | undefined;
const WAKEWORD_WS_URL = RAW_ENGINE_URL
  ? RAW_ENGINE_URL.replace(/^http/, "ws").replace(/\/+$/, "") + "/ws/wakeword"
  : null;

// "idle"    — nothing running
// "keyword" — mic → voice engine WebSocket → OpenWakeWord (or fallback VAD)
// "speech"  — utterance captured, WebRTC open, Silero VAD watching for end
type Stage = "idle" | "keyword" | "speech";

export function useWakeWord({ getStream }: { getStream: () => Promise<MediaStream> }) {
  const [error, setError] = useState<string | null>(null);
  const [isWakeWordReady, setIsWakeWordReady] = useState(false);

  // Keyword-stage resources
  const wsRef = useRef<WebSocket | null>(null);
  const kwAudioCtxRef = useRef<AudioContext | null>(null);
  const kwMicRef = useRef<MediaStream | null>(null);
  const kwProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const kwSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Speech-stage resources (Silero VAD end-of-utterance)
  const vadRef = useRef<MicVAD | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stageRef = useRef<Stage>("idle");

  // Ref used by activateSpeechStage to restart keyword detection after
  // speech ends, without creating a circular useCallback dependency.
  const startKWRef = useRef<(() => void) | null>(null);

  const rockyStatus = useRockyStore((s) => s.status);
  const isListening = useRockyStore((s) => s.isListening);

  // ── Keyword stage teardown ────────────────────────────────────────────────
  const stopKeywordDetection = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    // Disconnect nodes before closing context to prevent CPU leak
    kwProcessorRef.current?.disconnect();
    kwProcessorRef.current = null;
    kwSourceRef.current?.disconnect();
    kwSourceRef.current = null;
    void kwAudioCtxRef.current?.close().catch(() => {});
    kwAudioCtxRef.current = null;
    // Task 1: Do NOT stop tracks here to allow reuse in manual session
    kwMicRef.current = null;
  }, []);

  // ── Speech stage teardown ─────────────────────────────────────────────────
  const releaseVAD = useCallback(() => {
    vadRef.current?.pause();
    vadRef.current = null;
    // Task 1: Do NOT stop tracks here to allow reuse in manual session
    streamRef.current = null;
  }, []);

  // ── Speech stage: Silero VAD for end-of-utterance ────────────────────────
  const activateSpeechStage = useCallback(async () => {
    try {
      const stream = await getStream();
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
          stageRef.current = "idle";
          releaseVAD();
          startKWRef.current?.();
        },
        onVADMisfire: () => console.log(`${LOG_TAG} VAD misfire discarded.`),
      });

      await vadRef.current.start();
      console.log(`${LOG_TAG} Speech stage active.`);
    } catch (err: any) {
      console.error(`${LOG_TAG} Speech stage failed:`, err.message);
      stageRef.current = "idle";
    }
  }, [releaseVAD]);

  // ── Fallback keyword stage: any speech triggers the pipeline ─────────────
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
          const stream = await getStream();
          streamRef.current = stream;
          return stream;
        },
        resumeStream: async () => {
          const stream = await getStream();
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
      console.log(`${LOG_TAG} [Fallback] VAD active (no wake word model).`);
    } catch (err: any) {
      console.error(`${LOG_TAG} [Fallback] VAD error:`, err.message);
      stageRef.current = "idle";
      setError(`VAD Error: ${err.message}`);
    }
  }, []);

  // ── Keyword stage: mic → 16kHz PCM → voice engine → OpenWakeWord ─────────
  const startKeywordDetection = useCallback(async () => {
    if (stageRef.current !== "idle") return;

    if (!WAKEWORD_WS_URL) {
      console.log(`${LOG_TAG} VITE_VOICE_ENGINE_URL not set — using VAD-only fallback.`);
      await startFallbackVAD();
      return;
    }

    stageRef.current = "keyword";

    try {
      const stream = await getStream();
      kwMicRef.current = stream;

      const ws = new WebSocket(WAKEWORD_WS_URL);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onerror = () => {
        console.warn(`${LOG_TAG} Voice engine unreachable — switching to VAD fallback.`);
        if (stageRef.current === "keyword") {
          stopKeywordDetection();
          stageRef.current = "idle";
          void startFallbackVAD();
        }
      };

      ws.onclose = (evt) => {
        if (!evt.wasClean && stageRef.current === "keyword") {
          console.warn(`${LOG_TAG} WS closed unexpectedly, falling back to VAD.`);
          stageRef.current = "idle";
          stopKeywordDetection();
          void startFallbackVAD();
        }
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as { detected: boolean; model: string; score: number };
          if (msg.detected) {
            console.log(`${LOG_TAG} Wake word: "${msg.model}" (score ${msg.score})`);
            stageRef.current = "speech";
            stopKeywordDetection();
            void activateSpeechStage();
          }
        } catch {
          // ignore malformed messages
        }
      };

      // Audio capture: mic → downsample to 16kHz → int16 chunks → WebSocket
      const audioCtx = new AudioContext();
      kwAudioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      kwSourceRef.current = source;
      const resampleRatio = audioCtx.sampleRate / TARGET_SAMPLE_RATE;

      let pending = new Int16Array(0);

      // ScriptProcessorNode is deprecated but still universally supported.
      // A future migration to AudioWorklet would require a separate worklet file.
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      kwProcessorRef.current = processor;
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        const outLen = Math.floor(float32.length / resampleRatio);
        const downsampled = new Int16Array(outLen);
        // Linear interpolation to avoid aliasing artifacts when downsampling
        for (let i = 0; i < outLen; i++) {
          const pos = i * resampleRatio;
          const idx = Math.floor(pos);
          const frac = pos - idx;
          const a = float32[idx] ?? 0;
          const b = float32[idx + 1] ?? a;
          const s = a + frac * (b - a);
          downsampled[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
        }

        const merged = new Int16Array(pending.length + outLen);
        merged.set(pending);
        merged.set(downsampled, pending.length);
        pending = merged;

        while (pending.length >= OWW_CHUNK) {
          ws.send(pending.slice(0, OWW_CHUNK).buffer);
          pending = pending.slice(OWW_CHUNK);
        }
      };

      // Connect source → processor only; do NOT connect processor → destination
      // to avoid routing the microphone to the speakers (feedback loop).
      source.connect(processor);

      setIsWakeWordReady(true);
      console.log(`${LOG_TAG} Keyword detection active → ${WAKEWORD_WS_URL}`);
    } catch (err: any) {
      console.error(`${LOG_TAG} Keyword detection failed:`, err.message);
      stageRef.current = "idle";
      setIsWakeWordReady(false);
      setError(`Wake word error: ${err.message}`);
    }
  }, [stopKeywordDetection, activateSpeechStage, startFallbackVAD]);

  // Keep ref current to break speech → keyword circular dependency
  useEffect(() => {
    startKWRef.current = startKeywordDetection;
  }, [startKeywordDetection]);

  // ── Start / stop based on global listening toggle and Rocky idle state ────
  useEffect(() => {
    if (!isListening) {
      if (stageRef.current !== "idle") {
        stopKeywordDetection();
        releaseVAD();
        stageRef.current = "idle";
        setIsWakeWordReady(false);
        console.log(`${LOG_TAG} Listening disabled.`);
      }
      return;
    }

    if (rockyStatus !== "idle" || stageRef.current !== "idle") return;
    void startKeywordDetection();
  }, [rockyStatus, isListening, startKeywordDetection, stopKeywordDetection, releaseVAD]);

  // Global cleanup on unmount
  useEffect(() => {
    return () => {
      stopKeywordDetection();
      releaseVAD();
    };
  }, [stopKeywordDetection, releaseVAD]);

  // Called by the manual mic button before it opens its own stream, so that
  // the wake word mic is released first and the two streams don't compete.
  const pauseForManualSession = useCallback(() => {
    if (stageRef.current !== "idle") {
      stopKeywordDetection();
      releaseVAD();
      stageRef.current = "idle";
      console.log(`${LOG_TAG} Paused for manual session.`);
    }
  }, [stopKeywordDetection, releaseVAD]);

  return {
    stage: stageRef.current,
    isWakeWordReady,
    error,
    pauseForManualSession,
  };
}
