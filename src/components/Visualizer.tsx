import React, { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { useAudioAnalyzer } from "../hooks/useAudioAnalyzer";

export default function Visualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioData = useAudioAnalyzer(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const { width, height } = canvas;
      
      // Clear with slight trail
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const time = Date.now() * 0.001;
      
      // Base radius influenced by voice
      const voiceBoost = audioData.amplitude * 40;
      const baseRadius = Math.min(width, height) * 0.15 + voiceBoost;

      // Draw 3 concentric rings
      for (let i = 0; i < 3; i++) {
        const ringOffset = i * 30;
        // Slow pulse: sin wave over time
        const pulse = Math.sin(time * 1.5 - i * 0.5) * 10;
        const radius = baseRadius + ringOffset + pulse;
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        
        // Opacity decreases for outer rings, increases with voice
        const opacity = (0.6 - i * 0.15) + (audioData.amplitude * 0.4);
        ctx.strokeStyle = `rgba(0, 255, 255, ${Math.max(0.1, opacity)})`;
        ctx.lineWidth = 1.5 - (i * 0.3);
        
        // Add glow to the innermost ring
        if (i === 0) {
          ctx.shadowBlur = 15 + (audioData.amplitude * 20);
          ctx.shadowColor = "rgba(0, 255, 255, 0.6)";
        } else {
          ctx.shadowBlur = 0;
        }
        
        ctx.stroke();
      }

      // Draw the "Core" - a solid-ish center
      const coreRadius = baseRadius * 0.4;
      const coreGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius);
      coreGradient.addColorStop(0, `rgba(0, 255, 255, ${0.4 + audioData.amplitude * 0.6})`);
      coreGradient.addColorStop(1, "rgba(0, 255, 255, 0)");
      
      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      // Subtle orbital dots (very slow)
      const dotCount = 4;
      for (let i = 0; i < dotCount; i++) {
        const angle = (time * 0.2) + (i * (Math.PI * 2 / dotCount));
        const dist = baseRadius + 100;
        const x = centerX + Math.cos(angle) * dist;
        const y = centerY + Math.sin(angle) * dist;
        
        ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [audioData]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = canvasRef.current.offsetWidth;
        canvasRef.current.height = canvasRef.current.offsetHeight;
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <canvas 
        ref={canvasRef} 
        className="w-full h-full"
      />
      
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute bottom-12 text-center"
      >
        <div className="vibe-label mb-2">Neural Processing</div>
        <div className="text-cyan-400 text-sm tracking-[0.5em] uppercase animate-pulse">
          Listening for commands...
        </div>
      </motion.div>

      {/* Ambient particles or glow could be added here */}
      <div className="absolute inset-0 pointer-events-none bg-radial-gradient from-cyan-500/5 to-transparent" />
    </div>
  );
}
