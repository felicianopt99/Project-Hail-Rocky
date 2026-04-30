import React, { useEffect, useRef, useState } from 'react';
import { useStatus } from '../store/useRockyStore';

const STARS = Array.from({ length: 90 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: Math.random() * 1.1 + 0.2,
  phase: Math.random() * Math.PI * 2,
  speed: 0.4 + Math.random() * 1.4,
  brightness: Math.round((Math.random() * 2) * 10) / 10,
}));

function groupBy<T, K extends string | number>(arr: T[], fn: (item: T) => K): Record<K, T[]> {
  const result = {} as Record<K, T[]>;
  arr.forEach(item => {
    const key = fn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  });
  return result;
}

export default function AmbientBackground() {
  const status = useStatus();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  const lastResizeRef = useRef(0);

  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    const drawOrb = (x: number, y: number, radius: number, color: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, color);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    const render = () => {
      const { width, height } = canvas;
      time += 0.003;

      const s = statusRef.current;

      ctx.fillStyle = '#030508';
      ctx.fillRect(0, 0, width, height);

      let c1: string, c2: string;
      if (s === 'thinking_llm' || s === 'processing_stt') {
        c1 = 'rgba(20, 184, 166, 0.07)';
        c2 = 'rgba(6, 78, 100, 0.04)';
      } else if (s === 'error') {
        c1 = 'rgba(239, 68, 68, 0.07)';
        c2 = 'rgba(120, 20, 20, 0.04)';
      } else if (s === 'listening') {
        c1 = 'rgba(232, 130, 12, 0.12)';
        c2 = 'rgba(180, 70, 0, 0.06)';
      } else if (s === 'synthesizing_tts') {
        c1 = 'rgba(245, 158, 11, 0.10)';
        c2 = 'rgba(200, 90, 0, 0.05)';
      } else {
        c1 = 'rgba(180, 90, 8, 0.05)';
        c2 = 'rgba(8, 40, 60, 0.04)';
      }

      drawOrb(width * 0.25 + Math.sin(time * 0.38) * 190, height * 0.35 + Math.cos(time * 0.28) * 140, width * 0.65, c1);
      drawOrb(width * 0.76 + Math.cos(time * 0.46) * 210, height * 0.65 + Math.sin(time * 0.33) * 160, width * 0.70, c2);
      drawOrb(width * 0.50 + Math.sin(time * 0.22) * 260, height * 0.50 + Math.cos(time * 0.18) * 190, width * 0.38, c1);

      // Star field (batch by brightness to reduce draw calls)
      const starsByBrightness = groupBy(STARS, s => {
        const b = 0.25 + Math.sin(time * s.speed + s.phase) * 0.22;
        return Math.round(b * 10) / 10;
      });

      Object.entries(starsByBrightness).forEach(([brightnessStr, stars]) => {
        const brightness = parseFloat(brightnessStr);
        ctx.fillStyle = `rgba(255, 240, 220, ${brightness * 0.55})`;
        ctx.beginPath();
        stars.forEach(star => {
          ctx.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
        });
        ctx.fill();
      });

      // Sparse warm grain
      ctx.fillStyle = 'rgba(255, 190, 80, 0.007)';
      for (let i = 0; i < 12; i++) {
        const gx = (Math.sin(time * 7.3 + i * 137.5) * 0.5 + 0.5) * width;
        const gy = (Math.cos(time * 5.1 + i * 97.3) * 0.5 + 0.5) * height;
        ctx.fillRect(gx, gy, 1, 1);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    const handleResize = () => {
      const now = Date.now();
      if (now - lastResizeRef.current < 100) return;
      lastResizeRef.current = now;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="fixed inset-0 w-full h-full pointer-events-none z-0" />
  );
}
