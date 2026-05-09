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
  const remoteSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const isSpeakingRef = useRef(false);

  // PCM chunk scheduling for fallback (non-WebRTC) TTS path
  const nextPlayTimeRef = useRef<number>(0);

  const handleStopSpeaking = useCallback(() => {
    // Only interrupt if Rocky is actually speaking — prevents killing the voice
    // pipeline when status_update arrives during LLM generation (not TTS).
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
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

  // Sync the external analyzer when useAudioManager finishes its async init.
  // The init effect above runs once on mount when externalAnalyzerRef may still be null.
  useEffect(() => {
    if (externalAnalyzerRef && analyzerRef.current !== externalAnalyzerRef) {
      analyzerRef.current = externalAnalyzerRef;
    }
  }, [externalAnalyzerRef]);

  // WebRTC Connection Logic
  const startWebRTC = useCallback(async (micStream?: MediaStream) => {
    if (!audioCtxRef.current) return;
    
    // Close existing connection if any
    closeWebRTC();

    console.log("[Rocky] Initializing WebRTC Audio Pipeline...");
    
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    pcRef.current = pc;

    // 1. Add Mic Track (if available) to send to backend for STT/VAD.
    // Do NOT call applyConstraints here — on Linux/PulseAudio it overrides
    // the browser AGC pipeline and reduces gain to near-zero amplitude.
    if (micStream) {
      for (const track of micStream.getAudioTracks()) {
        pc.addTrack(track, micStream);
      }
    }

    // 2. Handle Incoming Track (Rocky's Voice)
    pc.ontrack = (event) => {
      console.log("[Rocky] Assistant audio track received via WebRTC");
      const remoteStream = event.streams[0];
      if (!remoteStream) return;
      
      const audioCtx = audioCtxRef.current!;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      if (remoteSourceRef.current) remoteSourceRef.current.disconnect();
      const remoteSource = audioCtx.createMediaStreamSource(remoteStream);
      remoteSourceRef.current = remoteSource;
      
      // Task 2: Route through analyzer for visualizer BEFORE gain node
      if (analyzerRef.current) {
        remoteSource.connect(analyzerRef.current);
      }
      
      // Route through gain node for volume control
      const destination = gainNodeRef.current ?? audioCtx.destination;
      remoteSource.connect(destination);
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
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
      nextPlayTimeRef.current = 0;
      isSpeakingRef.current = true;
      setStatus("synthesizing_tts");
    };

    const onTtsEnd = () => {
      console.log("[Rocky] TTS stream finished.");
      nextPlayTimeRef.current = 0;
      isSpeakingRef.current = false;
      setStatus("idle");
      // Close WebRTC to release the mic for the next wake-word cycle.
      closeWebRTC();
      console.log("[Rocky] WebRTC closed — mic released for wake word.");
    };

    // Fallback PCM playback: used when TTS audio arrives via Socket.IO instead of
    // WebRTC (text chat path, or when WebRTC audio track is not yet established).
    const onTtsChunk = (chunk: ArrayBuffer | Uint8Array) => {
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') { void ctx.resume(); }

      let raw: Int16Array;
      if (chunk instanceof ArrayBuffer) {
        raw = new Int16Array(chunk);
      } else {
        raw = new Int16Array(chunk.buffer, chunk.byteOffset, Math.floor(chunk.byteLength / 2));
      }
      if (raw.length === 0) return;

      const float32 = Float32Array.from(raw, s => s / 32768);

      const buffer = ctx.createBuffer(1, float32.length, ttsRateRef_inner.current);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNodeRef.current ?? ctx.destination);

      const now = ctx.currentTime;
      const startTime = Math.max(now, nextPlayTimeRef.current);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + buffer.duration;
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

    const onStatusForPipeline = (status: RockyStatus) => {
      if (status === "thinking_llm") handleStopSpeaking();
    };
    socket.on("status_update", onStatusForPipeline);
    socket.on("tts_start", onTtsStart);
    socket.on("tts_chunk", onTtsChunk);
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
      socket.off("tts_chunk", onTtsChunk);
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
