import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sun, Moon, Thermometer, Wind, Zap,
  Pause, Play, SkipForward, Settings2, Save, Trash2,
} from "lucide-react";
import socket from "../../lib/socket";
import { useRockyStore, LightState } from "../../store/useRockyStore";

const SUNSET_STAGES = [
  { id: 0, label: "Golden Hour",   color: "#ff8800", brightness: 55 },
  { id: 1, label: "Dusk",          color: "#ff3300", brightness: 40 },
  { id: 2, label: "Twilight",      color: "#cc0055", brightness: 25 },
  { id: 3, label: "Deep Purple",   color: "#550088", brightness: 12 },
  { id: 4, label: "Night",         color: "#110022", brightness: 4  },
];

const STAGE_DURATION_S = 90;

export function SunsetView() {
  const { lights, protocols } = useRockyStore();
  const protocol = protocols.find(p => p.id === "sunset");
  const stages = protocol?.settings?.stages || SUNSET_STAGES;
  const duration = protocol?.settings?.duration || STAGE_DURATION_S;

  const [stage, setStage] = useState(-1);
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
    setStage(0);
    setRunning(true);
    setSecondsLeft(duration);
    applyStage(0);
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

  useEffect(() => {
    if (!running) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev: number) => {
        if (prev <= 1) {
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
              <div className="absolute right-0 top-0 bottom-0 w-2 bg-white/20 blur-[3px]" />
            </motion.div>
          </div>

          {!isEditing ? (
            <div className="flex items-center justify-between mt-1">
              {stages.map((s: any, i: number) => (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <motion.div
                    animate={{ scale: stage === i ? 1.3 : 1, opacity: i <= stage ? 1 : 0.25 }}
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
                style={{ background: currentStage.color, boxShadow: `0 0 20px ${currentStage.color}66` }}
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

      <div className="space-y-5">
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

        <div className="vibe-card p-5 border-white/10 bg-white/5 rounded-2xl">
          <div className="vibe-label flex items-center gap-2 mb-4">
            <Zap size={13} className="text-orange-400" /> Affected Nodes
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(Object.entries(lights) as [string, LightState][]).map(([id, state]) => (
              <div key={id} className="p-3 border border-white/5 bg-white/5 rounded-xl space-y-1.5">
                <div className="flex justify-between items-center gap-1">
                  <span className="text-[9px] uppercase tracking-widest text-white/40 truncate">
                    {id.includes(".") ? (id.split(".")[1] ?? id).replace(/_/g," ") : id}
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
