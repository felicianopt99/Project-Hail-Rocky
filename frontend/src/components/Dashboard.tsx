import React, { useEffect, useState, memo } from "react";
import { Cloud, Wifi, RefreshCw, Activity, ListTodo, Cpu } from "lucide-react";
import socket from "../lib/socket";
import { motion } from "motion/react";
import { LightButton } from "./LightButton";
import { useRockyStore, LightState } from "../store/useRockyStore";

const ROUTINES = [
  { id: "home", label: "I'm Home", icon: Activity, color: "text-cyan-400" },
  { id: "night", label: "Night", icon: Activity, color: "text-purple-400" },
  { id: "away", label: "Away", icon: Activity, color: "text-red-400" },
];

const StatCard = memo(function StatCard({
  label,
  value,
  percentage,
  color = "cyan"
}: {
  label: string;
  value: string | number;
  percentage: number;
  color?: "cyan" | "magenta" | "yellow";
}) {
  const colorMap = {
    cyan: "text-cyan-400 bg-cyan-500",
    magenta: "text-magenta-400 bg-magenta-500",
    yellow: "text-yellow-400 bg-yellow-500",
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="vibe-label !text-[8px] opacity-30">{label}</span>
        <span className={`text-sm font-mono font-bold ${colorMap[color].split(" ")[0]}`}>
          {value}
        </span>
      </div>
      <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${colorMap[color].split(" ")[1]} transition-all duration-500`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
});

const TimeDisplay = memo(function TimeDisplay() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div className="vibe-label mb-4">System Time</div>
      <div className="text-5xl font-light tracking-tighter leading-none">
        {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
      </div>
      <div className="text-white/40 text-xs mt-3">
        {time.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
      </div>
    </div>
  );
});

export default function Dashboard() {
  const { stats, logs, lights, weather, isConnected, latencyMs, serviceStatus } = useRockyStore();
  const [isSyncing, setIsSyncing] = useState(false);

  const toggleLight = (device: string) => {
    socket.emit("control_device", { device, action: "toggle" });
  };

  const updateLight = (device: string, params: Partial<LightState>) => {
    socket.emit("control_device", { device, action: "set", params });
  };

  const syncDevices = () => {
    setIsSyncing(true);
    socket.emit("sync_ha");
    setTimeout(() => setIsSyncing(false), 2000);
  };

  const executeRoutine = (routineId: string) => {
    socket.emit("execute_routine", routineId);
  };

  const categorizedRooms: Record<string, string[]> = {};
  const otherDevices: string[] = [];

  Object.keys(lights).forEach(id => {
    const light = lights[id];
    const areaName = light?.areaName;
    if (areaName) {
      if (!categorizedRooms[areaName]) categorizedRooms[areaName] = [];
      categorizedRooms[areaName].push(id);
    } else {
      // Use the name for categorization if it contains a clear room hint
      const name = light.name.toLowerCase();
      const rooms = ["Living Room", "Bedroom", "Kitchen", "Bathroom", "Office", "Studio", "Hallway", "Garage", "Garden"];
      const roomMatch = rooms.find(r => name.includes(r.toLowerCase()));
      
      if (roomMatch) {
        if (!categorizedRooms[roomMatch]) categorizedRooms[roomMatch] = [];
        categorizedRooms[roomMatch].push(id);
      } else {
        const idNamePart = id.split(".")[1];
        if (idNamePart) {
          const parts = idNamePart.split("_");
          if (parts.length > 1) {
            const room = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
            if (!categorizedRooms[room]) categorizedRooms[room] = [];
            categorizedRooms[room].push(id);
          } else {
            otherDevices.push(id);
          }
        } else {
          otherDevices.push(id);
        }
      }
    }
  });

  return (
    <div className="flex flex-col p-8 h-full space-y-6 overflow-y-auto custom-scrollbar bg-black">
      {/* Top Bar: Routines & Status */}
      <div className="flex gap-4 justify-between items-center">
        <div className="flex gap-4">
          {ROUTINES.map(r => (
            <button
              key={r.id}
              onClick={() => executeRoutine(r.id)}
              className="vibe-card px-6 py-3 border-white/5 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all flex items-center gap-3 group"
            >
              <r.icon size={12} className={`${r.color} opacity-50 group-hover:opacity-100`} />
              <span className="text-[10px] font-bold uppercase tracking-widest">{r.label}</span>
            </button>
          ))}
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-4 text-[10px]">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-cyan-400" : "bg-red-400"}`} />
            <span className="text-white/40">{isConnected ? (latencyMs !== null ? `${latencyMs}ms` : "Connected") : "Offline"}</span>
          </div>
          <div className="w-px h-4 bg-white/10" />
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${serviceStatus.wakeword ? "bg-cyan-400" : "bg-white/20"}`} />
            <span className="text-white/40">Wake word</span>
          </div>
          <button
            onClick={syncDevices}
            className="ml-4 p-1.5 rounded hover:bg-white/5 transition-colors"
            title="Sync with Home Assistant"
          >
            <RefreshCw size={12} className={`text-white/40 ${isSyncing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Main Grid: 3 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        {/* Left Column: Time & Weather & Stats */}
        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="vibe-card p-6 flex flex-col justify-between h-64"
          >
            <TimeDisplay />
            <div className="mt-8 pt-8 border-t border-white/5">
              <div className="vibe-label flex items-center gap-2 mb-3">
                <Cloud size={12} className="text-cyan-400" />
                Atmosphere
              </div>
              <div className="flex items-baseline gap-4">
                <div className="text-3xl font-light">{weather.temp}°C</div>
                <div className="text-white/40 text-xs uppercase tracking-widest">{weather.desc}</div>
              </div>
              <div className="text-[9px] text-white/20 mt-2">{weather.city}</div>
            </div>
          </motion.div>

          {/* Hardware Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="vibe-card p-6"
          >
            <div className="vibe-label mb-6 flex items-center gap-2">
              <Cpu size={12} className="text-cyan-400" />
              Hardware Status
            </div>
            <div className="space-y-4">
              <StatCard label="CPU Load" value={`${Math.round(stats.cpu)}%`} percentage={stats.cpu} color="cyan" />
              <StatCard label="Memory" value={`${stats.ram.toFixed(1)}G`} percentage={(stats.ram / stats.totalRam) * 100} color="magenta" />
              <StatCard label="Temperature" value={`${Math.round(stats.temp)}°`} percentage={stats.temp} color="yellow" />
            </div>
          </motion.div>
        </div>

        {/* Middle Column: Room Control */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="vibe-card p-6 lg:col-span-1 flex flex-col min-h-0"
        >
          <div className="vibe-label flex items-center gap-2 mb-6">
            <Activity size={12} className="text-cyan-400" />
            Room Control
          </div>

          <div className="space-y-8 overflow-y-auto pr-2 custom-scrollbar flex-1">
            {Object.entries(categorizedRooms).length > 0 ? (
              Object.entries(categorizedRooms).sort(([a], [b]) => a.localeCompare(b)).map(([roomName, ids]) => (
                <div key={roomName} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{roomName}</h3>
                    <div className="h-px flex-1 bg-white/5 ml-4" />
                    <span className="ml-4 text-[8px] font-mono text-white/20">{ids.length} nodes</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {ids.map(id => (
                      <LightButton
                        key={id}
                        id={id}
                        state={lights[id]}
                        onToggle={toggleLight}
                        onUpdate={updateLight}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-40 border border-dashed border-white/5 rounded-xl opacity-20">
                <span className="text-[10px] uppercase tracking-widest">No active nodes detected</span>
              </div>
            )}

            {otherDevices.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Unassigned</h3>
                  <div className="h-px flex-1 bg-white/5 ml-4" />
                </div>
                <div className="flex flex-col gap-3">
                  {otherDevices.map(id => (
                    <LightButton
                      key={id}
                      id={id}
                      state={lights[id]}
                      onToggle={toggleLight}
                      onUpdate={updateLight}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Right Column: Activity Log */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="vibe-card p-6 flex flex-col"
        >
          <div className="vibe-label flex items-center gap-2 mb-6">
            <ListTodo size={12} className="text-yellow-400" />
            Activity Log
          </div>
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            {logs.slice().reverse().map((log, i) => (
              <div key={i} className="flex items-start gap-3 group">
                <div className="text-[8px] font-mono text-white/20 mt-0.5 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="text-[9px] text-white/60 group-hover:text-white/80 transition-colors leading-relaxed">
                  {log.message}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
