import React, { useEffect, useRef, useState, useCallback } from "react";
import { Socket } from "socket.io-client";
import { eventBus, RockyEvents } from '../lib/eventBus';
import { ServerToClientEvents, ClientToServerEvents, SetVolume, SoundTrigger } from "../types/socketEvents";
import { RockyStatus } from "../store/useRockyStore";

const earconCache = new Map<string, AudioBuffer>();

async function loadEarcon(file: string, audioCtx: AudioContext): Promise<AudioBuffer | null> {
  if (earconCache.has(file)) {
    return earconCache.get(file)!;
  }

  try {
    const response = await fetch(file);
    const arrayBuffer = await response.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    earconCache.set(file, decoded);
    return decoded;
  } catch (error) {
    console.warn(`[Rocky] Failed to load earcon ${file}:`, error);
    return null;
  }
}

interface AudioPipelineOptions {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  addToast: (message: string, type: "info" | "success" | "error" | "warning") => void;
  setStatus: (status: RockyStatus | ((prev: RockyStatus) => RockyStatus)) => void;
  speakBrowserFallback: (text: string) => void;
  lastAssistantTextRef: React.MutableRefObject<string>;
  externalAudioCtxRef?: React.MutableRefObject<AudioContext | null>;
  externalAnalyzerRef?: AnalyserNode | null;
}

/**
 * useAudioPipeline - 2026 Edition
 * Manages assistant voice output via WebRTC for ultra-low latency.
 * Replaces legacy Socket.io PCM chunking and manual jitter buffering.
 */
export function useAudioPipeline({ 
  socket, 
  addToast, 
  setStatus, 
  speakBrowserFallback,
  lastAssistantTextRef,
  externalAudioCtxRef,
  externalAnalyzerRef
}: AudioPipelineOptions) {
  const [isAudioReady, setIsAudioReady] = useState(false);
  const internalAudioCtxRef = useRef<AudioContext | null>(null);
  
  // Audio nodes
  const audioCtxRef = externalAudioCtxRef || internalAudioCtxRef;
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  
  // WebRTC
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const isSpeakingRef = useRef(false);

  const handleStopSpeaking = useCallback(() => {
    console.log("[Rocky] Interrupting speech...");
    
    // Notify backend to stop the pipeline
    if (socket) {
      socket.emit("voice_interrupt");
    }
    eventBus.emit(RockyEvents.INTERRUPT);
    
    // We don't close the PC here, just let the track stop sending data
    isSpeakingRef.current = false;
    setStatus((prev: RockyStatus) => (prev === "synthesizing_tts" ? "idle" : prev));
  }, [setStatus, socket]);

  // Initialization
  useEffect(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    
    if (!analyzerRef.current && audioCtxRef.current) {
      if (externalAnalyzerRef) {
        analyzerRef.current = externalAnalyzerRef;
      } else {
        analyzerRef.current = audioCtxRef.current.createAnalyser();
        analyzerRef.current.fftSize = 256;
      }
    }

    if (!gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current = audioCtxRef.current.createGain();
      gainNodeRef.current.gain.value = 0.8;
      gainNodeRef.current.connect(audioCtxRef.current.destination);
    }

    setIsAudioReady(true);
  }, []);

  // WebRTC Connection Logic
  const startWebRTC = useCallback(async (micStream?: MediaStream) => {
    if (!audioCtxRef.current) return;
    
    // Close existing connection if any
    if (pcRef.current) {
      pcRef.current.close();
    }

    console.log("[Rocky] Initializing WebRTC Audio Pipeline...");
    
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    pcRef.current = pc;

    // 1. Add Mic Track (if available) to send to backend for STT/VAD
    if (micStream) {
      micStream.getAudioTracks().forEach(track => pc.addTrack(track, micStream));
    }

    // 2. Handle Incoming Track (Rocky's Voice)
    pc.ontrack = (event) => {
      console.log("[Rocky] Assistant audio track received via WebRTC");
      const remoteStream = event.streams[0];
      if (!remoteStream) return;
      
      const audioCtx = audioCtxRef.current!;
      
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      const remoteSource = audioCtx.createMediaStreamSource(remoteStream);
      
      // Route through analyzer for visualizer
      if (analyzerRef.current) {
        remoteSource.connect(analyzerRef.current);
      }
      
      // Route through gain node for volume control
      if (gainNodeRef.current) {
        remoteSource.connect(gainNodeRef.current);
      } else {
        remoteSource.connect(audioCtx.destination);
      }
    };

    try {
      // 3. Create and Send Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

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

      if (!response.ok) throw new Error(`WebRTC offer failed: ${response.status}`);
      
      const answer = await response.json();
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      
      console.log("[Rocky] WebRTC Pipeline Connected.");
    } catch (err) {
      console.error("[Rocky] Failed to establish WebRTC connection:", err);
      addToast("Audio pipeline failure", "error");
    }
  }, [socket.id, addToast, audioCtxRef]);

  // Socket Event Listeners for Status/Metadata
  useEffect(() => {
    const onTtsStart = () => {
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
      isSpeakingRef.current = true;
      setStatus("synthesizing_tts");
    };

    const onTtsEnd = () => {
      console.log("[Rocky] TTS stream finished.");
      isSpeakingRef.current = false;
      setStatus("idle");
    };

    const onTtsError = () => {
      addToast("Voice synthesis failed", "error");
      if (lastAssistantTextRef.current) {
        speakBrowserFallback(lastAssistantTextRef.current);
      }
    };

    const onSetVolume = (data: SetVolume) => {
      if (gainNodeRef.current && audioCtxRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(data.level / 100, audioCtxRef.current.currentTime, 0.1);
      }
      addToast(`🔊 Volume: ${data.level}%`, "info");
    };

    const playEarcon = async (type: SoundTrigger["type"]) => {
      if (!audioCtxRef.current) return;
      const fileMap: Record<SoundTrigger["type"], string> = {
        accept: "/earcons/accept.wav",
        success: "/earcons/success.wav",
        error: "/earcons/error.wav",
      };
      const file = fileMap[type];
      if (!file) return;
      const decoded = await loadEarcon(file, audioCtxRef.current);
      if (!decoded) return;
      try {
        const source = audioCtxRef.current.createBufferSource();
        source.buffer = decoded;
        source.connect(audioCtxRef.current.destination);
        source.start(0);
      } catch (e) {
        console.warn(`[Rocky] Failed to play earcon ${type}:`, e);
      }
    };

    socket.on("status_update", (status: RockyStatus) => {
      if (status === "thinking_llm") {
        handleStopSpeaking();
      }
    });
    socket.on("tts_start", onTtsStart);
    socket.on("tts_error", onTtsError);
    socket.on("tts_end", onTtsEnd);
    socket.on("set_volume", onSetVolume);
    socket.on("stop_speaking", () => handleStopSpeaking());
    socket.on("sound_trigger", (data: SoundTrigger) => playEarcon(data.type));
    socket.on("VOICE_RECOVERING", () => {
      addToast("Recovering voice session...", "warning");
      setStatus("processing_stt");
    });

    // Cleanup listeners
    return () => {
      socket.off("status_update");
      socket.off("tts_start", onTtsStart);
      socket.off("tts_error", onTtsError);
      socket.off("tts_end", onTtsEnd);
      socket.off("set_volume", onSetVolume);
      socket.off("stop_speaking");
      socket.off("sound_trigger");
      socket.off("VOICE_RECOVERING");
    };
  }, [socket, setStatus, addToast, handleStopSpeaking, lastAssistantTextRef, speakBrowserFallback]);

  return {
    audioCtxRef,
    analyzerRef,
    isSpeakingRef,
    handleStopSpeaking,
    isAudioReady,
    startWebRTC, // Exported so AudioManager can trigger it
    isAudioActive: () => isSpeakingRef.current
  };
}
