import React, { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Music, Power, Settings, X, User, Home, Zap, ShieldCheck, Check, AlertTriangle } from "lucide-react";
import socket from "../lib/socket";
import { useMobile } from "../hooks/useMobile";

interface ControlsProps {
  isOpen: boolean;
  onClose: () => void;
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={value}
      className={`relative w-12 h-6 rounded-full transition-colors border touch-manipulation ${
        value ? "bg-cyan-500/20 border-cyan-500/50" : "bg-white/5 border-white/10"
      }`}
    >
      <motion.div
        animate={{ x: value ? 24 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`absolute top-1 w-4 h-4 rounded-full ${value ? "bg-cyan-400" : "bg-white/30"}`}
      />
    </button>
  );
}

export default function Controls({ isOpen, onClose }: ControlsProps) {
  const isMobile = useMobile();

  const [userName, setUserName] = useState(() => localStorage.getItem("rocky_username") || "Rocky User");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [proactivity, setProactivity] = useState(() => localStorage.getItem("rocky_proactivity") !== "false");
  const [notifications, setNotifications] = useState(() => localStorage.getItem("rocky_notifications") !== "false");
  const [sensitivity, setSensitivity] = useState(() => parseInt(localStorage.getItem("rocky_sensitivity") || "50"));

  // Shutdown double-confirm
  const [shutdownPending, setShutdownPending] = useState(false);
  const shutdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // Cancel shutdown pending after 3s
  useEffect(() => {
    if (shutdownPending) {
      shutdownTimerRef.current = setTimeout(() => setShutdownPending(false), 3000);
    }
    return () => { if (shutdownTimerRef.current) clearTimeout(shutdownTimerRef.current); };
  }, [shutdownPending]);

  const handleProactivityToggle = () => {
    const next = !proactivity;
    setProactivity(next);
    localStorage.setItem("rocky_proactivity", String(next));
    socket.emit("set_proactivity", next);
  };

  const handleNotificationsToggle = () => {
    const next = !notifications;
    setNotifications(next);
    localStorage.setItem("rocky_notifications", String(next));
  };

  const handleSensitivityChange = (value: number) => {
    setSensitivity(value);
    localStorage.setItem("rocky_sensitivity", String(value));
    socket.emit("set_sensitivity", {
      silenceThreshold: Math.round((100 - value) * 0.05),
      silenceTimeout: 600 + value * 20,
    });
  };

  const startEditName = () => {
    setEditNameValue(userName);
    setIsEditingName(true);
  };

  const commitEditName = () => {
    const trimmed = editNameValue.trim();
    if (trimmed) {
      setUserName(trimmed);
      localStorage.setItem("rocky_username", trimmed);
    }
    setIsEditingName(false);
  };

  const handleShutdown = () => {
    if (!shutdownPending) {
      setShutdownPending(true);
      return;
    }
    setShutdownPending(false);
    socket.emit("control_device", { device: "all", action: "off" });
    socket.emit("add_log", "Emergency shutdown: all lights off.");
    onClose();
  };

  const sensitivityLabel = (v: number) => {
    if (v <= 25) return "Low";
    if (v <= 50) return "Medium";
    if (v <= 75) return "High";
    return "Max";
  };

  const routines = [
    { id: "home",  label: "I'm Home",     icon: <Home size={16} />,       color: "text-cyan-400"   },
    { id: "away",  label: "Leaving Home", icon: <ShieldCheck size={16} />, color: "text-red-400"    },
    { id: "night", label: "Good Night",   icon: <Zap size={16} />,         color: "text-purple-400" },
    { id: "party", label: "Party Mode",   icon: <Music size={16} />,       color: "text-pink-400"   },
  ];

  // Motion variants: mobile = slide from bottom, desktop = slide from right
  const panelMotion = isMobile
    ? { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } }
    : { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" } };

  const panelClass = isMobile
    ? "fixed inset-x-0 bottom-0 max-h-[92vh] bg-[#050505] border-t border-white/10 z-50 flex flex-col shadow-2xl rounded-t-3xl overflow-hidden"
    : "fixed right-0 top-0 h-full w-full max-w-sm bg-[#050505] border-l border-white/10 z-50 flex flex-col shadow-2xl";

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
            {...panelMotion}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className={panelClass}
          >
            {/* Drag handle on mobile */}
            {isMobile && (
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-10 h-1 bg-white/20 rounded-full" />
              </div>
            )}

            {/* User Profile Header */}
            <div className="px-6 py-5 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent shrink-0">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
                    <User size={22} className="text-cyan-400" />
                  </div>
                  <div>
                    <div className="text-[9px] font-bold tracking-widest uppercase text-white/40 mb-1">Authorized User</div>
                    {isEditingName ? (
                      <div className="flex items-center gap-2">
                        <input
                          ref={nameInputRef}
                          value={editNameValue}
                          onChange={e => setEditNameValue(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") commitEditName(); if (e.key === "Escape") setIsEditingName(false); }}
                          className="bg-white/10 border border-cyan-500/40 rounded-lg px-2 py-1 text-sm font-bold focus:outline-none w-36"
                        />
                        <button onClick={commitEditName} className="w-8 h-8 flex items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 touch-manipulation">
                          <Check size={14} />
                        </button>
                        <button onClick={() => setIsEditingName(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 text-white/40 touch-manipulation">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="text-base font-bold">{userName}</div>
                        <button
                          onClick={startEditName}
                          className="text-[9px] uppercase tracking-widest text-white/25 hover:text-cyan-400 transition-colors px-1 py-0.5 touch-manipulation"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-10 h-10 flex items-center justify-center hover:bg-white/5 rounded-2xl transition-colors text-white/40 hover:text-white touch-manipulation"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex gap-2 mt-4">
                <div className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[8px] font-bold uppercase tracking-widest text-cyan-400">Admin</div>
                <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[8px] font-bold uppercase tracking-widest text-white/40">Verified Device</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 custom-scrollbar">
              {/* Routines */}
              <section>
                <div className="vibe-label flex items-center gap-2 mb-4 opacity-40">
                  <Zap size={11} /> Smart Routines
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {routines.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => { socket.emit("execute_routine", r.id); onClose(); }}
                      className="vibe-card p-4 border-white/5 bg-white/5 active:bg-cyan-500/10 active:border-cyan-500/30 transition-all text-left flex flex-col gap-3 group min-h-[80px] touch-manipulation"
                    >
                      <div className={`${r.color} opacity-60 group-active:opacity-100 transition-opacity`}>
                        {r.icon}
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-widest leading-tight">{r.label}</div>
                    </button>
                  ))}
                </div>
              </section>

              {/* System Preferences */}
              <section>
                <div className="vibe-label flex items-center gap-2 mb-4 opacity-40">
                  <Settings size={11} /> System Preferences
                </div>
                <div className="space-y-5">
                  {/* Voice Sensitivity */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-widest">Voice Sensitivity</div>
                        <div className="text-[10px] text-white/40 mt-0.5">Adjust Rocky's listening range</div>
                      </div>
                      <div className="text-sm font-mono text-cyan-400">{sensitivityLabel(sensitivity)}</div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={sensitivity}
                      onChange={(e) => handleSensitivityChange(parseInt(e.target.value))}
                      className="w-full h-2 bg-white/5 rounded-full appearance-none cursor-pointer accent-cyan-500"
                    />
                  </div>

                  {/* Proactive Assistant */}
                  <div className="flex items-center justify-between gap-4 py-1">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest">Proactive Assistant</div>
                      <div className="text-[10px] text-white/40 mt-0.5">Rocky speaks without being asked</div>
                    </div>
                    <Toggle value={proactivity} onChange={handleProactivityToggle} />
                  </div>

                  {/* Notifications */}
                  <div className="flex items-center justify-between gap-4 py-1">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest">Notifications</div>
                      <div className="text-[10px] text-white/40 mt-0.5">Proactive system alerts</div>
                    </div>
                    <Toggle value={notifications} onChange={handleNotificationsToggle} />
                  </div>
                </div>
              </section>

              {/* Security */}
              <section className="vibe-card p-4 border-white/5 bg-white/5 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-green-500/10 text-green-500 shrink-0">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest">Security Stable</div>
                  <div className="text-[9px] text-white/40 mt-0.5">All mesh nodes encrypted</div>
                </div>
              </section>
            </div>

            {/* Kill Switch */}
            <div className="px-6 py-5 border-t border-white/5 bg-black shrink-0">
              <AnimatePresence mode="wait">
                {shutdownPending ? (
                  <motion.button
                    key="confirm"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={handleShutdown}
                    className="w-full py-4 border-2 border-red-500/70 bg-red-500/20 text-red-400 text-[11px] tracking-[0.25em] uppercase font-bold transition-all flex items-center justify-center gap-2 rounded-sm touch-manipulation"
                  >
                    <AlertTriangle size={15} /> Tap again to confirm
                  </motion.button>
                ) : (
                  <motion.button
                    key="initial"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    onClick={handleShutdown}
                    className="w-full py-4 border border-red-500/30 bg-red-500/5 active:bg-red-500/20 text-red-500 text-[10px] tracking-[0.3em] uppercase font-bold transition-all flex items-center justify-center gap-2 group rounded-sm touch-manipulation"
                  >
                    <Power size={14} /> Emergency Shutdown
                  </motion.button>
                )}
              </AnimatePresence>
              <div className="text-[8px] text-center text-red-500/30 mt-2 uppercase tracking-widest">
                {shutdownPending ? "Action will expire in 3 seconds" : "Immediate Hardware Disconnect"}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
