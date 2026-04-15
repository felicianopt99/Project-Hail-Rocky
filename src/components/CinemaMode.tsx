import React from "react";
import { motion } from "motion/react";
import { Film, Lightbulb, Tv, Sliders, Eye } from "lucide-react";

export default function CinemaMode() {
  return (
    <div className="h-full w-full bg-black flex flex-col items-center justify-center p-12 relative overflow-hidden">
      {/* Cinematic Lighting Effect */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[120%] h-64 bg-gradient-to-b from-yellow-500/5 to-transparent blur-3xl pointer-events-none" />
      
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 z-10">
        {/* Left: Setup Visualization */}
        <div className="space-y-8">
          <div>
            <div className="vibe-label text-yellow-500 mb-2 flex items-center gap-2">
              <Film size={14} /> Cinema Configuration
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Theater Protocol 01</h1>
            <p className="text-white/40 mt-2 text-sm font-mono uppercase tracking-widest">Status: Optimized for Immersion</p>
          </div>

          <div className="vibe-card aspect-video border-white/5 bg-white/5 flex items-center justify-center relative overflow-hidden">
            {/* Top View Schematic */}
            <div className="absolute inset-0 opacity-10 pointer-events-none">
              <div className="absolute top-4 left-1/2 -translate-x-1/2 w-32 h-2 bg-white rounded-full" />
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-48 h-24 border-2 border-white rounded-t-3xl" />
            </div>
            
            <div className="text-center space-y-4">
              <Tv size={48} className="mx-auto text-white/20" />
              <div className="text-[10px] text-white/40 uppercase tracking-[0.3em]">Main Display: Active</div>
            </div>

            {/* Light Indicators */}
            <div className="absolute top-1/4 left-1/4 w-2 h-2 rounded-full bg-yellow-500/20 animate-pulse" />
            <div className="absolute top-1/4 right-1/4 w-2 h-2 rounded-full bg-yellow-500/20 animate-pulse" />
            <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-yellow-500/40 blur-md" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="vibe-card p-4 border-white/5 bg-white/5">
              <div className="vibe-label !text-[8px] opacity-40 mb-1">Projection</div>
              <div className="text-sm font-mono text-cyan-400">4K HDR / 24FPS</div>
            </div>
            <div className="vibe-card p-4 border-white/5 bg-white/5">
              <div className="vibe-label !text-[8px] opacity-40 mb-1">Audio Engine</div>
              <div className="text-sm font-mono text-magenta-400">ATMOS_7.1.4</div>
            </div>
          </div>
        </div>

        {/* Right: Light Controls */}
        <div className="space-y-6">
          <div className="vibe-card p-6 border-white/10 bg-white/5 space-y-8">
            <div className="flex justify-between items-center">
              <div className="vibe-label flex items-center gap-2">
                <Lightbulb size={14} className="text-yellow-500" /> Lighting Scene
              </div>
              <div className="text-[10px] font-mono text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded">DIMMED</div>
            </div>

            <div className="space-y-6">
              {[
                { name: "Main Ceiling", status: "OFF", val: 0 },
                { name: "Studio Flood", status: "OFF", val: 0 },
                { name: "Ambient Strip", status: "20%", val: 20, active: true },
                { name: "Desk Glow", status: "OFF", val: 0 }
              ].map((light, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between text-[10px] uppercase tracking-widest">
                    <span className={light.active ? "text-white" : "text-white/40"}>{light.name}</span>
                    <span className={light.active ? "text-yellow-500" : "text-white/20"}>{light.status}</span>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${light.val}%` }}
                      className={`h-full ${light.active ? "bg-yellow-500" : "bg-white/10"}`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-white/5 space-y-4">
              <div className="vibe-label flex items-center gap-2 opacity-40">
                <Sliders size={12} /> Scene Presets
              </div>
              <div className="grid grid-cols-2 gap-2">
                {["Total Dark", "Soft Glow", "Intermission", "Clean Up"].map((p, i) => {
                  const isActive = i === 1; // Soft Glow active by default
                  return (
                    <button 
                      key={p} 
                      className={`p-3 border text-[9px] uppercase tracking-widest transition-all ${
                        isActive 
                        ? 'border-yellow-500 bg-yellow-500/10 text-yellow-500' 
                        : 'border-white/5 bg-white/5 text-white/40 hover:border-white/20 hover:text-white'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="vibe-card p-6 border-white/10 bg-white/5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-yellow-500/10 flex items-center justify-center">
              <Eye size={20} className="text-yellow-500" />
            </div>
            <div>
              <div className="text-xs font-bold">Eye Comfort Mode</div>
              <div className="text-[10px] text-white/40">Blue light reduction active for long sessions.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
