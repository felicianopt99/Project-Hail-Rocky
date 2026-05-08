import { useState } from "react";
import { motion } from "motion/react";
import { X, Save, Plus, Trash2, Sliders, Zap } from "lucide-react";
import { useRockyStore, Routine, RoutineAction } from "../store/useRockyStore";
import socket from "../lib/socket";

interface RoutineEditorProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function RoutineEditor({ isOpen, onClose }: RoutineEditorProps) {
  const { routines, lights } = useRockyStore();
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);

  if (!isOpen) return null;

  const saveRoutine = () => {
    if (!editingRoutine) return;
    socket.emit("save_routine", editingRoutine);
    setEditingRoutine(null);
  };

  const addAction = () => {
    if (!editingRoutine) return;
    const firstLight = Object.keys(lights)[0] ?? "";
    const newAction: RoutineAction = { device: firstLight, action: "on", params: { brightness: 100 } };
    setEditingRoutine({ ...editingRoutine, actions: [...editingRoutine.actions, newAction] });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-2xl bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]"
      >
        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Zap size={18} className="text-cyan-400" /> System Routines
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/40">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex gap-6 min-h-0">
          {/* List of routines */}
          <div className="w-1/3 space-y-2 border-r border-white/5 pr-4">
            <div className="vibe-label mb-4 opacity-40">Select Routine</div>
            {routines.map(r => (
              <button 
                key={r.id}
                onClick={() => setEditingRoutine(r)}
                className={`w-full text-left p-4 rounded-2xl border transition-all ${
                  editingRoutine?.id === r.id 
                    ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400" 
                    : "border-white/5 bg-white/5 text-white/40 hover:border-white/20"
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-widest">{r.label}</div>
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="flex-1 space-y-6">
            {!editingRoutine ? (
              <div className="h-full flex flex-col items-center justify-center text-white/20 space-y-3">
                <Sliders size={40} strokeWidth={1} />
                <div className="text-[10px] uppercase tracking-[0.2em]">Select a routine to configure</div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="vibe-label opacity-40">Label</div>
                  <input 
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-cyan-500/50 outline-none transition-all"
                    value={editingRoutine.label}
                    onChange={e => setEditingRoutine({...editingRoutine, label: e.target.value})}
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="vibe-label opacity-40">Actions sequence</div>
                    <button onClick={addAction} className="text-[9px] font-bold uppercase tracking-widest text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1">
                      <Plus size={12} /> Add Step
                    </button>
                  </div>

                  <div className="space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                    {editingRoutine.actions.map((a, i) => (
                      <div key={i} className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl space-y-3">
                        <div className="flex justify-between items-center">
                          <select 
                            className="bg-transparent border-none text-[10px] font-bold uppercase tracking-widest text-white/60 focus:ring-0 outline-none w-2/3"
                            value={a.device}
                            onChange={e => {
                              const next = [...editingRoutine.actions];
                              next[i] = { ...a, device: e.target.value };
                              setEditingRoutine({ ...editingRoutine, actions: next });
                            }}
                          >
                            {Object.entries(lights).map(([id, l]) => (
                              <option key={id} value={id} className="bg-[#0a0a0a]">{l.name}</option>
                            ))}
                          </select>
                          <button 
                            onClick={() => {
                              const next = editingRoutine.actions.filter((_, idx) => idx !== i);
                              setEditingRoutine({ ...editingRoutine, actions: next });
                            }}
                            className="text-red-400/40 hover:text-red-400"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div className="flex gap-3">
                           <select 
                            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[9px] uppercase font-bold tracking-widest outline-none"
                            value={a.action}
                            onChange={e => {
                              const next = [...editingRoutine.actions];
                              next[i] = { ...a, action: e.target.value };
                              setEditingRoutine({ ...editingRoutine, actions: next });
                            }}
                          >
                            <option value="on" className="bg-[#0a0a0a]">Turn ON</option>
                            <option value="off" className="bg-[#0a0a0a]">Turn OFF</option>
                            <option value="toggle" className="bg-[#0a0a0a]">Toggle</option>
                          </select>
                          {a.action === "on" && (
                             <input 
                              type="number" min="0" max="100"
                              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] font-mono w-20 outline-none"
                              value={(a.params?.['brightness'] as number) || 100}
                              placeholder="Bri"
                              onChange={e => {
                                const next = [...editingRoutine.actions];
                                next[i] = { ...a, params: { ...a.params, brightness: parseInt(e.target.value) } };
                                setEditingRoutine({ ...editingRoutine, actions: next });
                              }}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={saveRoutine}
                  className="w-full py-4 bg-cyan-500 text-black font-black uppercase tracking-widest text-[11px] rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
                >
                  <Save size={14} /> Commit Changes
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
