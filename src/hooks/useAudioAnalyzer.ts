import { useState, useEffect, useRef } from "react";

export function useAudioAnalyzer(isActive: boolean) {
  const [audioData, setAudioData] = useState({ frequencies: Array(32).fill(0), amplitude: 0 });
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      return;
    }

    const startAudio = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 64; // Small FFT for 32 frequency bins
        
        sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
        sourceRef.current.connect(analyserRef.current);

        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const update = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          
          // Normalize to 0-1
          const frequencies = Array.from(dataArray).map(v => v / 255);
          const amplitude = frequencies.reduce((a, b) => a + b, 0) / frequencies.length;

          setAudioData({ frequencies, amplitude });
          animationFrameRef.current = requestAnimationFrame(update);
        };

        update();
      } catch (err) {
        console.error("Microphone access denied:", err);
      }
    };

    startAudio();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [isActive]);

  return audioData;
}
