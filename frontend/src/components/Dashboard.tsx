import { useEffect, useState, useRef } from "react";
import { Cloud, RefreshCw, Activity, ListTodo, Cpu } from "lucide-react";
import socket from "../lib/socket";
import { motion } from "motion/react";
import { LightState, useStats, useLogs, useLights, useWeather, useIsConnected, useLatency, useServiceStatus, useRoutines } from "../store/useRockyStore";
import RoutineEditor from "./RoutineEditor";
import { LightButton } from "./LightButton";
import { Settings2 } from "lucide-react";

// React Compiler handles memoization for these sub-components automatically.
function StatCard({
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
        <span className="vibe-label text-[8px]! opacity-30">{label}</span>
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
}

function TimeDisplay() {
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
}

export default function Dashboard() {
  const stats = useStats();
  const logs = useLogs();
  const lights = useLights();
  const weather = useWeather();
  const isConnected = useIsConnected();
  const latencyMs = useLatency();
  const serviceStatus = useServiceStatus();
  const routines = useRoutines();

  const [isSyncing, setIsSyncing] = useState(false);
  const [isRoutineEditorOpen, setIsRoutineEditorOpen] = useState(false);
  const syncTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    socket.emit("get_routines", {});
    socket.emit("sync_ha", {});
  }, []);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []);

  // React Compiler memoizes these automatically — no useCallback needed.
  const toggleLight = (device: string) => {
    socket.emit("control_device", { device, action: "toggle" });
  };

  const updateLight = (device: string, params: Partial<LightState>) => {
    socket.emit("control_device", { device, action: "set", params });
  };

  const syncDevices = () => {
    setIsSyncing(true);
    socket.emit("sync_ha", {});
    syncTimerRef.current = setTimeout(() => setIsSyncing(false), 2000);
  };

  const executeRoutine = (routineId: string) => {
    socket.emit("execute_routine", routineId);
  };

  // Room grouping — React Compiler memoizes this derived value automatically.
  const rooms: Record<string, string[]> = {};
  const other: string[] = [];
  Object.keys(lights).forEach(id => {
    const light = lights[id];
    const areaName = light?.areaName;
    if (areaName) {
      if (!rooms[areaName]) rooms[areaName] = [];
      rooms[areaName].push(id);
    } else {
      const name = light?.name?.toLowerCase() ?? "";
      const roomList = ["Living Room", "Bedroom", "Kitchen", "Bathroom", "Office", "Studio", "Hallway", "Garage", "Garden"];
      const roomMatch = roomList.find(r => name.includes(r.toLowerCase()));
      if (roomMatch) {
        if (!rooms[roomMatch]) rooms[roomMatch] = [];
        rooms[roomMatch].push(id);
      } else {
        const idNamePart = id.split(".")[1];
        if (idNamePart) {
          const parts = idNamePart.split("_");
          if (parts.length > 1) {
            const room = (parts[0]?.charAt(0).toUpperCase() ?? "") + (parts[0]?.slice(1) ?? "");
            if (!rooms[room]) rooms[room] = [];
            rooms[room].push(id);
          } else {
            other.push(id);
          }
        } else {
          other.push(id);
        }
      }
    }
  });
  const categorizedRooms = rooms;
  const otherDevices = other;

  return (
    <div className="flex flex-col p-8 h-full space-y-6 overflow-y-auto custom-scrollbar bg-black">
      {/* Top Bar: Routines & Status */}
      <div className="flex gap-4 justify-between items-center">
        <div className="flex gap-4">
          {routines.map(r => (
            <button
              key={r.id}
              onClick={() => executeRoutine(r.id)}
              className="vibe-card px-6 py-3 border-white/5 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all flex items-center gap-3 group"
            >
              <Activity size={12} className={`${r.color} opacity-50 group-hover:opacity-100`} />
              <span className="text-[10px] font-bold uppercase tracking-widest">{r.label}</span>
            </button>
          ))}
          <button
            onClick={() => setIsRoutineEditorOpen(true)}
            className="vibe-card px-4 py-3 border-dashed border-white/10 bg-white/2 hover:border-white/20 transition-all flex items-center justify-center text-white/20 hover:text-white/40"
            title="Edit Routines"
          >
            <Settings2 size={12} />
          </button>
        </div>

        {/* Status Indicators */}
        <div className="flex items-center gap-4 text-[10px]">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-cyan-400" : "bg-red-400"}`} />
            <span className="text-white/40">{isConnected ? (latencyMs !== null ? `${latencyMs}ms` : "Connected") : "Offline"}</span>
          </div>
          <div className="w-px h-4 bg-white/10" />
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${serviceStatus.voice_engine ? "bg-cyan-400" : "bg-white/20"}`} />
            <span className="text-white/40">Voice engine</span>
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
            className="vibe-card p-6 flex flex-col justify-between h-72 lg:h-80 relative overflow-hidden"
          >
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-cyan-500/10 blur-[80px] rounded-full pointer-events-none" />

            <TimeDisplay />
            <div className="mt-auto pt-6 border-t border-white/5 relative z-10">
              <div className="flex justify-between items-start mb-4">
                <div className="vibe-label flex items-center gap-2">
                  <Cloud size={12} className="text-cyan-400" /> Atmosphere
                </div>
                <div className="text-[10px] font-mono text-white/30 uppercase tracking-tighter">
                  {weather.city}
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-4xl font-light tracking-tighter text-white">
                  {weather.temp}<span className="text-cyan-500/50">°C</span>
                </div>
                <div className="flex flex-col">
                  <div className="text-[10px] font-bold text-white/80 uppercase tracking-widest leading-tight max-w-[150px] line-clamp-2">
                    {weather.desc}
                  </div>
                  <div className="text-[8px] text-white/30 mt-1 font-mono uppercase">
                    Local readout · Nominal
                  </div>
                </div>
              </div>
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
              Object.entries(categorizedRooms).sort(([a], [b]) => a.localeCompare(b)).map(([roomName, ids]: [string, string[]]) => (
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
                        state={lights[id]!}
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
                      state={lights[id]!}
                      onUpdate={updateLight}
                      onToggle={toggleLight}
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
            {[...logs].reverse().map((log, i) => (
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
      <RoutineEditor isOpen={isRoutineEditorOpen} onClose={() => setIsRoutineEditorOpen(false)} />
    </div>
  );
}
