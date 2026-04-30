import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { LayoutDashboard, Cpu, Mic } from "lucide-react";
import { useMode, useStatus, useRockyStore, AppMode, RockyStatus } from "../store/useRockyStore";

interface NavBarProps {
  onMicPress: () => void;
}

const NEURAL_MODES: AppMode[] = ["neural_center", "protocols"];

const FAB_STYLES: Record<RockyStatus, { ring: string; icon: string; pulse: boolean }> = {
  idle:            { ring: "border-white/25 bg-white/[0.07]",                                                icon: "text-white/50",      pulse: false },
  listening:       { ring: "border-green-500/70 bg-green-500/20 shadow-[0_0_28px_rgba(74,222,128,0.4)]",    icon: "text-green-400",     pulse: true  },
  processing_stt:  { ring: "border-cyan-500/70 bg-cyan-500/20 shadow-[0_0_28px_rgba(0,255,255,0.4)]",       icon: "text-cyan-400",      pulse: true  },
  thinking_llm:    { ring: "border-purple-500/70 bg-purple-500/20 shadow-[0_0_28px_rgba(168,85,247,0.4)]",  icon: "text-purple-400",    pulse: true  },
  synthesizing_tts:{ ring: "border-amber-500/70 bg-amber-500/20 shadow-[0_0_28px_rgba(245,158,11,0.4)]",    icon: "text-amber-400",     pulse: true  },
  hot_mic:         { ring: "border-green-500/40 bg-green-500/8 shadow-[0_0_15px_rgba(74,222,128,0.2)]",     icon: "text-green-300/80",  pulse: true  },
  error:           { ring: "border-red-500/70 bg-red-500/20 shadow-[0_0_28px_rgba(239,68,68,0.4)]",         icon: "text-red-400",       pulse: false },
};

export default function NavBar({ onMicPress }: NavBarProps) {
  const mode = useMode();
  const status = useStatus();
  const setMode = useRockyStore(s => s.setMode);

  const fab = FAB_STYLES[status];
  const isDashboard = mode === "dashboard";
  const isNeural = NEURAL_MODES.includes(mode);
  const isVisualizer = mode === "visualizer";

  const handleFabPress = () => {
    // Navigate to visualizer (the combined voice + chat screen) and trigger mic
    setMode("visualizer");
    onMicPress();
  };

  return (
    <nav className="h-20 border-t border-white/[0.06] bg-black/80 backdrop-blur-2xl flex items-center px-4 z-30 shrink-0">

      {/* Dashboard tab */}
      <motion.button
        onClick={() => setMode("dashboard")}
        whileTap={{ scale: 0.85 }}
        className="relative flex flex-col items-center justify-center gap-1 flex-1 min-h-[56px] py-2 touch-manipulation"
      >
        {isDashboard && (
          <motion.div
            layoutId="nav-pill"
            className="absolute inset-x-1.5 inset-y-1 rounded-2xl bg-cyan-500/10 border border-cyan-500/20"
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />
        )}
        <LayoutDashboard
          size={20}
          className={`relative z-10 transition-colors duration-200 ${isDashboard ? "text-cyan-400 drop-shadow-[0_0_8px_rgba(0,255,255,0.7)]" : "text-white/30"}`}
        />
        <span className={`relative z-10 text-[8px] font-bold tracking-[0.1em] uppercase transition-colors duration-200 ${isDashboard ? "text-cyan-400/80" : "text-white/20"}`}>
          Home
        </span>
      </motion.button>

      {/* Central mic FAB — goes to Visualizer + triggers mic */}
      <div className="flex items-center justify-center flex-1">
        <motion.button
          onPointerDown={handleFabPress}
          whileTap={{ scale: 0.88 }}
          className={`relative w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all touch-manipulation ${fab.ring} ${isVisualizer ? "scale-110" : ""}`}
          aria-label="Voice & Chat"
        >
          <AnimatePresence>
            {fab.pulse && (
              <div
                key="pulse"
                className="absolute inset-0 rounded-full border-2 border-current animate-ping"
              />
            )}
          </AnimatePresence>
          {/* Active ring when in visualizer mode */}
          {isVisualizer && (
            <div className="absolute inset-[-4px] rounded-full border border-cyan-500/30 animate-pulse" />
          )}
          <Mic size={24} className={`${fab.icon} transition-colors relative z-10`} />
        </motion.button>
      </div>

      {/* Neural Center tab */}
      <motion.button
        onClick={() => setMode("neural_center")}
        whileTap={{ scale: 0.85 }}
        className="relative flex flex-col items-center justify-center gap-1 flex-1 min-h-[56px] py-2 touch-manipulation"
      >
        {isNeural && (
          <motion.div
            layoutId="nav-pill"
            className="absolute inset-x-1.5 inset-y-1 rounded-2xl bg-cyan-500/10 border border-cyan-500/20"
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />
        )}
        <Cpu
          size={20}
          className={`relative z-10 transition-colors duration-200 ${isNeural ? "text-cyan-400 drop-shadow-[0_0_8px_rgba(0,255,255,0.7)]" : "text-white/30"}`}
        />
        <span className={`relative z-10 text-[8px] font-bold tracking-[0.1em] uppercase transition-colors duration-200 ${isNeural ? "text-cyan-400/80" : "text-white/20"}`}>
          Neural
        </span>
      </motion.button>
    </nav>
  );
}
