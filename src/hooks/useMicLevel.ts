import { useState, useEffect, useRef } from "react";

/**
 * Hook to manage microphone amplitude levels from an AnalyserNode.
 * Throttled to ~15fps for performance.
 */
export function useMicLevel(analyzer: AnalyserNode | null, isListening: boolean) {
  const [micLevel, setMicLevel] = useState(0);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    let frameId: number;
    
    const update = () => {
      const now = performance.now();
      
      // Throttle to ~15fps (every 66ms) to save CPU/battery
      if (now - lastUpdateRef.current > 66) {
        if (analyzer && isListening) {
          const data = new Uint8Array(analyzer.frequencyBinCount);
          analyzer.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          // Amplify for visual impact
          setMicLevel(Math.min(100, (avg / 128) * 100 * 2.5));
        } else {
          setMicLevel(0);
        }
        lastUpdateRef.current = now;
      }
      
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [analyzer, isListening]);

  return micLevel;
}
