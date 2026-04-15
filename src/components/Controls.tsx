import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lightbulb, Music, Power, Settings, X, User, Home, Zap, Bell, ShieldCheck } from "lucide-react";
import socket from "../lib/socket";

interface ControlsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LightState {
  status: "on" | "off";
  color: string;
  brightness: number;
}

export default function Controls({ isOpen, onClose }: ControlsProps) {
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

  const routines = [
    { id: "home", label: "I'm Home", icon: <Home size={14} />, color: "text-cyan-400" },
    { id: "away", label: "Leaving Home", icon: <ShieldCheck size={14} />, color: "text-red-400" },
    { id: "night", label: "Good Night", icon: <Zap size={14} />, color: "text-purple-400" },
    { id: "party", label: "Party Mode", icon: <Music size={14} />, color: "text-magenta-400" },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-40"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-85 bg-[#050505] border-l border-white/10 z-50 flex flex-col shadow-2xl"
          >
            {/* User Profile Header */}
            <div className="p-8 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                    <User size={24} className="text-cyan-400" />
                  </div>
                  <div>
                    <div className="text-xs font-bold tracking-widest uppercase text-white/40">Authorized User</div>
                    <div className="text-lg font-bold">Felizart PT</div>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-white/40 hover:text-white">
                  <X size={20} />
                </button>
              </div>
              <div className="flex gap-2">
                <div className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[8px] font-bold uppercase tracking-widest text-cyan-400">Admin</div>
                <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[8px] font-bold uppercase tracking-widest text-white/40">Verified Device</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
              {/* Routines */}
              <section>
                <div className="vibe-label flex items-center gap-2 mb-6 opacity-40">
                  <Zap size={12} /> Smart Routines
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {routines.map((r) => (
                    <button 
                      key={r.id}
                      className="vibe-card p-4 border-white/5 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all text-left flex flex-col gap-3 group"
                    >
                      <div className={`${r.color} opacity-60 group-hover:opacity-100 transition-opacity`}>
                        {r.icon}
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-widest">{r.label}</div>
                    </button>
                  ))}
                </div>
              </section>

              {/* System Preferences */}
              <section>
                <div className="vibe-label flex items-center gap-2 mb-6 opacity-40">
                  <Settings size={12} /> System Preferences
                </div>
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-bold uppercase tracking-widest">Voice Sensitivity</div>
                      <div className="text-[10px] text-white/40">Adjust Rocky's listening range</div>
                    </div>
                    <div className="text-xs font-mono text-cyan-400">High</div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-bold uppercase tracking-widest">Notifications</div>
                      <div className="text-[10px] text-white/40">Proactive system alerts</div>
                    </div>
                    <div className="w-8 h-4 bg-cyan-500/20 border border-cyan-500/50 rounded-full relative">
                      <div className="absolute right-1 top-1 w-2 h-2 bg-cyan-400 rounded-full" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-bold uppercase tracking-widest">Interface Theme</div>
                      <div className="text-[10px] text-white/40">Neural Cyberpunk (Default)</div>
                    </div>
                    <div className="text-[10px] text-white/20 uppercase tracking-widest">Change</div>
                  </div>
                </div>
              </section>

              {/* Security Status */}
              <section className="vibe-card p-4 border-white/5 bg-white/5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-green-500/10 text-green-500">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest">Security Stable</div>
                  <div className="text-[9px] text-white/40">All mesh nodes encrypted</div>
                </div>
              </section>
            </div>

            {/* Kill Switch */}
            <div className="p-8 border-t border-white/5 bg-black">
              <button className="w-full py-4 border border-red-500/30 bg-red-500/5 hover:bg-red-500/20 text-red-500 text-[10px] tracking-[0.3em] uppercase font-bold transition-all flex items-center justify-center gap-2 group">
                <Power size={14} className="group-hover:scale-110 transition-transform" /> Emergency Shutdown
              </button>
              <div className="text-[8px] text-center text-red-500/40 mt-3 uppercase tracking-widest">
                Immediate Hardware Disconnect
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
