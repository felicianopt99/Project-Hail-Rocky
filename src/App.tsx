import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Menu, Mic, MicOff, Send, Terminal, User } from "lucide-react";
import Dashboard from "./components/Dashboard";
import Visualizer from "./components/Visualizer";
import MusicMode from "./components/MusicMode";
import CinemaMode from "./components/CinemaMode";
import ProtocolsMode from "./components/ProtocolsMode";
import Controls from "./components/Controls";
import socket from "./lib/socket";
import { chatWithRocky } from "./lib/rockyService";

interface Message {
  role: "user" | "model";
  text: string;
}

type AppMode = "dashboard" | "visualizer" | "cinema" | "music" | "sunset" | "protocols";

export default function App() {
  const [mode, setMode] = useState<AppMode>("dashboard");
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isListening, setIsListening] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    socket.on("mode_updated", (newMode: AppMode) => {
      setMode(newMode);
    });

    socket.on("proactive_alert", (data: { message: string }) => {
      setMessages(prev => {
        // Avoid duplicate messages if they are identical and recent
        if (prev.length > 0 && prev[prev.length - 1].text === data.message) return prev;
        return [...prev, { role: "model", text: data.message }];
      });
      // Optionally switch to visualizer to show Rocky's message
      // setMode("visualizer");
    });

    return () => {
      socket.off("mode_updated");
      socket.off("proactive_alert");
    };
  }, []);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMsg: Message = { role: "user", text: inputValue };
    setMessages(prev => [...prev, userMsg]);
    setInputValue("");
    setIsTyping(true);
    setMode("visualizer"); // Switch to visualizer when talking

    const history = messages.map(m => ({
      role: m.role,
      parts: [{ text: m.text }]
    }));

    const response = await chatWithRocky(inputValue, history);
    
    setMessages(prev => [...prev, { role: "model", text: response }]);
    setIsTyping(false);
  };

  // Simulate wake word detection for demo purposes
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && inputValue) {
        handleSendMessage();
      }
      if (e.key === "Escape") {
        setMode("dashboard");
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [inputValue, messages]);

  return (
    <div className="relative h-screen w-screen bg-black text-white overflow-hidden flex flex-col">
      {/* Effects Layers */}
      <div className="scanlines" />
      <div className="crt-glow" />

      {/* Header */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 z-30 bg-black/50 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center border border-cyan-500/50">
            <Terminal size={16} className="text-cyan-400" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/40 leading-none">Project</div>
            <div className="text-sm font-bold tracking-tight">HAIL ROCKY <span className="text-cyan-400 font-mono text-[10px] ml-1">v1.0.4</span></div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden lg:flex items-center bg-white/5 rounded-full p-1 border border-white/10">
            {(["dashboard", "visualizer", "protocols"] as const).map((m) => {
              const isActive = m === "protocols" 
                ? ["protocols", "cinema", "music", "sunset"].includes(mode)
                : mode === m;
              
              return (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    // Only emit set_mode for main categories if they aren't protocols
                    // Protocols management view doesn't necessarily change the light state until "Deploy"
                    if (m !== "protocols") {
                      socket.emit("set_mode", m);
                    }
                  }}
                  className={`px-3 py-1 rounded-full text-[9px] uppercase tracking-widest transition-all ${
                    isActive ? "bg-cyan-500 text-black font-bold" : "text-white/40 hover:text-white"
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>

          <button 
            onClick={() => setIsListening(!isListening)}
            className={`flex items-center gap-2 transition-colors ${isListening ? 'text-cyan-400' : 'text-red-500'}`}
          >
            {isListening ? <Mic size={16} /> : <MicOff size={16} />}
            <span className="vibe-label hidden md:block">{isListening ? 'Listening' : 'Muted'}</span>
          </button>
          
          <button 
            onClick={() => setIsControlsOpen(true)}
            className="text-white/40 hover:text-white transition-colors"
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative z-20 flex overflow-hidden">
        {/* Left Side: Visualizer/Dashboard/Cinema/Music */}
        <div className="flex-1 relative">
          <AnimatePresence mode="wait">
            {mode === "dashboard" && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="h-full w-full"
              >
                <Dashboard />
              </motion.div>
            )}
            {mode === "visualizer" && (
              <motion.div
                key="visualizer"
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="h-full w-full"
              >
                <Visualizer />
              </motion.div>
            )}
            {mode === "music" && (
              <motion.div
                key="music"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4 }}
                className="h-full w-full"
              >
                <MusicMode />
              </motion.div>
            )}
            {mode === "cinema" && (
              <motion.div
                key="cinema"
                initial={{ opacity: 0, filter: "blur(10px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(10px)" }}
                transition={{ duration: 0.6 }}
                className="h-full w-full"
              >
                <CinemaMode />
              </motion.div>
            )}
            {mode === "protocols" && (
              <motion.div
                key="protocols"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="h-full w-full"
              >
                <ProtocolsMode />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Side: Chat Interface (Visible in Visualizer Mode) */}
        <AnimatePresence>
          {mode === "visualizer" && (
            <motion.div
              initial={{ x: 400, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 400, opacity: 0 }}
              className="w-96 border-l border-white/10 bg-black/40 backdrop-blur-xl flex flex-col"
            >
              <div className="p-4 border-b border-white/10 flex justify-between items-center">
                <div className="vibe-label">Neural Link: Rocky</div>
                <button onClick={() => setMode("dashboard")} className="text-white/20 hover:text-white">
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] p-3 rounded-lg text-xs leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-100' 
                        : 'bg-white/5 border border-white/10 text-white/80'
                    }`}>
                      <div className="vibe-label mb-1 opacity-50">{msg.role === 'user' ? 'Human' : 'Rocky'}</div>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-white/5 border border-white/10 p-3 rounded-lg">
                      <div className="flex gap-1">
                        <div className="w-1 h-1 bg-cyan-400 rounded-full animate-bounce" />
                        <div className="w-1 h-1 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <div className="w-1 h-1 bg-cyan-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-4 border-t border-white/10">
                <div className="relative">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Type command, yes?"
                    className="w-full bg-white/5 border border-white/10 rounded-lg py-3 px-4 pr-12 text-xs focus:outline-none focus:border-cyan-500/50 transition-colors"
                  />
                  <button 
                    onClick={handleSendMessage}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer / Status Bar */}
      <footer className="h-8 border-t border-white/10 flex items-center justify-between px-6 z-30 bg-black/50 text-[9px] uppercase tracking-[0.2em] text-white/30 font-mono">
        <div className="flex gap-4">
          <span>LOC: STUDIO_A</span>
          <span>NET: LOCAL_MESH_STABLE</span>
        </div>
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
            <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
            OLLAMA_ACTIVE
          </span>
          <span>MEM: 12GB_TOTAL</span>
        </div>
      </footer>

      {/* Controls Panel */}
      <Controls 
        isOpen={isControlsOpen} 
        onClose={() => setIsControlsOpen(false)} 
      />

      {/* Mode Toggle Button (Mobile/Tablet friendly) */}
      <button 
        onClick={() => {
          const mainModes: AppMode[] = ["dashboard", "visualizer", "protocols"];
          const currentMainIndex = ["protocols", "cinema", "music", "sunset"].includes(mode)
            ? mainModes.indexOf("protocols")
            : mainModes.indexOf(mode);
            
          const nextIndex = (currentMainIndex + 1) % mainModes.length;
          const nextMode = mainModes[nextIndex];
          
          setMode(nextMode);
          if (nextMode !== "protocols") {
            socket.emit("set_mode", nextMode);
          }
        }}
        className="fixed bottom-12 right-8 w-14 h-14 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center z-40 hover:bg-cyan-500/20 transition-all active:scale-90"
      >
        <div className={`w-2 h-2 rounded-full ${mode !== 'dashboard' ? 'bg-cyan-400 shadow-[0_0_10px_rgba(0,255,255,0.5)]' : 'bg-white/20'}`} />
      </button>
    </div>
  );
}

const X = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
);
