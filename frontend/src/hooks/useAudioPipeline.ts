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
  // Audio nodes
  const audioCtxRef = externalAudioCtxRef;
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // WebRTC
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const isSpeakingRef = useRef(false);

  const handleStopSpeaking = useCallback(() => {
    if (!isSpeakingRef.current) return;

    console.log("[Rocky] Interrupting speech...");
    if (socket) {
      socket.emit("voice_interrupt");
    }
    eventBus.emit(RockyEvents.INTERRUPT);
    isSpeakingRef.current = false;
    setStatus((prev: RockyStatus) => (prev === "synthesizing_tts" ? "idle" : prev));
  }, [setStatus, socket]);

  // Initialization
  useEffect(() => {
    if (!audioCtxRef?.current) return;
    
    const audioCtx = audioCtxRef.current;

    if (!analyzerRef.current) {
      if (externalAnalyzerRef) {
        analyzerRef.current = externalAnalyzerRef;
      } else {
        analyzerRef.current = audioCtx.createAnalyser();
        analyzerRef.current.fftSize = 256;
      }
    }

    if (!gainNodeRef.current) {
      gainNodeRef.current = audioCtx.createGain();
      gainNodeRef.current.gain.value = 0.8;
      gainNodeRef.current.connect(audioCtx.destination);
    }
  }, [externalAnalyzerRef, audioCtxRef]);

  // Sync the external analyzer when useAudioManager finishes its async init.
  useEffect(() => {
    if (externalAnalyzerRef && analyzerRef.current !== externalAnalyzerRef) {
      analyzerRef.current = externalAnalyzerRef;
    }
  }, [externalAnalyzerRef]);

  // WebRTC Connection Logic
  const startWebRTC = useCallback(async (micStream?: MediaStream) => {
    if (!audioCtxRef?.current) return;
    
    // Close existing connection ONLY if it's in a failed state
    if (pcRef.current && (pcRef.current.connectionState === "failed" || pcRef.current.connectionState === "closed")) {
      closeWebRTC();
    }
    
    // Reuse existing connection if active
    if (pcRef.current && pcRef.current.connectionState === "connected") {
      console.log("[Rocky] Reusing existing WebRTC Pipeline...");
      return;
    }

    console.log("[Rocky] Initializing WebRTC Audio Pipeline...");
    
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    pcRef.current = pc;

    if (micStream) {
      for (const track of micStream.getAudioTracks()) {
        pc.addTrack(track, micStream);
      }
    }

    pc.ontrack = (event) => {
      console.log("[Rocky] Assistant audio track received via WebRTC");
      const remoteStream = event.streams[0];
      if (!remoteStream) return;
      
      const audioCtx = audioCtxRef.current!;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      if (remoteSourceRef.current) remoteSourceRef.current.disconnect();
      const remoteSource = audioCtx.createMediaStreamSource(remoteStream);
      remoteSourceRef.current = remoteSource;
      
      if (analyzerRef.current) {
        remoteSource.connect(analyzerRef.current);
      }
      
      const destination = gainNodeRef.current ?? audioCtx.destination;
      remoteSource.connect(destination);
    };

    try {
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
      setStatus("idle");
      closeWebRTC();
    }
  }, [socket.id, addToast, audioCtxRef]);

  const closeWebRTC = useCallback(() => {
    if (pcRef.current) {
      console.log("[Rocky] Closing WebRTC Pipeline...");
      pcRef.current.getReceivers().forEach(receiver => {
        if (receiver.track) receiver.track.stop();
      });
      pcRef.current.close();
      pcRef.current = null;
    }

    if (remoteSourceRef.current) {
      remoteSourceRef.current.disconnect();
      remoteSourceRef.current = null;
    }
  }, []);

  // Socket Event Listeners for Status/Metadata
  useEffect(() => {
    const ttsRateRef_inner = { current: 24000 };

    const onTtsStart = (data: { sampleRate?: number }) => {
      if (data?.sampleRate) ttsRateRef_inner.current = data.sampleRate;
      if (audioCtxRef?.current?.state === 'suspended') audioCtxRef.current.resume();
      isSpeakingRef.current = true;
      setStatus("synthesizing_tts");
    };

    const onTtsEnd = () => {
      console.log("[Rocky] TTS stream finished.");
      isSpeakingRef.current = false;
      setStatus("idle");
      // Keeping WebRTC alive for latency optimization (Gold Standard)
      console.log("[Rocky] WebRTC kept alive for next turn.");
    };

    const onTtsError = () => {
      addToast("Voice synthesis failed", "error");
      if (lastAssistantTextRef.current) {
        speakBrowserFallback(lastAssistantTextRef.current);
      }
    };

    const onSetVolume = (data: SetVolume) => {
      if (gainNodeRef.current && audioCtxRef?.current) {
        gainNodeRef.current.gain.setTargetAtTime(data.level / 100, audioCtxRef.current.currentTime, 0.1);
      }
      addToast(`🔊 Volume: ${data.level}%`, "info");
    };

    const playEarcon = async (type: SoundTrigger["type"]) => {
      if (!audioCtxRef?.current) return;
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

    const onStatusForPipeline = (status: RockyStatus) => {
      if (status === "thinking_llm") handleStopSpeaking();
    };
    socket.on("status_update", onStatusForPipeline);
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

    return () => {
      socket.off("status_update", onStatusForPipeline);
      socket.off("tts_start", onTtsStart);
      socket.off("tts_error", onTtsError);
      socket.off("tts_end", onTtsEnd);
      socket.off("set_volume", onSetVolume);
      socket.off("stop_speaking");
      socket.off("sound_trigger");
      socket.off("VOICE_RECOVERING");
    };
  }, [socket, setStatus, addToast, handleStopSpeaking, lastAssistantTextRef, speakBrowserFallback, audioCtxRef]);

  return {
    audioCtxRef,
    analyzerRef,
    isSpeakingRef,
    handleStopSpeaking,
    startWebRTC,
    isAudioActive: () => isSpeakingRef.current
  };
}
