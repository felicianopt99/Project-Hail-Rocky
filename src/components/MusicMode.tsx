import React, { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Mic, Lightbulb, Zap, Sliders, Activity } from "lucide-react";
import socket from "../lib/socket";
import { useAudioAnalyzer } from "../hooks/useAudioAnalyzer";

interface LightState {
  status: "on" | "off";
  color: string;
  brightness: number;
}

export default function MusicMode() {
  const audioData = useAudioAnalyzer(true);
  const [sensitivity, setSensitivity] = useState(0.8);
  const [lights, setLights] = useState<Record<string, LightState>>({});

  useEffect(() => {
    socket.on("initial_state", (data: any) => {
      setLights(data.lights);
    });
    socket.on("device_updated", (data: { device: string, state: LightState }) => {
      setLights(prev => ({ ...prev, [data.device]: data.state }));
    });
    return () => {
      socket.off("initial_state");
      socket.off("device_updated");
    };
  }, []);

  const updateLight = (device: string, params: Partial<LightState>) => {
    socket.emit("control_device", { device, action: "set", params });
  };

  return (
    <div className="h-full w-full flex flex-col items-center justify-center p-8 bg-gradient-to-b from-black via-magenta-950/10 to-black relative overflow-hidden">
      {/* Dynamic Background Glow */}
      <motion.div 
        animate={{ 
          opacity: [0.1, 0.3, 0.1],
          scale: [1, 1.1, 1],
        }}
        style={{ backgroundColor: `rgba(255, 0, 255, ${audioData.amplitude * 0.2})` }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 blur-[150px] -z-10"
      />

      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left: Mic Input Visualizer */}
        <div className="vibe-card p-6 border-white/10 bg-white/5 space-y-6">
          <div className="flex justify-between items-center">
            <div className="vibe-label flex items-center gap-2">
              <Mic size={14} className="text-magenta-400" /> Mic Capture
            </div>
            <div className="text-[10px] font-mono text-magenta-400 animate-pulse">LIVE</div>
          </div>

          <div className="h-48 flex items-end justify-center gap-1.5">
            {audioData.frequencies.map((freq, i) => (
              <motion.div 
                key={i}
                animate={{ height: `${freq * 100}%` }}
                className="flex-1 bg-magenta-500/40 rounded-t-sm"
              />
            ))}
          </div>

          <div className="space-y-4 pt-4 border-t border-white/5">
            <div className="flex justify-between text-[10px] uppercase tracking-widest text-white/40">
              <span>Sensitivity</span>
              <span>{Math.round(sensitivity * 100)}%</span>
            </div>
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.01"
              value={sensitivity}
              onChange={(e) => setSensitivity(parseFloat(e.target.value))}
              className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-magenta-500"
            />
          </div>
        </div>

        {/* Center: Light Sync Status */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sync Card */}
            <div className="vibe-card p-8 border-magenta-500/30 bg-magenta-500/5 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-magenta-500/20 flex items-center justify-center border border-magenta-500/50">
                <Zap size={32} className="text-magenta-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold">Light Sync Active</h3>
                <p className="text-xs text-white/40 mt-1">DMX controllers responding to neural audio stream.</p>
              </div>
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-magenta-500 text-black text-[10px] font-bold rounded-full">RGB_DYNAMIC</span>
                <span className="px-3 py-1 bg-white/10 text-white text-[10px] font-bold rounded-full">LATENCY: 8MS</span>
              </div>
            </div>

            {/* Config Card */}
            <div className="vibe-card p-6 border-white/10 bg-white/5 space-y-6">
              <div className="vibe-label flex items-center gap-2">
                <Sliders size={14} /> Sync Algorithm
              </div>
              <div className="space-y-3">
                {["Beat Detection", "Frequency Split", "Ambient Pulse", "Strobe (Warning)"].map((m, i) => {
                  const isActive = i === 1; // Keeping Frequency Split as default active for now
                  return (
                    <button 
                      key={m}
                      className={`w-full p-3 text-left text-[10px] uppercase tracking-widest border transition-all ${
                        isActive 
                        ? 'border-magenta-500 bg-magenta-500/10 text-magenta-500' 
                        : 'border-white/5 bg-white/5 text-white/40 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Real-time Light Feedback & Config */}
          <div className="vibe-card p-6 border-white/10 bg-white/5">
            <div className="vibe-label flex items-center gap-2 mb-6">
              <Activity size={14} /> Neural Feedback & Color Config
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(Object.entries(lights) as [string, LightState][]).map(([id, state]) => (
                <div key={id} className="space-y-3 p-3 border border-white/5 bg-white/5 rounded-xl">
                  <div className="relative aspect-square rounded-lg bg-black/40 flex items-center justify-center overflow-hidden">
                    <motion.div 
                      animate={{ 
                        scale: [1, 1 + audioData.amplitude * (state.brightness / 100), 1],
                        opacity: [0.1, 0.4 + (state.brightness / 200), 0.1]
                      }}
                      transition={{ duration: 0.1 }}
                      className="w-16 h-16 rounded-full blur-2xl"
                      style={{ backgroundColor: state.color }}
                    />
                    <Lightbulb size={20} className="relative z-10 text-white/20" />
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] uppercase tracking-widest text-white/40">{id}</span>
                      <input 
                        type="color" 
                        value={state.color}
                        onChange={(e) => updateLight(id, { color: e.target.value })}
                        className="w-4 h-4 rounded-full bg-transparent border-none cursor-pointer overflow-hidden"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] text-white/20 uppercase">
                        <span>Max Intensity</span>
                        <span>{state.brightness}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="100"
                        value={state.brightness}
                        onChange={(e) => updateLight(id, { brightness: parseInt(e.target.value) })}
                        className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-cyan-500"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
