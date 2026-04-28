import React, { useEffect, useRef, useCallback, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Settings } from "lucide-react";

import Dashboard from "./components/Dashboard";
import Visualizer from "./components/Visualizer";
import NeuralCenter from "./components/NeuralCenter";
import ProtocolsMode from "./components/ProtocolsMode";
import Controls from "./components/Controls";
import Chat from "./components/Chat";
import NavBar from "./components/NavBar";
import { ToastContainer, useToast } from "./components/Toast";
import AmbientBackground from "./components/AmbientBackground";

import { useAudioManager } from "./hooks/useAudioManager";
import { useRockySockets } from "./hooks/useRockySockets";
import { useMobile } from "./hooks/useMobile";
import { useRockyStore } from "./store/useRockyStore";
import socket from "./lib/socket";

const STATUS_LABEL: Record<string, string> = {
  listening: "Audio Input",
  processing: "Processing",
  speaking: "Speaking",
  error: "System Fault",
  idle: "Ready",
  requesting_mic: "Requesting Access",
};

const STATUS_BANNER: Record<string, { bg: string; dot: string; text: string }> = {
  listening: { bg: "bg-amber-500/10 border-b border-amber-500/20", dot: "bg-amber-400", text: "text-amber-400" },
  processing: { bg: "bg-teal-500/10 border-b border-teal-500/20", dot: "bg-teal-400", text: "text-teal-400" },
  speaking: { bg: "bg-amber-500/10 border-b border-amber-500/20", dot: "bg-amber-400", text: "text-amber-400" },
  error: { bg: "bg-red-500/10 border-b border-red-500/20", dot: "bg-red-400", text: "text-red-400" },
};

export default function App() {
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const isMobile = useMobile();
  const { toasts, addToast, removeToast } = useToast();
  const { mode, isConnected, latencyMs, inputValue, setInputValue } = useRockyStore();
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { audioState, analyzerRef, handleManualTrigger } = useAudioManager({
    socket,
    addToast,
  });

  useRockySockets(addToast);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleMicClick = useCallback(() => {
    console.log("[App] Mic clicked, audioState:", audioState);
    handleManualTrigger();
  }, [audioState, handleManualTrigger]);

  const bannerStyle = STATUS_BANNER[audioState];
  const showBanner = audioState !== "idle" && !!bannerStyle;

  return (
    <div className="h-screen w-screen bg-black text-white overflow-hidden flex flex-col font-sans selection:bg-cyan-500/30">
      <AmbientBackground />

      <header className="h-14 border-b border-white/[0.06] flex items-center justify-between px-4 z-30 bg-black/30 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-500 to-blue-700 shadow-[0_0_16px_rgba(6,182,212,0.5)]" />
            <motion.div
              animate={{ scale: [1, 1.25, 1], opacity: [0.9, 1, 0.9] }}
              transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="w-3 h-3 bg-white rounded-full" />
            </motion.div>
          </div>
          <span className="text-[13px] font-black tracking-[0.3em] uppercase text-white">Rocky</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full transition-all ${isConnected ? "bg-green-400 shadow-[0_0_5px_rgba(74,222,128,0.8)]" : "bg-red-400/60"}`} />
              <span className="text-[7px] font-mono text-white/25 uppercase tracking-wider">
                {latencyMs !== null ? `${latencyMs}ms` : "Net"}
              </span>
            </div>
          </div>

          <button
            onClick={() => setIsControlsOpen(true)}
            className="w-10 h-10 rounded-2xl flex items-center justify-center border border-transparent text-white/30 hover:text-white/70 hover:bg-white/5 active:bg-white/10 transition-all touch-manipulation"
            aria-label="Settings"
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {showBanner && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 36, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={`flex items-center justify-center gap-2.5 shrink-0 z-25 overflow-hidden ${bannerStyle.bg}`}
          >
            <motion.div
              className={`w-1.5 h-1.5 rounded-full ${bannerStyle.dot}`}
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
            />
            <span className={`text-[11px] font-bold tracking-[0.35em] uppercase ${bannerStyle.text}`}>
              {STATUS_LABEL[audioState]}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 relative z-20 overflow-hidden min-h-0">
        <AnimatePresence mode="wait">
          {mode === "dashboard" && (
            <motion.div key="dashboard" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} className="h-full w-full">
              <Dashboard />
            </motion.div>
          )}
          {mode === "visualizer" && (
            <motion.div key="visualizer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full w-full">
              <Visualizer analyzerNode={analyzerRef.current}>
                <Chat isOpen={true} onClose={() => {}} isUnified={true} onMicClick={handleMicClick} />
              </Visualizer>
            </motion.div>
          )}
          {mode === "protocols" && <ProtocolsMode analyzerNode={analyzerRef.current} />}
          {mode === "neural_center" && <NeuralCenter />}
        </AnimatePresence>
      </main>

      <NavBar onMicPress={handleMicClick} />
      <Controls isOpen={isControlsOpen} onClose={() => setIsControlsOpen(false)} />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div ref={chatEndRef} />
    </div>
  );
}
