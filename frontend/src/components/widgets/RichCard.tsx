import React from "react";
import { Cloud, Sparkles, Timer, Zap, MapPin, Wind, Thermometer, Sliders } from "lucide-react";
import { motion } from "motion/react";

interface RichCardProps {
  data: any;
}

export default function RichCard({ data }: RichCardProps) {
  switch (data.type) {
    case 'weather':
      return <WeatherWidget data={data} />;
    case 'suggestion':
      return <SuggestionWidget data={data} />;
    case 'timer':
      return <TimerWidget data={data} />;
    case 'hardware':
      return <HardwareWidget data={data} />;
    case 'location':
      return <LocationWidget data={data} />;
    default:
      return (
        <div className="p-2 bg-black/20 rounded-lg border border-white/5">
          <pre className="text-[9px] font-mono text-white/40 overflow-x-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      );
  }
}

function WeatherWidget({ data }: { data: any }) {
  return (
    <div className="flex flex-col gap-4 min-w-[240px] p-2">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2 text-cyan-400">
          <Cloud size={16} />
          <span className="text-[10px] font-bold uppercase tracking-widest">{data.city || 'Atmosphere'}</span>
        </div>
        <div className="text-[8px] font-mono text-white/20 uppercase tracking-widest">Neural_Met_Link</div>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="text-5xl font-light tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]">
          {data.temp}<span className="text-2xl text-cyan-500/50">°C</span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-[10px] text-white/80 uppercase tracking-widest font-bold">{data.desc}</div>
          <div className="flex items-center gap-3 opacity-40">
            <div className="flex items-center gap-1">
              <Thermometer size={10} />
              <span className="text-[9px] font-mono">{data.feels_like || data.temp}°</span>
            </div>
            <div className="flex items-center gap-1">
              <Wind size={10} />
              <span className="text-[9px] font-mono">{data.wind || '0'}km/h</span>
            </div>
          </div>
        </div>
      </div>

      <div className="h-px w-full bg-gradient-to-r from-cyan-500/20 via-transparent to-transparent" />
    </div>
  );
}

function SuggestionWidget({ data }: { data: any }) {
  return (
    <div className="flex flex-col gap-4 min-w-[240px] p-2">
      <div className="flex items-center gap-2 text-purple-400">
        <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
          <Sparkles size={14} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest">Neural Suggestion</span>
      </div>
      
      <p className="text-[12px] leading-relaxed text-white/80 font-medium">
        {data.text}
      </p>

      <div className="grid grid-cols-1 gap-2 pt-2">
        <button className="flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-[0.2em] text-cyan-400 bg-cyan-500/5 border border-cyan-500/20 rounded-xl px-4 py-3 hover:bg-cyan-500/10 transition-all hover:scale-[1.02] active:scale-[0.98] group">
          <Zap size={12} className="group-hover:animate-pulse" />
          Execute Protocol
        </button>
      </div>
    </div>
  );
}

function TimerWidget({ data }: { data: any }) {
  return (
    <div className="flex flex-col gap-4 min-w-[240px] p-2">
      <div className="flex justify-between items-center text-amber-400">
        <div className="flex items-center gap-2">
          <Timer size={16} />
          <span className="text-[10px] font-bold uppercase tracking-widest">Temporal Node</span>
        </div>
        <span className="text-[8px] font-mono opacity-40">T-MINUS</span>
      </div>

      <div className="flex flex-col items-center py-2">
        <div className="text-4xl font-mono tracking-widest text-white">
          {data.time || '00:00'}
        </div>
        <div className="text-[9px] text-white/30 uppercase tracking-[0.3em] mt-1">
          {data.label || 'Active Countdown'}
        </div>
      </div>

      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: "100%" }}
          animate={{ width: "30%" }}
          transition={{ duration: 10, ease: "linear" }}
          className="h-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
        />
      </div>
    </div>
  );
}

function HardwareWidget({ data }: { data: any }) {
  return (
    <div className="flex flex-col gap-4 min-w-[240px] p-2">
      <div className="flex items-center gap-2 text-emerald-400">
        <Sliders size={16} />
        <span className="text-[10px] font-bold uppercase tracking-widest">Hardware Sync</span>
      </div>

      <div className="space-y-3">
        {data.metrics?.map((m: any, i: number) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-between text-[9px] uppercase tracking-widest">
              <span className="text-white/40">{m.label}</span>
              <span className="text-white/80 font-mono">{m.value}{m.unit}</span>
            </div>
            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-500/50" 
                style={{ width: `${m.percent || 50}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LocationWidget({ data }: { data: any }) {
  return (
    <div className="flex flex-col gap-3 min-w-[240px] p-2">
      <div className="flex items-center gap-2 text-blue-400">
        <MapPin size={16} />
        <span className="text-[10px] font-bold uppercase tracking-widest">Spatial Reference</span>
      </div>
      <div className="p-3 bg-white/5 border border-white/10 rounded-2xl">
        <div className="text-xs font-bold text-white mb-1">{data.address || 'Unknown Sector'}</div>
        <div className="text-[9px] text-white/40 font-mono">{data.coords || '0.000, 0.000'}</div>
      </div>
    </div>
  );
}
