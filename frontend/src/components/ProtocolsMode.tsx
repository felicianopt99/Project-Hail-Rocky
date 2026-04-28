import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft, Play, Pause, Film, Music2,
  Lightbulb, Sliders, Sun, Moon, Wind, Thermometer,
  Tv, Activity, SkipForward, Cpu, Zap
} from "lucide-react";
import socket from "../lib/socket";
import { useRockyStore, LightState } from "../store/useRockyStore";

interface ProtocolsModeProps {
  analyzerNode?: AnalyserNode | null;
}

// ─── Cinema sub-view ─────────────────────────────────────────────────────────

const CINEMA_PRESETS: Record<string, { brightness: number; color: string; action?: string; swatch: string | null; label: string }> = {
  "soft_glow":    { label: "Soft Glow",    brightness: 10,  color: "#ffaa00", swatch: "#ffaa00" },
  "total_dark":   { label: "Total Dark",   brightness: 0,   color: "#000000", action: "off",  swatch: null    },
  "intermission": { label: "Intermission", brightness: 40,  color: "#ffddaa", swatch: "#ffddaa" },
  "clean_up":     { label: "Clean Up",     brightness: 100, color: "#ffffff", action: "on",   swatch: "#f0f8ff" },
};

function CinemaView() {
  const { lights } = useRockyStore();
  const [activePreset, setActivePreset] = useState("soft_glow");

  const applyPreset = (key: string) => {
    setActivePreset(key);
    const ids = Object.keys(lights);
    const ps = CINEMA_PRESETS[key];
    if (ps.action === "off") {
      ids.forEach(id => socket.emit("control_device", { device: id, action: "off" }));
    } else if (ps.action === "on") {
      ids.forEach(id => socket.emit("control_device", { device: id, action: "on", params: { brightness: ps.brightness, color: ps.color } }));
    } else {
      ids.forEach(id => socket.emit("control_device", { device: id, action: "set", params: { color: ps.color, brightness: ps.brightness } }));
    }
  };

  return (
    <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-2 gap-10 z-10">
      <div className="space-y-6">
        <div>
          <div className="vibe-label text-yellow-500 mb-2 flex items-center gap-2">
            <Film size={14} /> Cinema Protocol
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Theater Configuration</h1>
          <p className="text-white/40 mt-2 text-sm font-mono uppercase tracking-widest">
            Low amber ambient — optimal for immersion.
          </p>
        </div>

        {/* TV schematic */}
        <div className="vibe-card aspect-video border-white/5 bg-white/5 flex items-center justify-center relative overflow-hidden rounded-2xl">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 w-32 h-2 bg-white rounded-full" />
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-48 h-24 border-2 border-white rounded-t-3xl" />
          </div>
          {/* Ambient light dots */}
          {(Object.entries(lights) as [string, LightState][]).map(([id, state], i) => (
            <motion.div
              key={id}
              animate={{ opacity: state.status === "on" ? state.brightness / 100 : 0, scale: state.status === "on" ? 1 : 0.5 }}
              transition={{ duration: 0.8 }}
              className="absolute w-8 h-8 rounded-full blur-xl pointer-events-none"
              style={{
                background: state.color || "#ffaa00",
                top: i % 2 === 0 ? "15%" : "65%",
                left: i % 3 === 0 ? "10%" : i % 3 === 1 ? "50%" : "80%",
              }}
            />
          ))}
          <Tv size={40} className="text-white/10 z-10" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="vibe-card p-4 border-white/5 bg-white/5 rounded-xl">
            <div className="vibe-label !text-[8px] opacity-40 mb-1">Active Preset</div>
            <div className="text-sm font-mono text-yellow-400">{CINEMA_PRESETS[activePreset]?.label}</div>
          </div>
          <div className="vibe-card p-4 border-white/5 bg-white/5 rounded-xl">
            <div className="vibe-label !text-[8px] opacity-40 mb-1">Brightness</div>
            <div className="text-sm font-mono text-yellow-400">
              {activePreset === "total_dark" ? "OFF" : `${CINEMA_PRESETS[activePreset]?.brightness}%`}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="vibe-card p-6 border-white/10 bg-white/5 space-y-6 rounded-2xl">
          <div className="vibe-label flex items-center gap-2">
            <Lightbulb size={13} className="text-yellow-500" /> Lighting Presets
          </div>

          <div className="grid grid-cols-2 gap-3">
            {Object.entries(CINEMA_PRESETS).map(([key, ps]) => (
              <motion.button
                key={key}
                onClick={() => applyPreset(key)}
                whileTap={{ scale: 0.95 }}
                className={`relative p-4 rounded-2xl border text-left transition-all touch-manipulation overflow-hidden ${
                  activePreset === key
                    ? "border-yellow-500/60 bg-yellow-500/10 shadow-[0_0_16px_rgba(234,179,8,0.15)]"
                    : "border-white/5 bg-white/5 active:border-white/20"
                }`}
              >
                {/* Color swatch strip at top */}
                {ps.swatch && (
                  <div
                    className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-80"
                    style={{ background: ps.swatch }}
                  />
                )}
                {!ps.swatch && (
                  <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl bg-white/10" />
                )}
                <div className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${activePreset === key ? "text-yellow-400" : "text-white/50"}`}>
                  {ps.label}
                </div>
                <div className={`text-[9px] font-mono mt-0.5 ${activePreset === key ? "text-yellow-400/60" : "text-white/20"}`}>
                  {ps.action === "off" ? "Lights off" : `${ps.brightness}% · ${ps.color}`}
                </div>
              </motion.button>
            ))}
          </div>

          {/* Light levels */}
          <div className="pt-4 border-t border-white/5 space-y-3 max-h-40 overflow-y-auto custom-scrollbar pr-1">
            <div className="vibe-label opacity-40 flex items-center gap-2"><Sliders size={11} /> Live Nodes</div>
            {(Object.entries(lights) as [string, LightState][]).map(([id, state]) => (
              <div key={id} className="space-y-1.5">
                <div className="flex justify-between text-[9px] uppercase tracking-widest">
                  <span className={state.status === "on" ? "text-white/70" : "text-white/25"}>
                    {id.includes(".") ? id.split(".")[1].replace(/_/g," ") : id}
                  </span>
                  <span className={state.status === "on" ? "text-yellow-500" : "text-white/15"}>
                    {state.status === "on" ? `${state.brightness}%` : "off"}
                  </span>
                </div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    animate={{ width: `${state.status === "on" ? state.brightness : 0}%` }}
                    transition={{ duration: 0.5 }}
                    className="h-full rounded-full"
                    style={{ background: state.status === "on" ? (state.color || "#ffaa00") : "transparent" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Music sub-view ──────────────────────────────────────────────────────────

function MusicView({ analyzerNode }: { analyzerNode?: AnalyserNode | null }) {
  const { lights } = useRockyStore();
  const [sensitivity, setSensitivity] = useState(0.8);
  const [algorithm, setAlgorithm] = useState<"beat" | "freq" | "ambient" | "strobe">("freq");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const algorithmRef = useRef(algorithm);
  const lightsRef = useRef<Record<string, LightState>>({});
  const sensitivityRef = useRef(sensitivity);
  const lastEmitRef = useRef(0);
  const lastBassRef = useRef(0);
  const ambientBrightnessRef = useRef(0);
  const strobeStateRef = useRef(false);

  useEffect(() => { algorithmRef.current = algorithm; }, [algorithm]);
  useEffect(() => { lightsRef.current = lights; }, [lights]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);

  useEffect(() => {
    if (!analyzerNode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frameId: number;
    const data = new Uint8Array(analyzerNode.frequencyBinCount);

    const emitAll = (params: Partial<LightState>) => {
      const now = Date.now();
      if (now - lastEmitRef.current < 300) return;
      lastEmitRef.current = now;
      Object.keys(lightsRef.current).forEach(id =>
        socket.emit("control_device", { device: id, action: "set", params })
      );
    };

    const draw = () => {
      analyzerNode.getByteFrequencyData(data);
      const freqs = data.slice(0, 32);
      const amplitude = freqs.reduce((a, b) => a + b, 0) / (freqs.length * 255);
      const s = sensitivityRef.current;

      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barW = canvas.width / freqs.length;
      freqs.forEach((v, i) => {
        const h = (v / 255) * canvas.height;
        const hue = (i / freqs.length) * 240;
        ctx.shadowBlur = 4;
        ctx.shadowColor = `hsla(${hue},100%,60%,0.6)`;
        ctx.fillStyle = `hsla(${hue},100%,60%,0.85)`;
        ctx.fillRect(i * barW, canvas.height - h, barW - 1, h);
      });

      const algo = algorithmRef.current;
      if (algo === "beat") {
        const bass = data.slice(0, 4).reduce((a, b) => a + b, 0) / (4 * 255);
        if (bass > 0.6 && bass - lastBassRef.current > 0.1) {
          emitAll({ brightness: Math.round(bass * 100 * s), color: "#ff00ff" });
        }
        lastBassRef.current = bass;
      } else if (algo === "freq") {
        const mid = data.slice(8, 16).reduce((a, b) => a + b, 0) / (8 * 255);
        const hue = Math.round(mid * 240);
        const bri = Math.round(amplitude * 100 * s);
        emitAll({ brightness: Math.max(5, bri), color: `hsl(${hue},100%,50%)` });
      } else if (algo === "ambient") {
        ambientBrightnessRef.current = ambientBrightnessRef.current * 0.9 + amplitude * 0.1;
        emitAll({ brightness: Math.round(ambientBrightnessRef.current * 100 * s) });
      } else if (algo === "strobe") {
        const bass = data.slice(0, 4).reduce((a, b) => a + b, 0) / (4 * 255);
        if (bass > 0.7) {
          strobeStateRef.current = !strobeStateRef.current;
          emitAll({ brightness: strobeStateRef.current ? 100 : 0 });
        }
      }

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [analyzerNode]);

  const ALGO_DESC: Record<string, string> = {
    beat: "Pulses on bass hits",
    freq: "Colors follow frequency spectrum",
    ambient: "Smooth amplitude envelope",
    strobe: "Strobe on hard bass",
  };

  return (
    <div className="max-w-5xl w-full space-y-8">
      <div>
        <div className="vibe-label text-purple-400 mb-2 flex items-center gap-2">
          <Music2 size={14} /> Music Sync Protocol
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Neural Frequency Sync</h1>
        <p className="text-white/40 mt-2 text-sm">Real-time light synchronisation via microphone analysis.</p>
      </div>

      <canvas ref={canvasRef} className="w-full h-36 rounded-2xl bg-black/40 border border-white/5" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(["beat", "freq", "ambient", "strobe"] as const).map(a => (
          <motion.button
            key={a}
            onClick={() => setAlgorithm(a)}
            whileTap={{ scale: 0.95 }}
            className={`p-4 rounded-2xl border text-left transition-all touch-manipulation ${
              algorithm === a
                ? "border-purple-500/60 bg-purple-500/10 text-purple-400"
                : "border-white/5 bg-white/5 text-white/30 active:text-white active:border-white/20"
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest">{a}</div>
            <div className="text-[8px] opacity-50 mt-1 leading-tight">{ALGO_DESC[a]}</div>
          </motion.button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-[10px] uppercase tracking-widest text-white/40">
          <span>Sensitivity</span>
          <span className="text-purple-400 font-mono">{Math.round(sensitivity * 100)}%</span>
        </div>
        <input
          type="range" min="0.1" max="1" step="0.05"
          value={sensitivity}
          onChange={e => setSensitivity(parseFloat(e.target.value))}
          className="w-full h-2 bg-white/10 rounded-full appearance-none accent-purple-500"
        />
      </div>

      {!analyzerNode && (
        <div className="vibe-card p-5 border-yellow-500/20 bg-yellow-500/5 rounded-xl text-sm text-yellow-400">
          Mic must be active for light sync — tap the mic button first.
        </div>
      )}
    </div>
  );
}

// ─── Sunset sub-view ─────────────────────────────────────────────────────────

const SUNSET_STAGES = [
  { id: 0, label: "Golden Hour",   color: "#ff8800", brightness: 55 },
  { id: 1, label: "Dusk",          color: "#ff3300", brightness: 40 },
  { id: 2, label: "Twilight",      color: "#cc0055", brightness: 25 },
  { id: 3, label: "Deep Purple",   color: "#550088", brightness: 12 },
  { id: 4, label: "Night",         color: "#110022", brightness: 4  },
];

const STAGE_DURATION_S = 90; // 90s per stage → ~7.5 min total

function SunsetView() {
  const { lights } = useRockyStore();
  const [stage, setStage] = useState(-1);            // -1 = not started
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(STAGE_DURATION_S);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyStage = (idx: number) => {
    if (idx >= SUNSET_STAGES.length) return;
    const s = SUNSET_STAGES[idx];
    Object.keys(lights).forEach(id =>
      socket.emit("control_device", { device: id, action: "set", params: { color: s.color, brightness: s.brightness } })
    );
    socket.emit("add_log", `Sunset stage: ${s.label}. Atmospherics adjusted, yes.`);
  };

  const start = () => {
    const firstStage = 0;
    setStage(firstStage);
    setRunning(true);
    setSecondsLeft(STAGE_DURATION_S);
    applyStage(firstStage);
  };

  const stop = () => {
    setRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const skipNext = () => {
    const next = stage + 1;
    if (next >= SUNSET_STAGES.length) { stop(); return; }
    setStage(next);
    setSecondsLeft(STAGE_DURATION_S);
    applyStage(next);
  };

  // Countdown tick
  useEffect(() => {
    if (!running) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          // Advance to next stage
          setStage(cur => {
            const next = cur + 1;
            if (next >= SUNSET_STAGES.length) {
              setRunning(false);
              return cur;
            }
            applyStage(next);
            return next;
          });
          return STAGE_DURATION_S;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running]);

  const currentStage = SUNSET_STAGES[stage];
  const progressPct = stage < 0 ? 0 : ((stage + (1 - secondsLeft / STAGE_DURATION_S)) / SUNSET_STAGES.length) * 100;
  const done = stage >= SUNSET_STAGES.length;

  return (
    <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
      {/* Left — progress */}
      <div className="space-y-6">
        <div>
          <div className="vibe-label text-orange-400 mb-2 flex items-center gap-2">
            <Sun size={14} /> Sunset Protocol
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Atmospheric Transition</h1>
          <p className="text-white/40 mt-2 text-sm leading-relaxed">
            Gradual progression from golden hour to deep night. Reduces blue light naturally, yes.
          </p>
        </div>

        {/* Overall progress */}
        <div className="vibe-card p-6 border-white/5 bg-white/5 space-y-5 rounded-2xl">
          <div className="vibe-label opacity-40 flex items-center gap-2">
            <Thermometer size={11} /> Solar Cycle Progress
          </div>
          <div className="relative h-2 w-full bg-white/5 rounded-full overflow-hidden">
            <motion.div
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.5 }}
              className="h-full rounded-full"
              style={{
                background: currentStage
                  ? `linear-gradient(to right, #ff8800, ${currentStage.color})`
                  : "linear-gradient(to right, #ff8800, #110022)"
              }}
            />
          </div>

          {/* Stage dots */}
          <div className="flex items-center justify-between mt-1">
            {SUNSET_STAGES.map((s, i) => (
              <div key={s.id} className="flex flex-col items-center gap-1.5">
                <motion.div
                  animate={{
                    scale: stage === i ? 1.3 : 1,
                    opacity: i <= stage ? 1 : 0.25,
                  }}
                  className="w-2.5 h-2.5 rounded-full border border-white/20"
                  style={{ background: i <= stage ? s.color : "transparent" }}
                />
                <span className="text-[7px] font-mono text-white/20 uppercase hidden sm:block">
                  {s.label.split(" ")[0]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Current stage info */}
        <AnimatePresence mode="wait">
          {currentStage && (
            <motion.div
              key={stage}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="vibe-card p-5 border-white/10 bg-white/5 rounded-2xl flex items-center gap-4"
            >
              <div
                className="w-12 h-12 rounded-2xl border border-white/10 shadow-lg shrink-0"
                style={{
                  background: currentStage.color,
                  boxShadow: `0 0 20px ${currentStage.color}66`
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold">{currentStage.label}</div>
                <div className="text-[9px] font-mono text-white/30 uppercase mt-0.5">
                  {currentStage.brightness}% · {currentStage.color}
                </div>
              </div>
              {running && (
                <div className="text-right shrink-0">
                  <div className="text-xl font-mono text-white/60">{secondsLeft}s</div>
                  <div className="text-[7px] text-white/20 uppercase">until next</div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stage metadata */}
        <div className="grid grid-cols-2 gap-3">
          <div className="vibe-card p-4 border-white/5 bg-white/5 flex items-center gap-3 rounded-xl">
            <Thermometer size={15} className="text-orange-400 shrink-0" />
            <div>
              <div className="text-[8px] uppercase text-white/30">Color Temp.</div>
              <div className="text-sm font-mono">
                {stage < 0 ? "—" : stage <= 1 ? "2200K" : stage <= 2 ? "3000K" : "Night"}
              </div>
            </div>
          </div>
          <div className="vibe-card p-4 border-white/5 bg-white/5 flex items-center gap-3 rounded-xl">
            <Wind size={15} className="text-purple-400 shrink-0" />
            <div>
              <div className="text-[8px] uppercase text-white/30">Transition</div>
              <div className="text-sm font-mono">Smooth</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right — controls */}
      <div className="space-y-5">
        {/* Main action */}
        <div className="vibe-card p-8 border-orange-500/20 bg-orange-500/5 rounded-3xl relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-5 pointer-events-none"
            style={{ background: `radial-gradient(circle at 70% 30%, ${currentStage?.color || "#ff8800"}, transparent 60%)` }}
          />
          <div className="relative z-10 flex flex-col items-center gap-6 text-center">
            <div
              className="w-20 h-20 rounded-full border-2 flex items-center justify-center transition-all duration-1000"
              style={{
                borderColor: currentStage?.color || "#ff8800",
                background: `${currentStage?.color || "#ff8800"}22`,
                boxShadow: `0 0 30px ${currentStage?.color || "#ff8800"}33`,
              }}
            >
              <Moon size={40} className="text-orange-400" />
            </div>

            <div>
              <h2 className="text-xl font-bold">
                {stage < 0 ? "Ready to Deploy" : done ? "Night Reached" : `Stage ${stage + 1} / ${SUNSET_STAGES.length}`}
              </h2>
              <p className="text-sm text-white/40 mt-1">
                {stage < 0
                  ? "Starts at Golden Hour, ends at Night"
                  : done
                  ? "Full atmospheric cycle complete, yes."
                  : `${SUNSET_STAGES.length - stage - 1} stages remaining`}
              </p>
            </div>

            <div className="flex gap-3 w-full">
              {!running && stage < 0 && (
                <motion.button
                  onClick={start}
                  whileTap={{ scale: 0.95 }}
                  className="flex-1 py-4 bg-orange-500 text-black font-black uppercase tracking-widest text-[11px] rounded-2xl touch-manipulation shadow-lg shadow-orange-500/20"
                >
                  Begin Sunset
                </motion.button>
              )}
              {running && (
                <>
                  <motion.button
                    onClick={stop}
                    whileTap={{ scale: 0.95 }}
                    className="flex-1 py-4 border border-white/20 bg-white/5 font-bold uppercase tracking-widest text-[10px] rounded-2xl touch-manipulation flex items-center justify-center gap-2"
                  >
                    <Pause size={14} /> Pause
                  </motion.button>
                  <motion.button
                    onClick={skipNext}
                    whileTap={{ scale: 0.95 }}
                    className="px-5 py-4 border border-orange-500/30 bg-orange-500/10 text-orange-400 font-bold uppercase tracking-widest text-[10px] rounded-2xl touch-manipulation flex items-center justify-center gap-2"
                  >
                    <SkipForward size={14} />
                  </motion.button>
                </>
              )}
              {!running && stage >= 0 && !done && (
                <motion.button
                  onClick={() => setRunning(true)}
                  whileTap={{ scale: 0.95 }}
                  className="flex-1 py-4 bg-orange-500 text-black font-black uppercase tracking-widest text-[11px] rounded-2xl touch-manipulation flex items-center justify-center gap-2"
                >
                  <Play size={14} fill="currentColor" /> Resume
                </motion.button>
              )}
              {done && (
                <motion.button
                  onClick={() => { setStage(-1); setRunning(false); setSecondsLeft(STAGE_DURATION_S); }}
                  whileTap={{ scale: 0.95 }}
                  className="flex-1 py-4 border border-white/20 bg-white/5 font-bold uppercase tracking-widest text-[10px] rounded-2xl touch-manipulation"
                >
                  Restart
                </motion.button>
              )}
            </div>
          </div>
        </div>

        {/* Affected nodes */}
        <div className="vibe-card p-5 border-white/10 bg-white/5 rounded-2xl">
          <div className="vibe-label flex items-center gap-2 mb-4">
            <Zap size={13} className="text-orange-400" /> Affected Nodes
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(Object.entries(lights) as [string, LightState][]).map(([id, state]) => (
              <div key={id} className="p-3 border border-white/5 bg-white/5 rounded-xl space-y-1.5">
                <div className="flex justify-between items-center gap-1">
                  <span className="text-[9px] uppercase tracking-widest text-white/40 truncate">
                    {id.includes(".") ? id.split(".")[1].replace(/_/g," ") : id}
                  </span>
                  <div
                    className="w-2 h-2 rounded-full shrink-0 transition-colors duration-500"
                    style={{
                      background: state.status === "on" ? (state.color || "#ff8800") : "rgba(255,255,255,0.1)",
                      boxShadow: state.status === "on" ? `0 0 6px ${state.color || "#ff8800"}` : "none",
                    }}
                  />
                </div>
                <div className="h-0.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    animate={{ width: `${state.status === "on" ? state.brightness : 0}%` }}
                    transition={{ duration: 0.8 }}
                    className="h-full rounded-full"
                    style={{ background: state.status === "on" ? (state.color || "#ff8800") : "transparent" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Generic protocol view ────────────────────────────────────────────────────

function GenericProtocolView({ protocolId }: { protocolId: string }) {
  const { protocols, lights } = useRockyStore();
  const protocol = protocols.find(p => p.id === protocolId);

  const reapply = () => {
    if (!protocol) return;
    const targets = protocol.settings.targetLights?.length
      ? protocol.settings.targetLights
      : Object.keys(lights);
    targets.forEach(id =>
      socket.emit("control_device", {
        device: id,
        action: "set",
        params: { brightness: protocol.settings.brightness, color: protocol.settings.color },
      })
    );
  };

  return (
    <div className="max-w-2xl w-full space-y-8">
      <div>
        <div className="vibe-label text-cyan-400 mb-2 flex items-center gap-2">
          <Cpu size={14} /> Active Protocol
        </div>
        <h1 className="text-4xl font-bold tracking-tight">{protocol?.label ?? protocolId}</h1>
        <p className="text-white/40 mt-2 text-sm">{protocol?.description ?? "Custom protocol active."}</p>
      </div>

      {protocol && (
        <div className="grid grid-cols-2 gap-5">
          <div className="vibe-card p-6 border-white/5 bg-white/5 space-y-3 rounded-2xl">
            <div className="text-[9px] uppercase tracking-widest text-white/30">Brightness</div>
            <div className="text-3xl font-black font-mono text-cyan-400">{protocol.settings.brightness}%</div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${protocol.settings.brightness}%` }} />
            </div>
          </div>
          <div className="vibe-card p-6 border-white/5 bg-white/5 space-y-3 rounded-2xl">
            <div className="text-[9px] uppercase tracking-widest text-white/30">Color</div>
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg border border-white/10"
                style={{
                  background: protocol.settings.color,
                  boxShadow: `0 0 12px ${protocol.settings.color}66`
                }}
              />
              <div className="text-sm font-mono text-white/70">{protocol.settings.color}</div>
            </div>
          </div>
        </div>
      )}

      <motion.button
        onClick={reapply}
        whileTap={{ scale: 0.97 }}
        className="w-full py-4 bg-cyan-500 text-black font-black uppercase tracking-widest text-[11px] rounded-2xl touch-manipulation flex items-center justify-center gap-3"
      >
        <Activity size={15} /> Reapply Protocol
      </motion.button>

      <div className="vibe-card p-5 border-white/5 bg-white/5 rounded-2xl">
        <div className="vibe-label flex items-center gap-2 mb-4">
          <Activity size={12} className="text-cyan-400" /> Target Nodes
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(protocol?.settings.targetLights?.length ? protocol.settings.targetLights : Object.keys(lights)).map(id => {
            const state = lights[id];
            return (
              <div key={id} className="p-3 border border-white/5 bg-white/[0.02] rounded-xl">
                <div className="text-[10px] uppercase tracking-widest text-white/40 truncate">
                  {id.includes(".") ? id.split(".")[1].replace(/_/g," ") : id}
                </div>
                {state && (
                  <div className="flex items-center gap-2 mt-1">
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background: state.status === "on" ? (state.color || "#00ffff") : "rgba(255,255,255,0.1)",
                      }}
                    />
                    <span className="text-[9px] font-mono text-white/30">
                      {state.status === "on" ? `${state.brightness}%` : "off"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function ProtocolsMode({ analyzerNode }: ProtocolsModeProps) {
  const { activeProtocolId, setMode, setActiveProtocolId } = useRockyStore();

  const goBack = () => {
    setMode("neural_center");
    setActiveProtocolId(null);
  };

  const renderSubView = () => {
    if (!activeProtocolId) return null;
    if (activeProtocolId === "cinema") return <CinemaView />;
    if (activeProtocolId === "music")  return <MusicView analyzerNode={analyzerNode} />;
    if (activeProtocolId === "sunset") return <SunsetView />;
    return <GenericProtocolView protocolId={activeProtocolId} />;
  };

  const bgClass =
    activeProtocolId === "cinema"  ? "from-yellow-950/15 via-black to-black" :
    activeProtocolId === "music"   ? "from-purple-950/20 via-black to-black" :
    activeProtocolId === "sunset"  ? "from-orange-950/20 via-purple-950/10 to-black" :
    "from-black to-black";

  return (
    <div className={`h-full w-full flex flex-col items-center justify-start p-6 bg-gradient-to-b ${bgClass} relative overflow-auto custom-scrollbar`}>
      <div className="w-full max-w-6xl mb-6">
        <button
          onClick={goBack}
          className="flex items-center gap-2 text-white/40 active:text-white transition-colors text-[11px] uppercase tracking-widest font-bold py-3 pr-4 touch-manipulation"
        >
          <ArrowLeft size={16} />
          Neural Center
        </button>
      </div>
      {renderSubView()}
    </div>
  );
}
