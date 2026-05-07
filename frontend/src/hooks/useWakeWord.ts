import { useEffect, useRef, useCallback } from "react";
import { MicVAD } from "@ricky0123/vad-web";
import { eventBus, RockyEvents } from "../lib/eventBus";
import { useRockyStore } from "../store/useRockyStore";

const LOG_TAG = "[EdgeVAD]";

const DSP_AUDIO_CONSTRAINTS = {
  channelCount: 1,
  echoCancellation: { exact: true } as ConstrainBoolean,
  noiseSuppression: { exact: true } as ConstrainBoolean,
  autoGainControl: { exact: true } as ConstrainBoolean,
  sampleRate: 16000,
};

async function openMicWithDSP(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: DSP_AUDIO_CONSTRAINTS });
}

/**
 * useWakeWord — Edge VAD Edition
 *
 * Runs Silero VAD (WASM) locally on the mic stream. The microphone stays
 * active while isListening=true, but VAD_SPEECH_START is only emitted when
 * the model detects human speech with probability > 0.9, gating the backend
 * pipeline from receiving audio during silence or noise.
 */
export function useWakeWord() {
  const vadRef = useRef<MicVAD | null>(null);
  const isActiveRef = useRef(false);
  const vadStreamRef = useRef<MediaStream | null>(null);

  const status = useRockyStore((s) => s.status);
  const isListeningGlobal = useRockyStore((s) => s.isListening);

  const stopVAD = useCallback(() => {
    if (!isActiveRef.current) return;
    vadRef.current?.pause();
    isActiveRef.current = false;
    console.log(`${LOG_TAG} Paused.`);
  }, []);

  const startVAD = useCallback(async () => {
    if (isActiveRef.current) return;

    try {
      if (!vadRef.current) {
        vadRef.current = await MicVAD.new({
          baseAssetPath: "/vad/",
          onnxWASMBasePath: "/vad/",
          model: "legacy",
          positiveSpeechThreshold: 0.9,
          negativeSpeechThreshold: 0.5,
          minSpeechMs: 300,
          preSpeechPadMs: 100,
          redemptionMs: 750,

          getStream: async () => {
            const stream = await openMicWithDSP();
            vadStreamRef.current = stream;
            return stream;
          },
          resumeStream: async () => {
            const stream = await openMicWithDSP();
            vadStreamRef.current = stream;
            return stream;
          },

          ortConfig: (ort: any) => {
            ort.env.logLevel = "error";
            ort.env.wasm.numThreads = 1;
          },

          onSpeechStart: () => {
            const { status, isListening } = useRockyStore.getState();
            if (status !== "idle" || !isListening) return;

            const stream = vadStreamRef.current;
            if (!stream?.active) return;

            console.log(`${LOG_TAG} Speech detected (p > 0.9) — activating pipeline.`);
            eventBus.emit(RockyEvents.VAD_SPEECH_START, stream);
          },

          onSpeechEnd: (_audio: Float32Array) => {
            console.log(`${LOG_TAG} Speech ended — stopping pipeline.`);
            eventBus.emit(RockyEvents.VAD_SPEECH_STOP);
          },

          onVADMisfire: () => {
            console.log(`${LOG_TAG} Misfire discarded (below minSpeechFrames).`);
          },
        });
      }

      await vadRef.current.start();
      isActiveRef.current = true;
      console.log(`${LOG_TAG} Active.`);
    } catch (err: any) {
      console.error(`${LOG_TAG} Init failed:`, err.message);
      isActiveRef.current = false;
    }
  }, []);

  // Start VAD when idle+listening. Don't stop it during pipeline operation
  // (status = listening/processing/speaking) — the mic must stay alive for WebRTC.
  // Only pause when isListening goes false.
  useEffect(() => {
    if (!isListeningGlobal) {
      stopVAD();
    } else if (status === "idle") {
      startVAD();
    }
  }, [status, isListeningGlobal, startVAD, stopVAD]);

  useEffect(() => {
    return () => {
      vadRef.current?.destroy();
      vadRef.current = null;
      isActiveRef.current = false;
    };
  }, []);

  return {
    isActive: isActiveRef.current,
    start: startVAD,
    stop: stopVAD,
  };
}
