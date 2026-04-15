import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Activity, Sliders, Zap, Shield, Moon, Sun, Save } from "lucide-react";
import socket from "../lib/socket";

interface Protocol {
  id: string;
  label: string;
  desc: string;
  color: string;
  activeColor: string;
  icon: React.ReactNode;
}

export default function ProtocolsMode() {
  const [currentMode, setCurrentMode] = useState("dashboard");
  const [editingProtocol, setEditingProtocol] = useState<string | null>(null);

  useEffect(() => {
    socket.on("initial_state", (data: any) => {
      setCurrentMode(data.systemMode);
    });

    socket.on("mode_updated", (mode: string) => {
      setCurrentMode(mode);
    });

    return () => {
      socket.off("initial_state");
      socket.off("mode_updated");
    };
  }, []);

  const protocols: Protocol[] = [
    { 
      id: "cinema", 
      label: "Cinema Mode", 
      desc: "Optimized for theater immersion", 
      color: "text-yellow-500",
      activeColor: "border-yellow-500 bg-yellow-500/10",
      icon: <Zap size={20} />
    },
    { 
      id: "music", 
      label: "Music Sync", 
      desc: "Reactive light engine", 
      color: "text-magenta-500",
      activeColor: "border-magenta-500 bg-magenta-500/10",
      icon: <Activity size={20} />
    },
    { 
      id: "sunset", 
      label: "Sunset Mode", 
      desc: "Warm atmospheric fade", 
      color: "text-orange-500",
      activeColor: "border-orange-500 bg-orange-500/10",
      icon: <Moon size={20} />
    }
  ];

  return (
    <div className="h-full w-full bg-black p-8 overflow-y-auto custom-scrollbar">
      <div className="max-w-6xl mx-auto space-y-8">
        <header>
          <div className="vibe-label text-cyan-400 mb-2 flex items-center gap-2">
            <Sliders size={14} /> System Protocols
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Protocol Management</h1>
          <p className="text-white/40 mt-2 text-sm">Configure and deploy neural environment presets, yes?</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Protocol List */}
          <div className="lg:col-span-1 space-y-4">
            <div className="vibe-label opacity-40 mb-4">Available Protocols</div>
            {protocols.map((p) => (
              <div 
                key={p.id}
                className={`vibe-card p-6 border transition-all relative group ${
                  currentMode === p.id 
                  ? p.activeColor 
                  : "border-white/5 bg-white/5 hover:border-white/20"
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-3 rounded-xl bg-black/40 ${p.color}`}>
                    {p.icon}
                  </div>
                  {currentMode === p.id && (
                    <div className="px-2 py-1 rounded bg-white/10 text-[8px] font-bold uppercase tracking-widest text-white">Active</div>
                  )}
                </div>
                
                <h3 className="text-lg font-bold mb-1">{p.label}</h3>
                <p className="text-xs text-white/40 mb-6">{p.desc}</p>

                <div className="flex gap-2">
                  <button 
                    onClick={() => socket.emit("set_mode", p.id)}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                      currentMode === p.id 
                      ? "bg-white text-black" 
                      : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {currentMode === p.id ? "Running" : "Deploy"}
                  </button>
                  <button 
                    onClick={() => setEditingProtocol(p.id)}
                    className="p-2 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 hover:text-white transition-all"
                  >
                    <Sliders size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Configuration Panel */}
          <div className="lg:col-span-2">
            <AnimatePresence mode="wait">
              {editingProtocol ? (
                <motion.div 
                  key={editingProtocol}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="vibe-card p-8 border-white/10 bg-white/5 h-full flex flex-col"
                >
                  <div className="flex justify-between items-center mb-8">
                    <div>
                      <div className="vibe-label opacity-40 mb-1">Configuring</div>
                      <h2 className="text-2xl font-bold">{protocols.find(p => p.id === editingProtocol)?.label}</h2>
                    </div>
                    <button 
                      onClick={() => setEditingProtocol(null)}
                      className="text-white/40 hover:text-white transition-colors"
                    >
                      <Save size={20} />
                    </button>
                  </div>

                  <div className="space-y-8 flex-1">
                    {/* Common Settings */}
                    <section className="space-y-6">
                      <div className="vibe-label flex items-center gap-2">
                        <Zap size={14} className="text-yellow-500" /> Core Parameters
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <label className="text-[10px] uppercase tracking-widest text-white/40">Base Brightness</label>
                          <input type="range" className="w-full h-1 bg-white/10 rounded-full appearance-none accent-cyan-500" />
                        </div>
                        <div className="space-y-3">
                          <label className="text-[10px] uppercase tracking-widest text-white/40">Transition Speed</label>
                          <input type="range" className="w-full h-1 bg-white/10 rounded-full appearance-none accent-cyan-500" />
                        </div>
                      </div>
                    </section>

                    {/* Mode Specific Settings */}
                    {editingProtocol === "sunset" && (
                      <section className="space-y-6 pt-8 border-t border-white/5">
                        <div className="vibe-label flex items-center gap-2">
                          <Sun size={14} className="text-orange-500" /> Oscillation Range
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="vibe-card p-4 border-white/5 bg-white/5 space-y-3">
                            <div className="text-[9px] uppercase tracking-widest text-white/40">Start Color</div>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-orange-600" />
                              <span className="text-xs font-mono">#EA580C</span>
                            </div>
                          </div>
                          <div className="vibe-card p-4 border-white/5 bg-white/5 space-y-3">
                            <div className="text-[9px] uppercase tracking-widest text-white/40">End Color</div>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-purple-600" />
                              <span className="text-xs font-mono">#9333EA</span>
                            </div>
                          </div>
                        </div>
                      </section>
                    )}

                    {editingProtocol === "music" && (
                      <section className="space-y-6 pt-8 border-t border-white/5">
                        <div className="vibe-label flex items-center gap-2">
                          <Activity size={14} className="text-magenta-500" /> Neural Sensitivity
                        </div>
                        <div className="space-y-4">
                          {["Bass Response", "Treble Spark", "Ambient Pulse"].map((s) => (
                            <div key={s} className="flex items-center justify-between">
                              <span className="text-xs text-white/60">{s}</span>
                              <div className="w-48 h-1 bg-white/10 rounded-full relative">
                                <div className="absolute h-full w-2/3 bg-magenta-500" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>

                  <div className="mt-auto pt-8 border-t border-white/5 flex justify-end gap-4">
                    <button 
                      onClick={() => setEditingProtocol(null)}
                      className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => setEditingProtocol(null)}
                      className="px-6 py-2 bg-cyan-500 text-black text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-cyan-400 transition-colors"
                    >
                      Apply Changes
                    </button>
                  </div>
                </motion.div>
              ) : (
                <div className="vibe-card p-8 border-white/5 bg-white/5 h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-white/20">
                    <Shield size={32} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Select a Protocol</h3>
                    <p className="text-xs text-white/40 max-w-xs mx-auto">Click the slider icon on any protocol to begin hardware configuration, yes?</p>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
