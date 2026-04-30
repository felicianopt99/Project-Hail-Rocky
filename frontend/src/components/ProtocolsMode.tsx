import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft, Play, Pause, Film, Music2,
  Lightbulb, Sliders, Sun, Moon, Wind, Thermometer,
  Tv, Activity, SkipForward, Cpu, Zap, Settings2, Save, Trash2, Plus
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
  const { lights, protocols } = useRockyStore();
  const protocol = protocols.find(p => p.id === "cinema");
  const presets = protocol?.settings?.presets || CINEMA_PRESETS;
  
  const [activePreset, setActivePreset] = useState(Object.keys(presets)[0] || "soft_glow");
  const [isEditing, setIsEditing] = useState(false);
  const [editPresets, setEditPresets] = useState(presets);

  const applyPreset = (key: string) => {
    setActivePreset(key);
    const ids = Object.keys(lights);
    const ps = presets[key];
    if (ps.action === "off") {
      ids.forEach(id => socket.emit("control_device", { device: id, action: "off" }));
    } else if (ps.action === "on") {
      ids.forEach(id => socket.emit("control_device", { device: id, action: "on", params: { brightness: ps.brightness, color: ps.color } }));
    } else {
      ids.forEach(id => socket.emit("control_device", { device: id, action: "set", params: { color: ps.color, brightness: ps.brightness } }));
    }
  };

  const saveChanges = () => {
    socket.emit("save_protocol", {
      id: "cinema",
      label: protocol?.label,
      description: protocol?.description,
      settings: { ...protocol?.settings, presets: editPresets }
    });
    setIsEditing(false);
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
        <div className="vibe-card aspect-video border-white/5 bg-white/5 flex items-center justify-center relative overflow-hidden rounded-3xl group">
          {/* Preset-specific ambient glow */}
          <motion.div 
            animate={{ 
              background: presets[activePreset]?.color || "#000",
              opacity: presets[activePreset]?.brightness ? (presets[activePreset].brightness / 100) * 0.3 : 0
            }}
            className="absolute inset-0 blur-[100px] transition-all duration-1000"
          />
          
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 w-32 h-2 bg-white/20 rounded-full" />
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-48 h-24 border-2 border-white/20 rounded-t-3xl" />
          </div>
          
          <Tv size={48} strokeWidth={1} className="text-white/20 z-10 group-hover:text-white/40 transition-colors" />
          
          {/* Floating light particles */}
          <div className="absolute inset-0 pointer-events-none">
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                animate={{
                  y: [0, -20, 0],
                  opacity: [0.2, 0.5, 0.2],
                }}
                transition={{
                  duration: 3 + i,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
                className="absolute w-1 h-1 bg-white/20 rounded-full"
                style={{
                  top: `${20 + i * 10}%`,
                  left: `${15 + i * 15}%`,
                }}
              />
            ))}
          </div>
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
          <div className="vibe-label flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Lightbulb size={13} className="text-yellow-500" /> Lighting Presets
            </div>
            <button 
              onClick={() => setIsEditing(!isEditing)}
              className="p-1 hover:bg-white/10 rounded transition-colors text-white/40 hover:text-white"
            >
              {isEditing ? <ArrowLeft size={12} /> : <Settings2 size={12} />}
            </button>
          </div>

          {!isEditing ? (
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(presets).map(([key, ps]: [string, any]) => (
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
                  <div className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${activePreset === key ? "text-yellow-400" : "text-white/50"}`}>
                    {ps.label}
                  </div>
                  <div className={`text-[9px] font-mono mt-0.5 ${activePreset === key ? "text-yellow-400/60" : "text-white/20"}`}>
                    {ps.action === "off" ? "Lights off" : `${ps.brightness}% · ${ps.color}`}
                  </div>
                </motion.button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(editPresets).map(([key, ps]: [string, any]) => (
                <div key={key} className="p-4 border border-white/10 bg-white/5 rounded-xl space-y-3">
                  <div className="flex justify-between items-center">
                    <input 
                      className="bg-transparent border-none text-[10px] font-bold uppercase tracking-widest text-yellow-400 w-full focus:ring-0"
                      value={ps.label}
                      onChange={(e) => setEditPresets({...editPresets, [key]: {...ps, label: e.target.value}})}
                    />
                    <button 
                      onClick={() => {
                        const next = {...editPresets};
                        delete next[key];
                        setEditPresets(next);
                      }}
                      className="text-red-400/40 hover:text-red-400 p-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="text-[8px] text-white/20 uppercase">Brightness</div>
                      <input 
                        type="number" min="0" max="100"
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] font-mono"
                        value={ps.brightness}
                        onChange={(e) => setEditPresets({...editPresets, [key]: {...ps, brightness: parseInt(e.target.value)}})}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[8px] text-white/20 uppercase">Color</div>
                      <input 
                        type="text"
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] font-mono"
                        value={ps.color}
                        onChange={(e) => setEditPresets({...editPresets, [key]: {...ps, color: e.target.value}})}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    const id = `preset_${Date.now()}`;
                    setEditPresets({...editPresets, [id]: {label: "New Preset", brightness: 50, color: "#ffffff"}});
                  }}
                  className="flex-1 py-2 border border-dashed border-white/20 rounded-xl text-[10px] uppercase tracking-widest text-white/40 hover:text-white hover:border-white/40 transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={12} /> Add Preset
                </button>
                <button 
                  onClick={saveChanges}
                  className="px-6 py-2 bg-yellow-500 text-black rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2"
                >
                  <Save size={12} /> Save
                </button>
              </div>
            </div>
          )}


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
  const { lights, protocols } = useRockyStore();
  const protocol = protocols.find(p => p.id === "music");
  
  const [sensitivity, setSensitivity] = useState(protocol?.settings?.sensitivity || 0.8);
  const [algorithm, setAlgorithm] = useState<"beat" | "freq" | "ambient" | "strobe">(protocol?.settings?.algorithm || "freq");
  const [isEditing, setIsEditing] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const algorithmRef = useRef(algorithm);
  const lightsRef = useRef<Record<string, LightState>>({});
  const sensitivityRef = useRef(sensitivity);
  const lastEmitRef = useRef(0);
  const lastBassRef = useRef(0);
  const ambientBrightnessRef = useRef(0);
  const strobeStateRef = useRef(false);

  const saveChanges = () => {
    socket.emit("save_protocol", {
      id: "music",
      label: protocol?.label,
      description: protocol?.description,
      settings: { ...protocol?.settings, sensitivity, algorithm }
    });
    setIsEditing(false);
  };


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

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        canvas.width = entry.contentRect.width;
        canvas.height = entry.contentRect.height;
      }
    });
    resizeObserver.observe(canvas);

    const draw = () => {
      analyzerNode.getByteFrequencyData(data);
      const freqs = data.slice(0, 32);
      const amplitude = freqs.reduce((a, b) => a + b, 0) / (freqs.length * 255);
      const s = sensitivityRef.current;

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
    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [analyzerNode]);

  const ALGO_DESC: Record<string, string> = {
    beat: "Pulses on bass hits",
    freq: "Colors follow frequency spectrum",
    ambient: "Smooth amplitude envelope",
    strobe: "Strobe on hard bass",
  };

  return (
    <div className="max-w-5xl w-full space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <div className="vibe-label text-purple-400 mb-2 flex items-center gap-2">
            <Music2 size={14} /> Music Sync Protocol
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Neural Frequency Sync</h1>
          <p className="text-white/40 mt-2 text-sm">Real-time light synchronisation via microphone analysis.</p>
        </div>
        <button 
          onClick={() => isEditing ? saveChanges() : setIsEditing(true)}
          className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${
            isEditing ? "bg-purple-500 text-white" : "bg-white/5 text-white/40 hover:text-white"
          }`}
        >
          {isEditing ? <><Save size={12} /> Save Config</> : <><Settings2 size={12} /> Edit Config</>}
        </button>
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
  const { lights, protocols } = useRockyStore();
  const protocol = protocols.find(p => p.id === "sunset");
  const stages = protocol?.settings?.stages || SUNSET_STAGES;
  const duration = protocol?.settings?.duration || STAGE_DURATION_S;

  const [stage, setStage] = useState(-1);            // -1 = not started
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(duration);
  const [isEditing, setIsEditing] = useState(false);
  const [editStages, setEditStages] = useState(stages);
  const [editDuration, setEditDuration] = useState(duration);
  
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const saveChanges = () => {
    socket.emit("save_protocol", {
      id: "sunset",
      label: protocol?.label,
      description: protocol?.description,
      settings: { ...protocol?.settings, stages: editStages, duration: editDuration }
    });
    setIsEditing(false);
  };

  const applyStage = (idx: number) => {
    if (idx >= stages.length) return;
    const s = stages[idx];
    Object.keys(lights).forEach(id =>
      socket.emit("control_device", { device: id, action: "set", params: { color: s.color, brightness: s.brightness } })
    );
    socket.emit("add_log", `Sunset stage: ${s.label}. Atmospherics adjusted, yes.`);
  };

  const start = () => {
    const firstStage = 0;
    setStage(firstStage);
    setRunning(true);
    setSecondsLeft(duration);
    applyStage(firstStage);
  };


  const stop = () => {
    setRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const skipNext = () => {
    const next = stage + 1;
    if (next >= stages.length) { stop(); return; }
    setStage(next);
    setSecondsLeft(duration);
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
            if (next >= stages.length) {
              setRunning(false);
              return cur;
            }
            applyStage(next);
            return next;
          });
          return duration;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running]);

  const currentStage = stages[stage];
  const progressPct = stage < 0 ? 0 : ((stage + (1 - secondsLeft / duration)) / stages.length) * 100;
  const done = stage >= stages.length;

  return (
    <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
      {/* Left — progress */}
      <div className="space-y-6">
        <div className="flex justify-between items-end">
          <div>
            <div className="vibe-label text-orange-400 mb-2 flex items-center gap-2">
              <Sun size={14} /> Sunset Protocol
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Atmospheric Transition</h1>
            <p className="text-white/40 mt-2 text-sm leading-relaxed">
              Gradual progression from golden hour to deep night. Reduces blue light naturally, yes.
            </p>
          </div>
          <button 
            onClick={() => isEditing ? saveChanges() : setIsEditing(true)}
            className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${
              isEditing ? "bg-orange-500 text-black" : "bg-white/5 text-white/40 hover:text-white"
            }`}
          >
            {isEditing ? <><Save size={12} /> Save Config</> : <><Settings2 size={12} /> Edit Config</>}
          </button>
        </div>


        {/* Overall progress */}
        <div className="vibe-card p-6 border-white/5 bg-white/5 space-y-5 rounded-2xl">
          <div className="vibe-label opacity-40 flex items-center gap-2">
            <Thermometer size={11} /> Solar Cycle Progress
          </div>
          <div className="relative h-3 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 shadow-inner">
            <motion.div
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 1, ease: "circOut" }}
              className="h-full rounded-full relative shadow-[0_0_15px_rgba(249,115,22,0.3)]"
              style={{
                background: currentStage
                  ? `linear-gradient(to right, #ff8800, ${currentStage.color})`
                  : "linear-gradient(to right, #ff8800, #550088)"
              }}
            >
              {/* Glow Tip */}
              <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/20 blur-[3px]" />
            </motion.div>
          </div>

          {/* Stage dots */}
          {!isEditing ? (
            <div className="flex items-center justify-between mt-1">
              {stages.map((s: any, i: number) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
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
          ) : (
            <div className="space-y-3 pt-4 border-t border-white/5">
               <div className="flex items-center justify-between">
                <div className="text-[8px] uppercase text-white/30">Step Duration (sec)</div>
                <input 
                  type="number"
                  className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] font-mono w-16"
                  value={editDuration}
                  onChange={(e) => setEditDuration(parseInt(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                {editStages.map((s: any, i: number) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input 
                      className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[9px] flex-1"
                      value={s.label}
                      onChange={(e) => {
                        const next = [...editStages];
                        next[i] = {...s, label: e.target.value};
                        setEditStages(next);
                      }}
                    />
                    <input 
                      type="text"
                      className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[9px] w-16 font-mono"
                      value={s.color}
                      onChange={(e) => {
                        const next = [...editStages];
                        next[i] = {...s, color: e.target.value};
                        setEditStages(next);
                      }}
                    />
                    <button 
                      onClick={() => setEditStages(editStages.filter((_: any, idx: number) => idx !== i))}
                      className="text-red-400/40 p-1"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
                <button 
                  onClick={() => setEditStages([...editStages, {label: "New Stage", color: "#ffffff", brightness: 50}])}
                  className="w-full py-2 border border-dashed border-white/20 rounded-lg text-[8px] uppercase tracking-widest text-white/20 hover:text-white"
                >
                  + Add Stage
                </button>
              </div>
            </div>
          )}

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
