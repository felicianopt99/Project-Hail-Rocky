import React, { useEffect, useRef, useState, useCallback } from "react";
import { Socket } from "socket.io-client";

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
}

export function useAudioPipeline({ 
  socket, 
  addToast, 
  setStatus, 
  speakBrowserFallback,
  lastAssistantTextRef
}: AudioPipelineOptions) {
  const [isAudioReady, setIsAudioReady] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
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
      try { source.stop(); } catch(e) {}
    });
    activeSources.current.clear();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextChunkTimeRef.current = audioCtxRef.current?.currentTime || 0;
    isSpeakingRef.current = false;
    
    // Only go to idle if we weren't already triggered into a listening/thinking state
    // This prevents the "wake word -> interrupt -> idle" race condition
    setStatus((prev: string) => (prev === "synthesizing_tts" ? "idle" : prev));
  }, [setStatus]);

  useEffect(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
      analyzerRef.current = audioCtxRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      gainNodeRef.current = audioCtxRef.current.createGain();
      gainNodeRef.current.gain.value = 0.8;
      setIsAudioReady(true);
    }

    const audioCtx = audioCtxRef.current;
    const analyzer = analyzerRef.current!;

    const scheduleNextChunk = () => {
      if (!audioQueueRef.current.length) {
        isPlayingRef.current = false;
        if (!isSpeakingRef.current) {
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
      const newSampleRate = options?.sampleRate || 16000;
      
      if (newSampleRate !== currentSampleRateRef.current || audioQueueRef.current.length === 0) {
        console.log(`[Rocky] New TTS Segment. Sample Rate: ${newSampleRate}`);
        currentSampleRateRef.current = newSampleRate;
        if (audioQueueRef.current.length === 0) {
          // Increase initial jitter buffer to 400ms for high stability on low-end HW
          nextChunkTimeRef.current = audioCtx.currentTime + 0.4;
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

        if (audioQueueRef.current.length > 15) {
          audioQueueRef.current = audioQueueRef.current.slice(-8);
          nextChunkTimeRef.current = audioCtx.currentTime;
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

    socket.on("tts_start", onTtsStart);
    socket.on("tts_chunk", onTtsChunk);
    socket.on("tts_error", onTtsError);
    socket.on("tts_end", onTtsEnd);
    socket.on("set_volume", onSetVolume);
    socket.on("stop_speaking", onStopSpeaking);
    socket.on("sound_trigger", (data: { type: string }) => playEarcon(data.type));

    return () => {
      socket.off("tts_start", onTtsStart);
      socket.off("tts_chunk", onTtsChunk);
      socket.off("tts_error", onTtsError);
      socket.off("tts_end", onTtsEnd);
      socket.off("set_volume", onSetVolume);
      socket.off("stop_speaking", onStopSpeaking);
      socket.off("sound_trigger");
    };
  }, [socket]);

  return {
    audioCtxRef,
    analyzerRef,
    isSpeakingRef,
    handleStopSpeaking,
    isAudioReady
  };
}
