import { useEffect, useRef, useState, useCallback } from "react";
import { eventBus, RockyEvents } from "../lib/eventBus";

interface CustomSocket {
  on: (event: string, handler: (data: any) => void) => void;
  off: (event: string, handler: (data: any) => void) => void;
  emit: (event: string, data?: any, callback?: any) => void;
  connected: boolean;
  id?: string;
}

type AudioState = "idle" | "requesting_mic" | "listening" | "processing" | "speaking" | "error";

interface AudioManagerOptions {
  socket: CustomSocket;
  addToast: (msg: string, type: "info" | "error" | "warning") => void;
  startWebRTC?: (micStream: MediaStream) => Promise<void>;
}

const LOG_TAG = "[AudioManager]";

function log(level: "info" | "warn" | "error", msg: string, data?: any) {
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} ${LOG_TAG} [${level.toUpperCase()}]`;
  if (level === "error") {
    console.error(`${prefix} ${msg}`, data || "");
  } else if (level === "warn") {
    console.warn(`${prefix} ${msg}`, data || "");
  } else {
    console.log(`${prefix} ${msg}`, data || "");
  }
}

/**
 * useAudioManager - 2026 Edition
 * Handles microphone permissions, local VAD, and provides the mic stream
 * to the AudioPipeline for WebRTC transmission.
 */
export function useAudioManager({ socket, addToast, startWebRTC }: AudioManagerOptions) {
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [micAvailable, setMicAvailable] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const [analyzer, setAnalyzer] = useState<AnalyserNode | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isCapturingRef = useRef(false);

  useEffect(() => {
    log("info", "Initializing AudioManager...");

    const initAudioContext = async () => {
      try {
        if (audioCtxRef.current) return;
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new Ctx();
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 256;

        audioCtxRef.current = audioCtx;
        analyzerRef.current = analyzer;
        setAnalyzer(analyzer);
        setMicAvailable(true);
      } catch (err: any) {
        log("error", "Failed to initialize AudioContext", err.message);
        addToast("Audio system unavailable", "error");
        setAudioState("error");
      }
    };

    const isSecure = typeof window !== "undefined" &&
      (window.location.protocol === "https:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

    if (!isSecure) {
      addToast("Microphone requires HTTPS or localhost", "warning");
      setAudioState("error");
    } else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
       addToast("Browser mic access not supported", "error");
       setAudioState("error");
    } else {
      initAudioContext();
    }
  }, [addToast]);

  const DSP_CONSTRAINTS: MediaTrackConstraints = {
    echoCancellation: { exact: true },
    noiseSuppression: { exact: true },
    autoGainControl: { exact: true },
    sampleRate: 16000,
  };

  const requestMicrophone = useCallback(async (): Promise<MediaStream | null> => {
    log("info", "Requesting microphone access...");
    setAudioState("requesting_mic");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: DSP_CONSTRAINTS,
        video: false,
      });
      streamRef.current = stream;
      return stream;
    } catch (err: any) {
      if (err.name === "OverconstrainedError") {
        log("error", "DSP constraints not supported by this device", err);
        addToast("Microphone DSP not supported on this device", "error");
      } else {
        log("error", "Microphone access denied", err);
        addToast("Microphone access failed", "error");
      }
      setAudioState("error");
      return null;
    }
  }, [addToast]);

  const stopAudioCapture = useCallback((nextState: AudioState = "idle") => {
    if (!isCapturingRef.current) return;
    
    log("info", "Stopping audio capture...");
    isCapturingRef.current = false;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      streamRef.current = null;
    }

    setAudioState(nextState);
  }, []);

  const startAudioCapture = useCallback(async (externalStream?: MediaStream) => {
    if (isCapturingRef.current) return;

    log("info", "Starting audio session...");
    setAudioState("listening");

    try {
      // If the VAD provides the stream, use it directly (no new getUserMedia call).
      // If triggered manually (button), request our own stream with DSP constraints.
      const stream = externalStream ?? await requestMicrophone();
      if (!stream) return;

      // 1. Local Visualization
      if (audioCtxRef.current && analyzerRef.current) {
        if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
        const source = audioCtxRef.current.createMediaStreamSource(stream);
        source.connect(analyzerRef.current);
      }

      // 2. Delegate WebRTC connection to AudioPipeline
      if (startWebRTC) {
        await startWebRTC(stream);
      }

      isCapturingRef.current = true;
      socket.emit("manual_activation");
      
    } catch (err: any) {
      log("error", "Failed to start capture", err.message);
      setAudioState("error");
      addToast("Failed to start audio stream", "error");
    }
  }, [requestMicrophone, socket, addToast, startWebRTC]);

  // Silero VAD events — emitted by useWakeWord when the WASM model detects speech
  useEffect(() => {
    const onVADSpeechStart = (rawStream: unknown) => {
      startAudioCapture(rawStream as MediaStream);
    };

    const onVADSpeechStop = () => {
      if (!isCapturingRef.current) return;
      log("info", "VAD speech end — signalling backend to stop.");
      socket.emit("manual_stop");
      setAudioState("processing");
    };

    eventBus.on(RockyEvents.VAD_SPEECH_START, onVADSpeechStart);
    eventBus.on(RockyEvents.VAD_SPEECH_STOP, onVADSpeechStop);

    return () => {
      eventBus.off(RockyEvents.VAD_SPEECH_START, onVADSpeechStart);
      eventBus.off(RockyEvents.VAD_SPEECH_STOP, onVADSpeechStop);
    };
  }, [socket, startAudioCapture]);

  const handleManualTrigger = useCallback(() => {
    if (audioState === "listening" || audioState === "processing") {
      socket.emit("manual_stop");
      setAudioState("processing");
    } else {
      startAudioCapture();
    }
  }, [audioState, startAudioCapture, socket]);

  // Socket Listeners for UI State
  useEffect(() => {
    const onStatusUpdate = (status: string) => {
      if (status === "listening") {
        setAudioState("listening");
      } else if (["processing_stt", "thinking_llm"].includes(status)) {
        setAudioState("processing");
      } else if (status === "synthesizing_tts") {
        setAudioState("speaking");
      } else if (status === "idle") {
        setAudioState("idle");
        if (isCapturingRef.current) stopAudioCapture();
      }
    };

    socket.on("status_update", onStatusUpdate);
    socket.on("disconnect", () => {
      log("warn", "Socket disconnected — resetting audio state.");
      setAudioState("idle");
      stopAudioCapture();
    });

    return () => {
      socket.off("status_update", onStatusUpdate);
      socket.off("disconnect");
    };
  }, [socket, stopAudioCapture]);

  // Timeout guard for "processing" state
  useEffect(() => {
    if (audioState !== "processing") return;

    const timeout = setTimeout(() => {
      log("warn", "Processing state timed out — resetting to idle.");
      setAudioState("idle");
    }, 12000); // 12 seconds max for LLM + TTS start

    return () => clearTimeout(timeout);
  }, [audioState]);

  useEffect(() => {
    return () => stopAudioCapture();
  }, [stopAudioCapture]);

  return {
    audioState,
    micAvailable,
    analyzer,
    audioCtxRef,
    handleManualTrigger,
    startAudioCapture,
    stopAudioCapture,
  };
}
