import React, { useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Settings } from "lucide-react";

import Dashboard from "./components/Dashboard";
import Visualizer from "./components/Visualizer";
import NeuralCenter from "./components/NeuralCenter";
import ProtocolsMode from "./components/ProtocolsMode";
import SkillsPage from "./components/SkillsPage";
import MemoriesPage from "./components/MemoriesPage";
import SettingsPage from "./components/SettingsPage";
import Chat from "./components/Chat";
import NavBar from "./components/NavBar";
import { ToastContainer, useToast } from "./components/Toast";
import AmbientBackground from "./components/AmbientBackground";

import { useAudioManager } from "./hooks/useAudioManager";
import { useAudioPipeline } from "./hooks/useAudioPipeline";
import { useRockySockets } from "./hooks/useRockySockets";
import { useMobile } from "./hooks/useMobile";
import { useRockyStore } from "./store/useRockyStore";
import socket from "./lib/socket";
import { eventBus, RockyEvents } from "./lib/eventBus";

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
  const isMobile = useMobile();
  const { toasts, addToast, removeToast } = useToast();
  const { mode, isConnected, latencyMs, inputValue, setInputValue, setStatus, messages, setMode } = useRockyStore();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const lastAssistantTextRef = useRef<string>("");

  // Track last assistant message for browser TTS fallback
  React.useEffect(() => {
    const last = messages.filter(m => m.role === "model").at(-1);
    if (last) lastAssistantTextRef.current = last.text;
  }, [messages]);

  const speakBrowserFallback = useCallback((text: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  }, []);

  const { audioState, analyzer, handleManualTrigger } = useAudioManager({
    socket,
    addToast,
  });

  const { isAudioActive } = useAudioPipeline({ socket, addToast, setStatus, speakBrowserFallback, lastAssistantTextRef });

  useRockySockets(addToast, isAudioActive);

  const handleSendMessage = useCallback((text?: string) => {
    const msg = text || inputValue;
    if (!msg.trim()) return;

    console.log("[App] Sending chat request:", msg);
    socket.emit("chat_request", { content: msg });
    setInputValue("");
  }, [inputValue, setInputValue]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });

    const handleMouseMove = (e: MouseEvent) => {
      document.documentElement.style.setProperty("--mouse-x", `${e.clientX}px`);
      document.documentElement.style.setProperty("--mouse-y", `${e.clientY}px`);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);


  const handleMicClick = useCallback(() => {
    console.log("[App] Mic clicked, audioState:", audioState);
    if (mode !== "visualizer") {
      useRockyStore.getState().setMode("visualizer");
    }
    handleManualTrigger();
  }, [audioState, handleManualTrigger, mode]);

  // Wake word detected on server → activate browser mic
  useEffect(() => {
    const onWake = () => handleMicClick();
    eventBus.on(RockyEvents.WAKE_WORD_DETECTED, onWake);
    return () => { eventBus.off(RockyEvents.WAKE_WORD_DETECTED, onWake); };
  }, [handleMicClick]);

  const bannerStyle = STATUS_BANNER[audioState];
  const showBanner = audioState !== "idle" && !!bannerStyle;

  return (
    <div className="h-screen w-screen bg-black text-white overflow-hidden flex flex-col font-sans selection:bg-cyan-500/30">
      <AmbientBackground />

      <header className="relative h-14 border-b border-white/[0.06] flex items-center justify-between px-4 z-30 bg-black/30 backdrop-blur-xl shrink-0">
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
            onClick={() => setMode(mode === "settings" ? "dashboard" : "settings")}
            className={`w-10 h-10 rounded-2xl flex items-center justify-center border transition-all touch-manipulation ${
              mode === "settings"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border-transparent text-white/30 hover:text-white/70 hover:bg-white/5 active:bg-white/10"
            }`}
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
              <Visualizer analyzerNode={analyzer}>
                <Chat isOpen={true} onClose={() => {}} isUnified={true} onMicClick={handleMicClick} onSendMessage={handleSendMessage} />
              </Visualizer>
            </motion.div>
          )}
          {mode === "protocols" && <ProtocolsMode analyzerNode={analyzer} />}
          {mode === "neural_center" && <NeuralCenter />}
          {mode === "skills" && (
            <motion.div key="skills" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full w-full">
              <SkillsPage />
            </motion.div>
          )}
          {mode === "memories" && (
            <motion.div key="memories" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full w-full">
              <MemoriesPage />
            </motion.div>
          )}
          {mode === "settings" && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full w-full">
              <SettingsPage />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <NavBar onMicPress={handleMicClick} />
<ToastContainer toasts={toasts} onRemove={removeToast} />
      <div ref={chatEndRef} />
    </div>
  );
}
