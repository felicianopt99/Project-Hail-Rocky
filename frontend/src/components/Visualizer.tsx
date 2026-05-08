import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useRockyStore, RockyStatus } from "../store/useRockyStore";

interface VisualizerProps {
  children?: React.ReactNode;
  analyzerNode?: AnalyserNode | null;
}

// HSL + behavior per state
const STATE_CONFIG: Record<RockyStatus, {
  h: number; s: number; l: number;
  label: string;
  animate: "drift" | "reactive" | "compute" | "speak" | "error";
}> = {
  idle:            { h: 210, s: 20,  l: 30, label: "STANDBY",            animate: "drift"    },
  listening:       { h: 35,  s: 90,  l: 65, label: "AUDIO INPUT ACTIVE", animate: "reactive" },
  processing_stt:  { h: 175, s: 78,  l: 55, label: "TRANSCRIBING",       animate: "compute"  },
  thinking_llm:    { h: 170, s: 72,  l: 52, label: "COMPUTING",          animate: "compute"  },
  synthesizing_tts:{ h: 42,  s: 95,  l: 62, label: "TRANSMITTING",       animate: "speak"    },
  hot_mic:         { h: 45,  s: 85,  l: 55, label: "LISTENING (HOT)",    animate: "reactive" },
  error:           { h: 0,   s: 80,  l: 60, label: "SIGNAL FAULT",       animate: "error"    },
};

export default function Visualizer({ children, analyzerNode }: VisualizerProps) {
  const { status } = useRockyStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;

    const render = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const time = Date.now() * 0.001;
      const cfg = STATE_CONFIG[status] ?? STATE_CONFIG.idle;
      const { h, s, l, animate } = cfg;

      const binCount = analyzerNode ? analyzerNode.frequencyBinCount : 256;
      if (!freqDataRef.current || freqDataRef.current.length !== binCount) {
        freqDataRef.current = new Uint8Array(binCount);
      }
      const freqData = freqDataRef.current;
      if (analyzerNode) analyzerNode.getByteFrequencyData(freqData);

      const numBars = 80;
      const totalW = width * 0.88;
      const bw = totalW / numBars;
      const startX = (width - totalW) / 2;
      const centerY = height * 0.52;
      const maxH = height * 0.28;

      for (let i = 0; i < numBars; i++) {
        let val = 0;

        if (animate === "reactive" && analyzerNode) {
          const bin = Math.floor(i * (freqData.length * 0.65) / numBars);
          val = Math.pow((freqData[bin] ?? 0) / 255, 0.7);
        } else if (animate === "compute") {
          val = 0.22 + Math.sin(time * 3.2 + i * 0.26) * 0.17
                     + Math.sin(time * 7.1 + i * 0.62) * 0.07
                     + Math.random() * 0.025;
        } else if (animate === "speak") {
          // Rocky's musical communication — harmonic pattern
          val = 0.38 + Math.sin(time * 5.0 + i * 0.19) * 0.26
                     + Math.sin(time * 11.5 + i * 0.85) * 0.13
                     + Math.sin(time * 2.3 + i * 0.4) * 0.08;
        } else if (animate === "error") {
          val = 0.08 + (Math.random() > 0.82 ? Math.random() * 0.65 : 0)
                     + Math.abs(Math.sin(time * 9 + i)) * 0.04;
        } else {
          // idle / hot_mic: slow cosmic breath
          val = 0.035 + Math.sin(time * 1.1 + i * 0.22) * 0.025
                      + Math.sin(time * 0.6 + i * 0.41) * 0.015;
        }

        val = Math.max(0, Math.min(1, val));
        const barH = val * maxH;
        const x = startX + i * bw;
        const barW = Math.max(1, bw - 1.5);
        const alpha = 0.22 + val * 0.65;

        // Top bar (solid color, eliminates gradient allocation)
        ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
        ctx.fillRect(x, centerY - barH, barW, barH);

        // Bottom mirror with reduced alpha
        ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, ${alpha * 0.45})`;
        ctx.fillRect(x, centerY, barW, barH);

        // Bright peak tips
        if (val > 0.12) {
          const tipA = Math.min(0.95, val * 1.6);
          ctx.fillStyle = `hsla(${h}, ${s}%, 92%, ${tipA})`;
          ctx.fillRect(x, centerY - barH - 1, barW, 1);
          ctx.fillRect(x, centerY + barH,     barW, 1);
        }
      }

      // Center line
      ctx.fillStyle = `hsla(${h}, ${s}%, ${l}%, 0.22)`;
      ctx.fillRect(startX, centerY - 0.5, totalW, 1);

      // Sonar rings from center
      for (let r = 0; r < 4; r++) {
        const phase = ((time * 0.14 + r * 0.25) % 1);
        const radius = Math.min(width, height) * 0.05 + phase * Math.min(width, height) * 0.22;
        const ringA = Math.pow(1 - phase, 2.2) * 0.13;
        ctx.beginPath();
        ctx.arc(width / 2, centerY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${h}, ${s}%, ${l}%, ${ringA})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      raf = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, [analyzerNode, status]);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width  = canvasRef.current.offsetWidth;
        canvasRef.current.height = canvasRef.current.offsetHeight;
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const cfg = STATE_CONFIG[status] ?? STATE_CONFIG.idle;
  const { environmentalState } = useRockyStore();

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden" style={{ background: "#030508" }}>
      {/* Noise suppression indicator */}
      <AnimatePresence>
        {environmentalState.isNoisy && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-20 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 backdrop-blur-md flex items-center gap-2"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-[8px] font-mono tracking-widest text-cyan-400/80 uppercase">
              Noise Suppressed {environmentalState.detectedTypes.length > 0 && `(${environmentalState.detectedTypes.join(", ")})`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Frequency spectrum canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* Chat / children overlay */}
      <div className="relative z-10 w-full h-full flex flex-col items-center justify-center pointer-events-auto">
        {children}
      </div>

      {/* Bottom status readout */}
      <div className="absolute bottom-12 left-0 w-full flex flex-col items-center pointer-events-none z-20">
        <div className="flex flex-col items-center gap-2">
          <div className="h-px w-28 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="flex items-center gap-3">
            <motion.span
              key={status}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              className="text-[9px] font-mono tracking-[0.55em] uppercase"
              style={{ color: `hsla(${cfg.h}, ${cfg.s}%, ${cfg.l}%, 0.75)` }}
            >
              {cfg.label}
            </motion.span>
            <motion.div
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.8, repeat: Infinity }}
              className="w-1 h-1 rounded-full"
              style={{ backgroundColor: `hsl(${cfg.h}, ${cfg.s}%, ${cfg.l}%)` }}
            />
            <span className="text-[9px] font-mono tracking-[0.35em] uppercase text-white/18">ROCKY</span>
          </div>
          <div className="h-px w-28 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
      </div>

      {/* Corner labels — ship instrument feel */}
      <div className="absolute top-4 left-4 pointer-events-none z-20 space-y-1">
        <div className="text-[7px] font-mono tracking-[0.35em] uppercase text-white/14">HAIL MARY</div>
        <div className="text-[6px] font-mono tracking-widest text-white/9">COMM FREQ: 18.8 kHz</div>
      </div>
      <div className="absolute top-4 right-4 pointer-events-none z-20 text-right space-y-1">
        <div className="text-[7px] font-mono tracking-[0.35em] uppercase text-white/14">SIGNAL ANALYSIS</div>
        <motion.div
          animate={{ opacity: [0.08, 0.28, 0.08] }}
          transition={{ duration: 2.2, repeat: Infinity }}
          className="text-[6px] font-mono tracking-widest text-white/20"
        >
          ◉ LIVE
        </motion.div>
      </div>
    </div>
  );
}
