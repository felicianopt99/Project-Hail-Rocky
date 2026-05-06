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
import { useWakeWord } from "./hooks/useWakeWord";
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

  const startWebRTCRef = useRef<((stream: MediaStream) => Promise<void>) | null>(null);

  const { audioState, analyzer, audioCtxRef, handleManualTrigger } = useAudioManager({
    socket,
    addToast,
    startWebRTC: (stream) => startWebRTCRef.current?.(stream)
  });

  const { isAudioActive: isPipelineActive, startWebRTC } = useAudioPipeline({ 
    socket, 
    addToast, 
    setStatus, 
    speakBrowserFallback, 
    lastAssistantTextRef,
    externalAudioCtxRef: audioCtxRef,
    externalAnalyzerRef: analyzer
  });

  // Keep the ref updated with the latest callback
  useEffect(() => {
    startWebRTCRef.current = startWebRTC;
  }, [startWebRTC]);

  const isAudioActive = useCallback(() => {
    return isPipelineActive() || ["speaking", "listening", "processing"].includes(audioState);
  }, [isPipelineActive, audioState]);

  useRockySockets(addToast, isAudioActive);
  useWakeWord();

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

  const [pendingAuth, setPendingAuth] = React.useState<any>(null);

  useEffect(() => {
    const handleAuthRequest = (req: any) => {
      console.log("[App] Auth request received:", req);
      setPendingAuth(req);
    };
    socket.on("REQUEST_CONFIRMATION", handleAuthRequest);
    return () => { socket.off("REQUEST_CONFIRMATION", handleAuthRequest); };
  }, []);

  const handleGrantAuth = () => {
    socket.emit("auth_granted", { tool_call_id: pendingAuth.tool_call_id });
    setPendingAuth(null);
  };

  const bannerStyle = STATUS_BANNER[audioState];
  const showBanner = audioState !== "idle" && !!bannerStyle;

  return (
    <div className="h-screen w-screen bg-black text-white overflow-hidden flex flex-col font-sans selection:bg-cyan-500/30">
      <AmbientBackground />

      <AnimatePresence>
        {pendingAuth && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
             <motion.div 
               initial={{ opacity: 0, scale: 0.9, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.9, y: 20 }}
               className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-[32px] p-8 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden"
             >
                <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-cyan-500 via-blue-500 to-indigo-500" />
                
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
                    <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                  </div>
                  <div>
                    <h2 className="text-xs font-black tracking-[0.3em] uppercase text-cyan-400">Security Protocols</h2>
                    <div className="text-[10px] text-white/30 uppercase tracking-widest font-mono">Authorization Required</div>
                  </div>
                </div>

                <div className="space-y-4 mb-8">
                  <p className="text-sm text-zinc-300 leading-relaxed">
                    Rocky is requesting to execute <span className="text-white font-bold bg-white/10 px-2 py-0.5 rounded-md font-mono">{pendingAuth.tool}</span> with the following parameters:
                  </p>
                  
                  <div className="bg-black/40 rounded-2xl p-5 border border-white/5 font-mono text-[11px] text-cyan-500/70 overflow-auto max-h-40 custom-scrollbar">
                    <pre>{JSON.stringify(pendingAuth.args, null, 2)}</pre>
                  </div>
                </div>
                
                <div className="flex gap-3">
                   <button 
                     onClick={() => setPendingAuth(null)}
                     className="flex-1 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white/40 text-[10px] font-black uppercase tracking-[0.2em] transition-all border border-white/5 active:scale-95"
                   >
                     Negative
                   </button>
                   <button 
                     onClick={handleGrantAuth}
                     className="flex-1 py-4 rounded-2xl bg-cyan-500 hover:bg-cyan-400 text-black text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-[0_0_30px_rgba(6,182,212,0.3)] active:scale-95"
                   >
                     Authorize
                   </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <header className="relative h-14 border-b border-white/6 flex items-center justify-between px-4 z-30 bg-black/30 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-full bg-linear-to-br from-cyan-500 to-blue-700 shadow-[0_0_16px_rgba(6,182,212,0.5)]" />
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
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/4 border border-white/6">
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
