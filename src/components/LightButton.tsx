import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { LightState } from "../store/useRockyStore";

interface LightButtonProps {
  id: string;
  state: LightState;
  onToggle: (id: string) => void;
  onUpdate: (id: string, params: Partial<LightState>) => void;
}

function hexToHue(hex: string): number {
  const safe = hex.startsWith("#") && hex.length >= 7 ? hex : "#ffffff";
  const r = parseInt(safe.slice(1, 3), 16) / 255;
  const g = parseInt(safe.slice(3, 5), 16) / 255;
  const b = parseInt(safe.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h =
    max === r ? (g - b) / d + (g < b ? 6 : 0)
    : max === g ? (b - r) / d + 2
    : (r - g) / d + 4;
  return Math.round((h / 6) * 360);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const QUICK_COLORS = [
  { label: "White",   value: "#ffffff" },
  { label: "Warm",    value: "#ffaa66" },
  { label: "Amber",   value: "#ff8800" },
  { label: "Magenta", value: "#ff00cc" },
  { label: "Cyan",    value: "#00ffee" },
  { label: "Night",   value: "#220033" },
];

export const LightButton: React.FC<LightButtonProps> = ({ id, state, onToggle, onUpdate }) => {
  const [showControls, setShowControls] = useState(false);
  const [localBrightness, setLocalBrightness] = useState(state?.brightness || 100);
  const [localTemp, setLocalTemp] = useState(state?.color_temp_kelvin || 4000);
  const [localHue, setLocalHue] = useState(hexToHue(state?.color || "#ffffff"));

  // Sync local state when external state changes
  useEffect(() => {
    setLocalBrightness(state?.brightness || 100);
    setLocalTemp(state?.color_temp_kelvin || 4000);
    setLocalHue(hexToHue(state?.color || "#ffffff"));
  }, [state?.brightness, state?.color_temp_kelvin, state?.color]);

  const displayName = id.includes(".") ? id.split(".")[1].replace(/_/g, " ") : id;
  const isOn = state?.status === "on";
  const color = state?.color || "#ffffff";

  // Debounced update helper
  const updateTimerRef = useRef<any>(null);
  const debouncedUpdate = (params: Partial<LightState>) => {
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    updateTimerRef.current = setTimeout(() => {
      onUpdate(id, params);
    }, 50);
  };

  const handleHueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const h = parseInt(e.target.value);
    setLocalHue(h);
    debouncedUpdate({ color: hslToHex(h, 100, 50) });
  };

  const handleBrightnessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const b = parseInt(e.target.value);
    setLocalBrightness(b);
    debouncedUpdate({ brightness: b });
  };

  const handleTempChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseInt(e.target.value);
    setLocalTemp(t);
    debouncedUpdate({ color_temp_kelvin: t });
  };

  return (
    <div
      className={`relative overflow-hidden rounded-lg border transition-all duration-300 ${
        isOn
          ? "border-white/15 bg-white/[0.04]"
          : "border-white/5 bg-white/[0.02]"
      }`}
      style={isOn ? { boxShadow: `0 0 16px ${color}12` } : undefined}
    >
      {/* Color glow strip at top */}
      <AnimatePresence>
        {isOn && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-0 left-0 right-0 h-0.5 rounded-t-lg"
            style={{ background: color, boxShadow: `0 0 8px ${color}` }}
          />
        )}
      </AnimatePresence>

      {/* Main row */}
      <div className="flex items-center gap-3 p-4">
        {/* Toggle + color indicator */}
        <button
          onClick={() => onToggle(id)}
          className="shrink-0 touch-manipulation"
          aria-label={`Toggle ${displayName}`}
        >
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center border transition-all duration-300"
            style={isOn
              ? { background: `${color}20`, borderColor: `${color}60`, boxShadow: `0 0 8px ${color}30` }
              : { background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }
            }
          >
            <div
              className="w-3 h-3 rounded-full transition-all duration-300"
              style={isOn
                ? { background: color, boxShadow: `0 0 4px ${color}` }
                : { background: "rgba(255,255,255,0.15)" }
              }
            />
          </div>
        </button>

        {/* Name + status */}
        <button
          onClick={() => isOn && setShowControls(v => !v)}
          className="flex-1 min-w-0 text-left touch-manipulation"
        >
          <div className={`text-[10px] uppercase tracking-widest font-bold truncate transition-colors ${isOn ? "text-white/80" : "text-white/30"}`}>
            {displayName}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[8px] font-mono uppercase ${isOn ? "text-white/30" : "text-white/15"}`}>
              {isOn ? `${state.brightness}%` : "off"}
            </span>
            {isOn && (
              <span className="text-[8px] font-mono uppercase text-white/20">{color}</span>
            )}
          </div>
        </button>

        {/* Brightness bar & expand chevron */}
        {isOn && (
          <button
            onClick={() => setShowControls(v => !v)}
            className="shrink-0 touch-manipulation"
          >
            <motion.div
              animate={{ rotate: showControls ? 180 : 0 }}
              className="text-white/20 text-[10px]"
            >
              ▾
            </motion.div>
          </button>
        )}
      </div>

      {/* Brightness bar at bottom of main row */}
      {isOn && !showControls && (
        <div className="h-0.5 mx-4 mb-3 bg-white/5 rounded-full overflow-hidden">
          <motion.div
            animate={{ width: `${state.brightness}%` }}
            transition={{ duration: 0.4 }}
            className="h-full rounded-full"
            style={{ background: `${color}99` }}
          />
        </div>
      )}

      {/* Expanded controls */}
      <AnimatePresence>
        {showControls && isOn && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-3">
              {/* Brightness */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[8px] font-bold uppercase tracking-widest text-white/30">Brightness</span>
                  <span className="text-[10px] font-mono" style={{ color }}>{localBrightness}%</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={localBrightness}
                  onChange={handleBrightnessChange}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: color }}
                />
              </div>

              {/* Hue */}
              <div className="space-y-2">
                <span className="text-[8px] font-bold uppercase tracking-widest text-white/30">Color Spectrum</span>
                <div className="relative h-5">
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={localHue}
                    onChange={handleHueChange}
                    className="w-full h-full rounded-full appearance-none cursor-pointer border border-white/10"
                    style={{
                      background: "linear-gradient(to right, #ff0000, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000)",
                    }}
                  />
                  <div
                    className="absolute -top-0.5 w-2 h-6 border border-white/60 rounded-full pointer-events-none shadow-md"
                    style={{
                      left: `calc(${(localHue / 360) * 100}% - 4px)`,
                      background: color,
                    }}
                  />
                </div>
              </div>

              {/* Temperature */}
              {(state.color_temp_kelvin || state.min_color_temp_kelvin) && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[8px] font-bold uppercase tracking-widest text-white/30">White Balance</span>
                    <span className="text-[10px] font-mono text-white/60">{localTemp}K</span>
                  </div>
                  <div className="relative h-5">
                    <input
                      type="range"
                      min={state.min_color_temp_kelvin || 2000}
                      max={state.max_color_temp_kelvin || 6500}
                      value={localTemp}
                      onChange={handleTempChange}
                      className="w-full h-full rounded-full appearance-none cursor-pointer border border-white/10"
                      style={{
                        background: "linear-gradient(to right, #ff8a00, #ffc071, #ffffff, #d1e4ff, #8ab9ff)",
                      }}
                    />
                    <div
                      className="absolute -top-0.5 w-2 h-6 border border-white/60 rounded-full pointer-events-none shadow-md"
                      style={{
                        left: `calc(${(( localTemp - (state.min_color_temp_kelvin || 2000)) / ((state.max_color_temp_kelvin || 6500) - (state.min_color_temp_kelvin || 2000))) * 100}% - 4px)`,
                        background: "white",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Quick color chips */}
              <div className="flex gap-2 flex-wrap">
                {QUICK_COLORS.map(c => (
                  <button
                    key={c.value}
                    onClick={() => onUpdate(id, { color: c.value })}
                    className="w-7 h-7 rounded-lg border-2 transition-all touch-manipulation hover:scale-110 active:scale-95"
                    style={{
                      background: c.value,
                      borderColor: color.toLowerCase() === c.value.toLowerCase() ? "white" : "transparent",
                      boxShadow: color.toLowerCase() === c.value.toLowerCase() ? `0 0 8px ${c.value}` : "none",
                    }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
