import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity, Sliders, Zap, Moon, Sun, Save, Play,
  Cpu, Plus, Eye, Music2, Film, Sunset
} from "lucide-react";
import socket from "../lib/socket";
import { useRockyStore } from "../store/useRockyStore";

import { Protocol, ProtocolSettings } from "../store/useRockyStore";

export default function NeuralCenter() {
  const {
    activeProtocolId,
    lights: availableLights,
    protocols,
    setMode: setCurrentMode,
    setActiveProtocolId,
  } = useRockyStore();
  const [editingProtocol, setEditingProtocol] = useState<string | null>(null);
  const [tempSettings, setTempSettings] = useState<ProtocolSettings | null>(null);
  const [isDeploying, setIsDeploying] = useState<string | null>(null);
  const [livePreview, setLivePreview] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    const onDeleted = (data: { id: string }) => {
      setEditingProtocol(cur => cur === data.id ? null : cur);
    };
    socket.on("protocol_deleted", onDeleted);
    return () => { socket.off("protocol_deleted", onDeleted); };
  }, []);

  const handleCreateNew = () => {
    const id = `custom_${Date.now()}`;
    const newProto = {
      id,
      label: "New Protocol",
      description: "Custom user-defined neural parameter set",
      icon: "Cpu",
      color: "text-white",
      settings: { brightness: 100, speed: 500, color: "#ffffff", targetLights: [], features: [] }
    };
    socket.emit("create_protocol", newProto);
  };

  const handleDelete = () => {
    if (!editingProtocol) return;
    if (deleteConfirm === editingProtocol) {
      socket.emit("delete_protocol", { id: editingProtocol });
      setDeleteConfirm(null);
      setEditingProtocol(null);
    } else {
      setDeleteConfirm(editingProtocol);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  const handleEdit = (p: Protocol) => {
    setEditingProtocol(p.id);
    setTempSettings({
      ...p.settings,
      targetLights: p.settings.targetLights || [],
      palette: p.settings.palette || [p.settings.color],
    });
  };

  const handleSave = () => {
    if (editingProtocol && tempSettings) {
      socket.emit("save_protocol", { id: editingProtocol, settings: tempSettings });
      setEditingProtocol(null);
    }
  };

  const handleDeploy = (id: string) => {
    setIsDeploying(id);
    if (editingProtocol === id && tempSettings) {
      socket.emit("save_protocol", { id, settings: tempSettings });
    }
    socket.emit("set_mode", id);
    setCurrentMode("protocols");
    setActiveProtocolId(id);
    setTimeout(() => setIsDeploying(null), 1000);
  };

  const updateSetting = (key: keyof ProtocolSettings, value: any) => {
    if (!tempSettings) return;
    const newSettings = { ...tempSettings, [key]: value };
    setTempSettings(newSettings);

    if (livePreview && (key === "brightness" || key === "color")) {
       newSettings.targetLights?.forEach(entity => {
          socket.emit("control_device", { 
             device: entity, 
             action: "on", 
             params: { brightness: newSettings.brightness, color: newSettings.color } 
          });
       });
    }
  };

  const toggleLightSelection = (entityId: string) => {
    if (!tempSettings) return;
    const current = tempSettings.targetLights || [];
    const updated = current.includes(entityId)
      ? current.filter(id => id !== entityId)
      : [...current, entityId];
    updateSetting("targetLights", updated);
  };

  const getIcon = (name: string, size = 20) => {
    switch (name) {
      case "Zap": return <Zap size={size} />;
      case "Activity": return <Activity size={size} />;
      case "Moon": return <Moon size={size} />;
      case "Sun": return <Sun size={size} />;
      case "Music2": return <Music2 size={size} />;
      case "Film": return <Film size={size} />;
      case "Sunset": return <Sunset size={size} />;
      default: return <Cpu size={size} />;
    }
  };

  const selectedProtocol = protocols.find(p => p.id === editingProtocol);
  const lightIds = Object.keys(availableLights);

  return (
    <div className="h-full w-full bg-black/40 backdrop-blur-3xl p-8 overflow-y-auto custom-scrollbar relative">
      <div className="max-w-7xl mx-auto space-y-12 pb-20">
        {/* Header Section */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-[9px] font-black uppercase tracking-[0.3em] text-cyan-400">
                Centralized Control
              </div>
              <div className="h-px w-12 bg-white/10" />
            </div>
            <h1 className="text-5xl font-black tracking-tighter uppercase italic text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]">
              Neural Center
            </h1>
            <p className="text-white/40 mt-3 text-sm font-medium max-w-xl">
              Unified interface for brain presets and studio atmospherics. 
              Efficiency is priority one, yes?
            </p>
          </div>
          
          <div className="flex gap-4">
            <div className="premium-glass px-6 py-4 rounded-2xl flex items-center gap-4 bg-white/[0.02]">
              <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)] animate-pulse" />
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-widest text-white/90">Sync Status</span>
                <span className="text-[9px] font-mono text-white/30 uppercase">v2.4.0_STABLE</span>
              </div>
            </div>
          </div>
        </header>

        {/* Rapid Deploy — all protocols from DB */}
        {protocols.length > 0 && (
          <section className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="vibe-label text-white/60">Rapid Deploy</div>
              <div className="h-px flex-1 bg-white/5" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {protocols.map((p) => {
                const isActive = activeProtocolId === p.id;
                return (
                  <motion.button
                    key={p.id}
                    onClick={() => handleDeploy(p.id)}
                    whileTap={{ scale: 0.95 }}
                    className={`premium-glass py-5 px-4 rounded-2xl flex items-center gap-3 transition-all text-left relative overflow-hidden touch-manipulation min-h-[72px] ${
                      isActive
                        ? "border-cyan-500/40 bg-cyan-500/5 shadow-[0_0_24px_rgba(0,255,255,0.08)]"
                        : "active:bg-white/[0.06]"
                    }`}
                  >
                    {isActive && <div className="absolute top-0 left-0 w-1 h-full bg-cyan-400 rounded-r" />}
                    <div className={`w-10 h-10 rounded-xl bg-black/40 flex items-center justify-center shrink-0 ${p.color}`}>
                      {getIcon(p.icon, 20)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-black uppercase tracking-widest text-white/90 truncate">{p.label}</div>
                      {isActive && <div className="text-[8px] font-mono text-cyan-400/60 uppercase mt-0.5">Active</div>}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </section>
        )}

        {/* Main Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Protocol Sidebar */}
          <div className="lg:col-span-4 space-y-6">
            <div className="flex justify-between items-center">
              <div className="vibe-label text-white/30">Neural Nodes</div>
              <button 
                onClick={handleCreateNew}
                className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:bg-cyan-500 hover:text-black hover:border-cyan-500 transition-all"
              >
                <Plus size={18} />
              </button>
            </div>
            
            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
              {protocols.map((p) => (
                <div 
                  key={p.id}
                  onClick={() => handleEdit(p)}
                  className={`vibe-card p-5 border transition-all cursor-pointer group relative ${
                    editingProtocol === p.id 
                    ? "border-cyan-500/40 bg-cyan-500/5" 
                    : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl bg-black/40 flex items-center justify-center ${p.color} border border-white/5`}>
                      {getIcon(p.icon)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold truncate group-hover:text-cyan-400 transition-colors">{p.label}</h3>
                        {activeProtocolId === p.id && (
                          <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" />
                        )}
                      </div>
                      <p className="text-[10px] text-white/30 truncate uppercase tracking-widest font-mono mt-0.5">{p.id}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Config Detail Area */}
          <div className="lg:col-span-8">
            <AnimatePresence mode="wait">
              {editingProtocol && selectedProtocol && tempSettings ? (
                <motion.div 
                  key={editingProtocol}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="premium-glass p-10 rounded-[2rem] bg-white/[0.02] border-white/10 flex flex-col h-full relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 blur-[100px] pointer-events-none" />
                  
                  <div className="flex justify-between items-start mb-12">
                    <div className="flex items-center gap-6">
                      <div className={`p-6 rounded-2xl bg-black/40 border border-white/10 ${selectedProtocol.color} shadow-2xl`}>
                        {getIcon(selectedProtocol.icon, 32)}
                      </div>
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.4em] text-white/20 mb-2">Protocol Override</div>
                        <h2 className="text-4xl font-black tracking-tighter text-white">{selectedProtocol.label}</h2>
                      </div>
                    </div>
                    <div className="flex gap-3">
                       <button 
                         onClick={() => setLivePreview(!livePreview)}
                         className={`px-5 py-2.5 rounded-xl border text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
                           livePreview 
                           ? "border-green-500/50 bg-green-500/10 text-green-400 shadow-[0_0_20px_rgba(34,197,94,0.15)]" 
                           : "border-white/10 bg-white/5 text-white/30 hover:text-white"
                         }`}
                       >
                         <Eye size={14} /> {livePreview ? "Live Sync Active" : "Preview Inactive"}
                       </button>
                    </div>
                  </div>

                  <div className="space-y-12 flex-1 overflow-y-auto pr-4 custom-scrollbar">
                    {/* Params */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                      <div className="space-y-6">
                         <div className="flex justify-between items-end">
                           <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Power Output</span>
                           <span className="text-cyan-400 font-mono text-lg font-bold">{tempSettings.brightness}%</span>
                         </div>
                         <input 
                           type="range" 
                           min="0" max="100"
                           value={tempSettings.brightness}
                           onChange={(e) => updateSetting("brightness", parseInt(e.target.value))}
                           className="w-full h-1.5 bg-white/10 rounded-full appearance-none accent-cyan-500" 
                         />
                      </div>
                      <div className="space-y-6">
                         <div className="flex justify-between items-end">
                           <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Neural Frequency</span>
                           <span className="text-cyan-400 font-mono text-lg font-bold">{tempSettings.speed}ms</span>
                         </div>
                         <input 
                           type="range" 
                           min="10" max="1000" step="10"
                           value={tempSettings.speed}
                           onChange={(e) => updateSetting("speed", parseInt(e.target.value))}
                           className="w-full h-1.5 bg-white/10 rounded-full appearance-none accent-cyan-500" 
                         />
                      </div>
                    </div>

                    {/* Light Mapping */}
                    <div className="space-y-6">
                      <div className="vibe-label text-cyan-400/50">Target Nodes</div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {lightIds.map((id) => {
                          const isSelected = tempSettings.targetLights?.includes(id);
                          const name = id.includes('.') ? id.split('.')[1].replace(/_/g, ' ') : id;
                          return (
                            <button
                              key={id}
                              onClick={() => toggleLightSelection(id)}
                              className={`p-4 rounded-2xl border transition-all text-left relative overflow-hidden ${
                                isSelected ? "border-cyan-500/40 bg-cyan-500/10 text-white" : "border-white/5 bg-white/[0.01] text-white/20"
                              }`}
                            >
                              <div className="text-[11px] font-bold uppercase truncate">{name}</div>
                              <div className="text-[8px] font-mono opacity-40 uppercase truncate">{id}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="pt-8 border-t border-white/5 flex flex-col gap-3">
                      <div className="flex gap-3">
                        <motion.button
                          onClick={() => handleDeploy(editingProtocol)}
                          whileTap={{ scale: 0.97 }}
                          disabled={activeProtocolId === editingProtocol || isDeploying === editingProtocol}
                          className={`flex-1 py-5 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] flex items-center justify-center gap-3 transition-all touch-manipulation ${
                            activeProtocolId === editingProtocol
                              ? "bg-white/10 text-white/20 border border-white/5"
                              : "bg-cyan-500 text-black shadow-[0_8px_24px_rgba(6,182,212,0.3)] active:scale-95"
                          }`}
                        >
                          <Play size={16} fill="currentColor" />
                          {activeProtocolId === editingProtocol ? "Protocol Active" : "Deploy"}
                        </motion.button>
                        <motion.button
                          onClick={handleSave}
                          whileTap={{ scale: 0.97 }}
                          className="px-6 py-5 bg-white/5 border border-white/10 rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] text-white/50 active:text-white active:bg-white/10 transition-all flex items-center justify-center gap-2 touch-manipulation"
                        >
                          <Save size={15} />
                          Save
                        </motion.button>
                      </div>
                      {/* Inline delete confirm */}
                      <motion.button
                        onClick={handleDelete}
                        whileTap={{ scale: 0.97 }}
                        className={`w-full py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all touch-manipulation border ${
                          deleteConfirm === editingProtocol
                            ? "border-red-500/60 bg-red-500/15 text-red-400"
                            : "border-white/5 text-white/20 active:border-red-500/30 active:text-red-400"
                        }`}
                      >
                        {deleteConfirm === editingProtocol ? "Tap again to erase from memory" : "Delete Protocol"}
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-20 premium-glass rounded-[2rem] bg-white/[0.01] border-dashed border-white/10">
                  <div className="w-20 h-20 rounded-full bg-white/[0.02] flex items-center justify-center text-white/10 mb-8 border border-white/5">
                    <Activity size={40} className="animate-pulse" />
                  </div>
                  <h3 className="text-2xl font-black uppercase tracking-widest text-white/90">Awaiting Command</h3>
                  <p className="text-sm text-white/20 mt-4 max-w-xs font-medium">
                    Select a neural node to initialize specialized hardware parameters.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
