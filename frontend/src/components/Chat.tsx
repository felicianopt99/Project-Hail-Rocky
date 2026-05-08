import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Send, X, Cpu, Sparkles, Activity, Mic } from "lucide-react";
import { useMessages, useInputValue, useIsTyping, useRockyStore } from "../store/useRockyStore";
import RichCard from "./widgets/RichCard";

const TYPING_DELAYS = [0, 0.2, 0.4];
const DOT_ANIMATE = { scale: [1, 1.6, 1], opacity: [0.5, 1, 0.5] };
const DOT_TRANSITION = { repeat: Infinity, duration: 1 };

function parseJSONSafely(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface ChatProps {
  isOpen: boolean;
  onClose: () => void;
  isEmbedded?: boolean;
  isUnified?: boolean;
  onMicClick?: () => void;
  onSendMessage: (text?: string) => void;
}

export default function Chat({
  isOpen,
  onClose,
  isEmbedded,
  isUnified,
  onMicClick,
  onSendMessage
}: ChatProps) {
  const messages = useMessages();
  const inputValue = useInputValue();
  const isTyping = useIsTyping();
  const setInputValue = useRockyStore((s) => s.setInputValue);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  // Derive container classes
  const containerClasses = isUnified
    ? "w-full max-w-4xl h-[70vh] bg-transparent flex flex-col pointer-events-auto mt-[-5vh]"
    : isEmbedded
      ? "absolute inset-y-0 right-0 w-full md:w-[450px] bg-transparent"
      : "h-full w-full premium-glass flex flex-col overflow-hidden rounded-t-3xl md:rounded-3xl";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={isUnified ? { opacity: 0, y: 20 } : { opacity: 1 }}
          animate={isUnified ? { opacity: 1, y: 0 } : { opacity: 1 }}
          exit={isUnified ? { opacity: 0, y: 20 } : { opacity: 1 }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className={containerClasses}
        >
          {/* Drag handle — visible on mobile bottom sheet */}
          {!isUnified && !isEmbedded && (
            <div className="flex justify-center pt-3 pb-1 shrink-0 md:hidden">
              <div className="w-10 h-1 bg-white/20 rounded-full" />
            </div>
          )}

          {/* Header */}
          {!isEmbedded && !isUnified && (
            <div className="px-5 py-4 border-b border-white/[0.08] flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-9 h-9 rounded-2xl bg-cyan-500/20 flex items-center justify-center border border-cyan-500/40">
                    <Activity size={16} className="text-cyan-400" />
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-black rounded-full" />
                </div>
                <div>
                  <div className="vibe-label leading-none mb-1 text-cyan-400/70">Neural Processor</div>
                  <div className="text-[11px] font-bold text-white/90 flex items-center gap-2">
                    CORE_v3.0.0
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(34,197,94,0.8)]" />
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-2xl text-white/30 hover:text-white active:bg-white/10 transition-colors touch-manipulation"
                aria-label="Close chat"
              >
                <X size={18} />
              </button>
            </div>
          )}

          {/* Messages */}
          <div className={`flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar ${isUnified ? "mask-fade-edges" : ""}`}>
            {messages.length === 0 && !isUnified && (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                <Sparkles size={32} className="mb-4 text-cyan-500" />
                <div className="text-xs uppercase tracking-widest font-bold mb-2">System Ready</div>
                <p className="text-[11px] leading-relaxed">Type a command or tap the mic to speak, yes?</p>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <motion.div
                  key={`${msg.timestamp || i}-${msg.role}`}
                  initial={{ opacity: 0, y: 10, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-[88%] flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                    <div className="flex items-center gap-2 mb-1.5 px-1">
                      {msg.role === "model" && <Cpu size={10} className="text-cyan-400" />}
                      <span className="text-[9px] uppercase tracking-widest font-bold opacity-30">
                        {msg.role === "user" ? "Transmission" : "Rocky Response"}
                      </span>
                    </div>

                    <div className={`px-4 py-3.5 rounded-3xl text-[13px] leading-relaxed relative ${
                      msg.role === "user"
                        ? "bg-cyan-500/15 border border-cyan-500/30 text-cyan-50 rounded-tr-none shadow-[0_4px_15px_rgba(0,255,255,0.05)]"
                        : "bg-white/5 border border-white/10 text-white/95 rounded-tl-none backdrop-blur-2xl"
                    }`}>
                      {msg.text.startsWith("{") && (msg.text.includes('"type":') || msg.text.includes("'type':")) ? (
                        <RichCard data={parseJSONSafely(msg.text)} />
                      ) : (
                        msg.text
                      )}

                      {msg.role === "model" && (
                        <div className="absolute top-0 left-0 w-full h-full overflow-hidden rounded-2xl pointer-events-none opacity-10">
                          <div className="w-full h-1 bg-cyan-400/20 animate-[scan_3s_linear_infinite]" />
                        </div>
                      )}
                    </div>

                    {msg.timestamp && (
                      <div className={`text-[9px] text-white/25 mt-1 px-1 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isTyping && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="bg-white/5 border border-white/10 px-4 py-3 rounded-2xl rounded-tl-none">
                  <div className="flex gap-1.5 items-center">
                    {TYPING_DELAYS.map((delay, i) => (
                      <motion.div
                        key={i}
                        animate={DOT_ANIMATE}
                        transition={{ ...DOT_TRANSITION, delay }}
                        className="w-1.5 h-1.5 bg-cyan-400 rounded-full"
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className={`px-4 py-4 shrink-0 ${isUnified ? "bg-transparent" : "border-t border-white/[0.06] bg-black/20 backdrop-blur-2xl"}`}>
            <div className="relative flex items-center gap-2 max-w-3xl mx-auto">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSendMessage()}
                placeholder="Talk to Rocky..."
                className={`flex-1 min-w-0 rounded-2xl py-4 px-5 text-[14px] focus:outline-none transition-all backdrop-blur-3xl placeholder:text-white/20 ${
                  isUnified
                    ? "bg-white/5 border border-white/20 focus:border-cyan-500/50"
                    : "bg-white/[0.06] border border-white/10 focus:border-cyan-500/40"
                }`}
              />
              {/* Mic button */}
              <button
                onPointerDown={onMicClick}
                className="w-12 h-12 rounded-2xl flex items-center justify-center bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 active:bg-cyan-500/25 transition-all touch-manipulation shrink-0"
                aria-label="Voice command"
              >
                <Mic size={20} />
              </button>
              {/* Send button — only visible when input has text */}
              <AnimatePresence>
                {inputValue.trim() && (
                  <motion.button
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    onClick={() => onSendMessage()}
                    className="w-12 h-12 rounded-2xl flex items-center justify-center bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 active:bg-cyan-500/35 transition-all touch-manipulation shrink-0"
                    aria-label="Send message"
                  >
                    <Send size={18} />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
