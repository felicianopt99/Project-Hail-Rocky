import React, { useEffect, useRef, useState, useCallback } from "react";
import { Socket } from "socket.io-client";
import { eventBus, RockyEvents } from '../lib/eventBus';

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
  socket: any;
  addToast: (message: string, type: "info" | "success" | "error" | "warning") => void;
  setStatus: (status: any) => void;
  speakBrowserFallback: (text: string) => void;
  lastAssistantTextRef: React.MutableRefObject<string>;
  externalAudioCtxRef?: React.MutableRefObject<AudioContext | null>;
  externalAnalyzerRef?: AnalyserNode | null;
}

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
  const internalAnalyzerRef = useRef<AnalyserNode | null>(null);
  
  // Use external refs if available, otherwise fall back to internal ones
  const audioCtxRef = externalAudioCtxRef || internalAudioCtxRef;
  const analyzerRef = useRef<AnalyserNode | null>(null); // We keep a local ref to the current analyzer in use

  const gainNodeRef = useRef<GainNode | null>(null);
  const activeSources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextChunkTimeRef = useRef<number>(0);
  const currentSampleRateRef = useRef<number>(22050);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const jitterBufferTargetRef = useRef(80);
  const lastChunkArrivalRef = useRef<number>(0);
  const leftOverByteRef = useRef<number | null>(null);
  const isSpeakingRef = useRef(false);

  const handleStopSpeaking = React.useCallback(() => {
    console.log("[Rocky] Interrupting speech...");
    activeSources.current.forEach(source => {
      try { 
        source.onended = null; // Prevent recursion
        source.stop(); 
      } catch(e) {}
    });
    activeSources.current.clear();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    
    // Reset scheduling time to current context time to avoid gaps on next playback
    if (audioCtxRef.current) {
      nextChunkTimeRef.current = audioCtxRef.current.currentTime + 0.05;
    }
    
    isSpeakingRef.current = false;
    
    // Notify backend and local listeners of interruption (Barge-in)
    if (socket) {
      socket.emit("voice_interrupt");
    }
    eventBus.emit(RockyEvents.INTERRUPT);
    
    // Only go to idle if we weren't already triggered into a listening/thinking state
    // This prevents the "wake word -> interrupt -> idle" race condition
    setStatus((prev: string) => (prev === "synthesizing_tts" ? "idle" : prev));
  }, [setStatus, socket, audioCtxRef]);

  useEffect(() => {
    // 1. Initialization
    if (!audioCtxRef.current) {
      // Only initialize if we are NOT using an external context (or if it hasn't been initialized yet)
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
      setIsAudioReady(true);
    } else {
      setIsAudioReady(true);
    }

    if (!analyzerRef.current) {
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
    }

    const audioCtx = audioCtxRef.current!;
    const analyzer = analyzerRef.current!;

    const scheduleNextChunk = () => {
      if (!audioQueueRef.current.length) {
        isPlayingRef.current = false;
        // Only set idle if we aren't currently receiving more chunks from TTS
        // AND all active audio sources have finished playing.
        if (!isSpeakingRef.current && activeSources.current.size === 0) {
          setStatus("idle");
        }
        return;
      }

      const float32Array = audioQueueRef.current.shift()!;
      const audioBuffer = audioCtx.createBuffer(1, float32Array.length, currentSampleRateRef.current);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(analyzer);
      
      if (gainNodeRef.current) {
        source.connect(gainNodeRef.current);
        gainNodeRef.current.connect(audioCtx.destination);
      } else {
        source.connect(audioCtx.destination);
      }

      const startTime = Math.max(nextChunkTimeRef.current, audioCtx.currentTime);
      source.start(startTime);
      nextChunkTimeRef.current = startTime + audioBuffer.duration;

      activeSources.current.add(source);
      source.onended = () => {
        activeSources.current.delete(source);
        scheduleNextChunk();
      };
    };

    const processAudioQueue = () => {
      // Schedule ahead as much as possible
      while (audioQueueRef.current.length > 0) {
        // If we are scheduling too far ahead (> 1s), stop for now
        if (nextChunkTimeRef.current > audioCtx.currentTime + 1.0) break;
        
        isPlayingRef.current = true;
        scheduleNextChunk();
      }
    };

    const onTtsStart = (options?: { sampleRate: number }) => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      isSpeakingRef.current = true;
      const newSampleRate = options?.sampleRate || 24000;
      
      if (newSampleRate !== currentSampleRateRef.current || audioQueueRef.current.length === 0) {
        console.log(`[Rocky] New TTS Segment. Sample Rate: ${newSampleRate}`);
        currentSampleRateRef.current = newSampleRate;
        if (audioQueueRef.current.length === 0) {
          // Ensure we schedule from the current time plus a small safety buffer (200ms)
          // without overlapping any future scheduled segments.
          nextChunkTimeRef.current = Math.max(nextChunkTimeRef.current, audioCtx.currentTime + 0.2);
        }
      }
      setStatus("synthesizing_tts");
    };

    const onTtsChunk = (data: ArrayBuffer) => {
      const now = performance.now();
      if (lastChunkArrivalRef.current > 0) {
        const delta = now - lastChunkArrivalRef.current;
        if (delta > jitterBufferTargetRef.current) {
          jitterBufferTargetRef.current = Math.min(300, jitterBufferTargetRef.current + 20);
        } else if (delta < jitterBufferTargetRef.current / 2) {
          jitterBufferTargetRef.current = Math.max(50, jitterBufferTargetRef.current - 5);
        }
      }
      lastChunkArrivalRef.current = now;

      const bytes = new Uint8Array(data);
      let combined: Uint8Array;
      
      if (leftOverByteRef.current !== null) {
        combined = new Uint8Array(bytes.length + 1);
        combined[0] = leftOverByteRef.current;
        combined.set(bytes, 1);
        leftOverByteRef.current = null;
      } else {
        combined = bytes;
      }

      if (combined.length % 2 !== 0) {
        leftOverByteRef.current = combined[combined.length - 1];
        combined = combined.slice(0, combined.length - 1);
      }

      if (combined.length === 0) return;

      try {
        const int16Array = new Int16Array(combined.buffer, combined.byteOffset, combined.length / 2);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) float32Array[i] = int16Array[i] / 32768.0;

        // Buffer limit: Only flush if we are severely behind to prevent memory issues.
        // The previous limit of 15 was way too low and caused overlapping speech.
        if (audioQueueRef.current.length > 100) {
          console.warn("[Rocky] Audio queue overflow, clearing buffer.");
          audioQueueRef.current = [];
          nextChunkTimeRef.current = audioCtx.currentTime + 0.1;
        }
        audioQueueRef.current.push(float32Array);
        processAudioQueue();
      } catch (e) {
        console.error("[Rocky] Audio processing error:", e);
      }
    };

    const onTtsError = () => {
      addToast("Voice synthesis failed", "error");
      if (lastAssistantTextRef.current) {
        speakBrowserFallback(lastAssistantTextRef.current);
      }
    };

    const onSetVolume = (data: { level: number }) => {
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(data.level / 100, audioCtx.currentTime, 0.1);
      }
      addToast(`🔊 Volume: ${data.level}%`, "info");
    };

    const onStopSpeaking = () => handleStopSpeaking();

    const onTtsEnd = () => {
      console.log("[Rocky] TTS transfer finished.");
      isSpeakingRef.current = false;
      // We don't set idle here anymore, source.onended will do it
      // when the queue is actually empty.
    };

    const playEarcon = async (type: string) => {
      const audioCtx = audioCtxRef.current;
      if (!audioCtx) return;

      const fileMap: Record<string, string> = {
        accept: "/earcons/accept.wav",
        success: "/earcons/success.wav",
        error: "/earcons/error.wav",
      };

      const file = fileMap[type];
      if (!file) return;

      const decoded = await loadEarcon(file, audioCtx);
      if (!decoded) return;

      try {
        const source = audioCtx.createBufferSource();
        source.buffer = decoded;
        source.connect(audioCtx.destination);
        source.start(0);
      } catch (e) {
        console.warn(`[Rocky] Failed to play earcon ${type}:`, e);
      }
    };

    socket.on("status_update", (status: string) => {
      if (status === "thinking_llm") {
        handleStopSpeaking();
      }
    });
    socket.on("tts_start", onTtsStart);
    socket.on("tts_chunk", onTtsChunk);
    socket.on("tts_error", onTtsError);
    socket.on("tts_end", onTtsEnd);
    socket.on("set_volume", onSetVolume);
    socket.on("stop_speaking", onStopSpeaking);
    socket.on("sound_trigger", (data: { type: string }) => playEarcon(data.type));
    socket.on("VOICE_RECOVERING", () => {
      addToast("Recovering voice session...", "warning");
      setStatus("processing"); // Visual indicator that something is happening
    });

    return () => {
      socket.off("tts_start", onTtsStart);
      socket.off("tts_chunk", onTtsChunk);
      socket.off("tts_error", onTtsError);
      socket.off("tts_end", onTtsEnd);
      socket.off("set_volume", onSetVolume);
      socket.off("stop_speaking", onStopSpeaking);
      socket.off("sound_trigger");
      socket.off("VOICE_RECOVERING");
    };
  }, [socket]);

  return {
    audioCtxRef,
    analyzerRef,
    isSpeakingRef,
    handleStopSpeaking,
    isAudioReady,
    isAudioActive: () => isSpeakingRef.current || activeSources.current.size > 0 || audioQueueRef.current.length > 0
  };
}
