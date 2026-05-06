import { useEffect, useRef, useState, useCallback } from "react";
import { useRockyStore } from "../store/useRockyStore";
import { eventBus, RockyEvents } from "../lib/eventBus";

// The socket from our lib/socket.ts is a custom class, not socket.io-client
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

export function useAudioManager({ socket, addToast }: AudioManagerOptions) {
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [micAvailable, setMicAvailable] = useState(false);

  // Audio contexts (for visualization)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [analyzer, setAnalyzer] = useState<AnalyserNode | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // WebRTC
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // State flags
  const isCapturingRef = useRef(false);
  
  // VAD Settings (client-side VAD still used for auto-stop)
  const SILENCE_THRESHOLD = 35;
  const SILENCE_DURATION = 2500;
  const silenceStartRef = useRef<number | null>(null);

  // ========== CORE INITIALIZATION ==========
  useEffect(() => {
    log("info", "Initializing AudioManager...");

    const initAudioContext = async () => {
      try {
        if (audioCtxRef.current) return;

        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) throw new Error("AudioContext not available");

        const audioCtx = new Ctx();
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 256;

        audioCtxRef.current = audioCtx;
        analyzerRef.current = analyzer;
        setAnalyzer(analyzer);
        setMicAvailable(true);
        log("info", "AudioContext initialized");
      } catch (err: any) {
        log("error", "Failed to initialize AudioContext", err.message);
        addToast("Audio system unavailable", "error");
        setAudioState("error");
      }
    };

    // Check for HTTPS/localhost
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

  // ========== REQUEST MICROPHONE ==========
  const requestMicrophone = useCallback(async (): Promise<MediaStream | null> => {
    log("info", "Requesting microphone access...");
    setAudioState("requesting_mic");

    try {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000, // Hint for STT compatibility
        },
        video: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      log("info", "Microphone access granted");
      streamRef.current = stream;
      return stream;
    } catch (err: any) {
      log("error", "Microphone access denied", err);
      addToast("Microphone access failed", "error");
      setAudioState("error");
      return null;
    }
  }, [addToast]);

  // ========== STOP AUDIO CAPTURE ==========
  const stopAudioCapture = useCallback((nextState: AudioState = "idle") => {
    if (!isCapturingRef.current) return;
    
    log("info", "Stopping WebRTC audio capture...");
    isCapturingRef.current = false;

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    silenceStartRef.current = null;
    setAudioState(nextState);
  }, []);

  // ========== START AUDIO CAPTURE (WebRTC) ==========
  const startAudioCapture = useCallback(async () => {
    if (isCapturingRef.current) return;
    
    log("info", "Starting WebRTC audio capture...");
    setAudioState("listening");

    try {
      const stream = await requestMicrophone();
      if (!stream) return;

      // 1. Setup local visualization
      if (audioCtxRef.current && analyzerRef.current) {
        if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
        const source = audioCtxRef.current.createMediaStreamSource(stream);
        source.connect(analyzerRef.current);
      }

      // 2. Setup WebRTC PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      pcRef.current = pc;

      // 3. Add audio track
      stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));

      // 4. Create Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 5. Signal to backend
      const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
      const response = await fetch(`${backendUrl}/api/webrtc/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: pc.localDescription?.sdp,
          type: pc.localDescription?.type,
          sid: socket.id
        })
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const answer = await response.json();
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      isCapturingRef.current = true;
      socket.emit("manual_activation");
      
      log("info", "WebRTC connection established");

    } catch (err: any) {
      log("error", "Failed to start WebRTC capture", err.message);
      setAudioState("error");
      addToast("Failed to start WebRTC stream", "error");
    }
  }, [requestMicrophone, socket, addToast]);

  // ========== VAD LOOP (Local monitoring for auto-stop) ==========
  useEffect(() => {
    if (audioState !== "listening") return;

    const interval = setInterval(() => {
      if (!analyzerRef.current || !isCapturingRef.current) return;

      const dataArray = new Uint8Array(analyzerRef.current.fftSize);
      analyzerRef.current.getByteTimeDomainData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length) * 100;
      
      if (rms < SILENCE_THRESHOLD) {
        if (!silenceStartRef.current) silenceStartRef.current = Date.now();
        const silenceMs = Date.now() - silenceStartRef.current;
        
        if (silenceMs > SILENCE_DURATION) {
          log("info", `Silence detected (${silenceMs}ms), stopping...`);
          stopAudioCapture("processing");
          socket.emit("manual_stop");
        }
      } else {
        silenceStartRef.current = null;
      }
    }, 100);

    return () => clearInterval(interval);
  }, [audioState, stopAudioCapture, socket]);

  // ========== MANUAL TRIGGER ==========
  const handleManualTrigger = useCallback(() => {
    if (audioState === "listening" || audioState === "processing") {
      stopAudioCapture("processing");
      socket.emit("manual_stop");
    } else {
      startAudioCapture();
    }
  }, [audioState, startAudioCapture, stopAudioCapture, socket]);

  // ========== SOCKET LISTENERS ==========
  useEffect(() => {
    const onStatusUpdate = (status: string) => {
      if (status === "listening") setAudioState("listening");
      else if (["processing_stt", "thinking_llm"].includes(status)) {
        setAudioState("processing");
        if (isCapturingRef.current) stopAudioCapture();
      } else if (status === "synthesizing_tts") {
        setAudioState("speaking");
        if (isCapturingRef.current) stopAudioCapture();
      } else if (status === "idle") setAudioState("idle");
    };

    socket.on("status_update", onStatusUpdate);
    
    const onWakeWord = () => startAudioCapture();
    eventBus.on(RockyEvents.WAKE_WORD_DETECTED, onWakeWord);

    return () => {
      socket.off("status_update", onStatusUpdate);
      eventBus.off(RockyEvents.WAKE_WORD_DETECTED, onWakeWord);
    };
  }, [socket, stopAudioCapture, startAudioCapture]);

  // ========== AUTO-RESTART LOOP (Continuous Mode) ==========
  const status = useRockyStore(s => s.status);
  const isListeningGlobal = useRockyStore(s => s.isListening);

  useEffect(() => {
    if (status === "idle" && isListeningGlobal && !isCapturingRef.current && audioState === "idle") {
      const timer = setTimeout(() => {
        if (!isCapturingRef.current && useRockyStore.getState().status === "idle") {
          startAudioCapture();
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [status, isListeningGlobal, startAudioCapture, audioState]);

  // ========== CLEANUP ==========
  useEffect(() => {
    return () => {
      stopAudioCapture();
    };
  }, [stopAudioCapture]);

  return {
    audioState,
    micAvailable,
    analyzer,
    handleManualTrigger,
    startAudioCapture,
    stopAudioCapture,
  };
}
