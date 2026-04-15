import React, { useEffect, useState } from "react";
import { Cloud, Cpu, Database, Thermometer, ListTodo, Activity } from "lucide-react";
import socket from "../lib/socket";
import { motion } from "motion/react";

interface Stats {
  cpu: number;
  ram: number;
  temp: number;
}

interface LogEntry {
  timestamp: number;
  message: string;
}

interface LightState {
  status: "on" | "off";
  color: string;
  brightness: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ cpu: 0, ram: 0, temp: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lights, setLights] = useState<Record<string, LightState>>({});
  const [currentMode, setCurrentMode] = useState("dashboard");
  const [time, setTime] = useState(new Date());
  const [weather, setWeather] = useState({ temp: 18, desc: "Clear Sky", city: "Local" });

  useEffect(() => {
    const fetchWeather = async () => {
      const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY;
      if (!apiKey) return;

      try {
        // Default to a city or use geolocation if available
        const city = "Lisbon"; // Default city
        const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${city}&units=metric&appid=${apiKey}`);
        const data = await res.json();
        if (data.main) {
          setWeather({
            temp: Math.round(data.main.temp),
            desc: data.weather[0].description,
            city: data.name
          });
        }
      } catch (error) {
        console.error("Weather fetch error:", error);
      }
    };

    fetchWeather();
    const weatherTimer = setInterval(fetchWeather, 600000); // Update every 10 mins

    socket.on("stats", (data: Stats) => {
      setStats(data);
    });

    socket.on("initial_state", (data: any) => {
      setLogs(data.logs);
      setLights(data.lights);
      setCurrentMode(data.systemMode);
    });

    socket.on("mode_updated", (mode: string) => {
      setCurrentMode(mode);
    });

    socket.on("new_log", (log: LogEntry) => {
      setLogs(prev => [log, ...prev].slice(0, 50));
    });

    socket.on("device_updated", (data: { device: string, state: LightState }) => {
      setLights(prev => ({ ...prev, [data.device]: data.state }));
    });

    const timer = setInterval(() => setTime(new Date()), 1000);

    return () => {
      socket.off("stats");
      socket.off("initial_state");
      socket.off("mode_updated");
      socket.off("new_log");
      socket.off("device_updated");
      clearInterval(timer);
    };
  }, []);

  const toggleLight = (device: string) => {
    socket.emit("control_device", { device, action: "toggle" });
  };

  const rooms = {
    "Studio": ["studio", "desk", "ambient"],
    "Living": ["living"],
    "Kitchen": ["kitchen"],
    "Bedroom": ["bedroom"]
  };

  const routines = [
    { id: "home", label: "I'm Home", icon: <Activity size={12} />, color: "text-cyan-400" },
    { id: "night", label: "Night", icon: <Activity size={12} />, color: "text-purple-400" },
    { id: "away", label: "Away", icon: <Activity size={12} />, color: "text-red-400" },
  ];

  return (
    <div className="flex flex-col p-8 h-full space-y-6 overflow-y-auto custom-scrollbar">
      {/* Top Bar: Routines */}
      <div className="flex gap-4">
        {routines.map(r => (
          <button key={r.id} className="vibe-card px-6 py-3 border-white/5 bg-white/5 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all flex items-center gap-3 group">
            <div className={`${r.color} opacity-50 group-hover:opacity-100`}>{r.icon}</div>
            <span className="text-[10px] font-bold uppercase tracking-widest">{r.label}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        {/* Left Column: Time & Weather */}
        <div className="space-y-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="vibe-card p-6 flex flex-col justify-between h-64"
          >
            <div>
              <div className="vibe-label">System Time</div>
              <div className="text-5xl font-light tracking-tighter mt-2">
                {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
              </div>
              <div className="text-white/40 text-xs mt-1">
                {time.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
            </div>
            
            <div className="mt-8 pt-8 border-t border-white/5">
              <div className="vibe-label flex items-center gap-2">
                <Cloud size={12} className="text-cyan-400" />
                {weather.city} Atmosphere
              </div>
              <div className="flex items-baseline gap-4 mt-2">
                <div className="text-3xl font-light">{weather.temp}°C</div>
                <div className="text-white/40 text-xs uppercase tracking-widest">{weather.desc}</div>
              </div>
            </div>
          </motion.div>

          {/* Stats Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="vibe-card p-6"
          >
            <div className="vibe-label mb-6">Hardware Status</div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <div className="vibe-label !text-[8px] opacity-30">CPU LOAD</div>
                <div className="text-xl font-mono text-cyan-400">{stats.cpu}%</div>
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${stats.cpu}%` }} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="vibe-label !text-[8px] opacity-30">RAM USAGE</div>
                <div className="text-xl font-mono text-magenta-400">{(stats.ram / 1024).toFixed(1)}G</div>
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-magenta-500 transition-all duration-500" style={{ width: `${(stats.ram / 8192) * 100}%` }} />
                </div>
              </div>
              <div className="space-y-2">
                <div className="vibe-label !text-[8px] opacity-30">CORE TEMP</div>
                <div className="text-xl font-mono text-yellow-400">{stats.temp}°</div>
                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-yellow-500 transition-all duration-500" style={{ width: `${(stats.temp / 100) * 100}%` }} />
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Middle Column: Room Control */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="vibe-card p-6 lg:col-span-1 flex flex-col"
        >
          <div className="vibe-label flex items-center gap-2 mb-6">
            <Activity size={12} className="text-cyan-400" />
            Room Control
          </div>

          <div className="space-y-8 overflow-y-auto pr-2 custom-scrollbar flex-1">
            {Object.entries(rooms).map(([roomName, deviceIds]) => (
              <div key={roomName} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{roomName}</h3>
                  <div className="h-px flex-1 bg-white/5 ml-4" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {deviceIds.map(id => {
                    const state = lights[id];
                    if (!state) return null;
                    return (
                      <button 
                        key={id}
                        onClick={() => toggleLight(id)}
                        className={`vibe-card p-4 transition-all text-left group relative overflow-hidden ${state.status === 'on' ? 'border-cyan-500/50 bg-cyan-500/5' : 'hover:border-white/20'}`}
                      >
                        <div className={`text-[8px] uppercase tracking-widest mb-2 transition-colors ${state.status === 'on' ? 'text-cyan-400' : 'text-white/40 group-hover:text-white'}`}>
                          {id}
                        </div>
                        <div className="text-lg font-light font-mono leading-none">{state.status.toUpperCase()}</div>
                        {state.status === 'on' && (
                          <div className="absolute bottom-0 left-0 h-0.5 bg-cyan-500 transition-all" style={{ width: `${state.brightness}%` }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right Column: Logs */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="vibe-card p-6 flex flex-col"
        >
          <div className="vibe-label flex items-center gap-2 mb-6">
            <ListTodo size={12} className="text-yellow-400" />
            Engineering Log
          </div>
          <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className="flex items-start gap-4 group">
                <div className="text-[8px] font-mono text-white/20 mt-1 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="text-xs text-white/60 group-hover:text-white transition-colors leading-relaxed">{log.message}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
