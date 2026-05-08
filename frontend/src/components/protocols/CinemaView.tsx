import { useState } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft, Film, Lightbulb, Sliders,
  Tv, Settings2, Save, Trash2, Plus,
} from "lucide-react";
import socket from "../../lib/socket";
import { useRockyStore, LightState } from "../../store/useRockyStore";

const CINEMA_PRESETS: Record<string, { brightness: number; color: string; action?: string; swatch: string | null; label: string }> = {
  "soft_glow":    { label: "Soft Glow",    brightness: 10,  color: "#ffaa00", swatch: "#ffaa00" },
  "total_dark":   { label: "Total Dark",   brightness: 0,   color: "#000000", action: "off",  swatch: null    },
  "intermission": { label: "Intermission", brightness: 40,  color: "#ffddaa", swatch: "#ffddaa" },
  "clean_up":     { label: "Clean Up",     brightness: 100, color: "#ffffff", action: "on",   swatch: "#f0f8ff" },
};

export function CinemaView() {
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

        <div className="vibe-card aspect-video border-white/5 bg-white/5 flex items-center justify-center relative overflow-hidden rounded-3xl group">
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
          <div className="absolute inset-0 pointer-events-none">
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                animate={{ y: [0, -20, 0], opacity: [0.2, 0.5, 0.2] }}
                transition={{ duration: 3 + i, repeat: Infinity, ease: "easeInOut" }}
                className="absolute w-1 h-1 bg-white/20 rounded-full"
                style={{ top: `${20 + i * 10}%`, left: `${15 + i * 15}%` }}
              />
            ))}
          </div>
        </div>

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

          <div className="pt-4 border-t border-white/5 space-y-3 max-h-40 overflow-y-auto custom-scrollbar pr-1">
            <div className="vibe-label opacity-40 flex items-center gap-2"><Sliders size={11} /> Live Nodes</div>
            {(Object.entries(lights) as [string, LightState][]).map(([id, state]) => (
              <div key={id} className="space-y-1.5">
                <div className="flex justify-between text-[9px] uppercase tracking-widest">
                  <span className={state.status === "on" ? "text-white/70" : "text-white/25"}>
                    {id.includes(".") ? (id.split(".")[1] ?? id).replace(/_/g," ") : id}
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
