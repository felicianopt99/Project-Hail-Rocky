import React, { useEffect, useState, useRef } from "react";
import { motion } from "motion/react";
import {
  Cpu, Mic, Volume2, Database, Wifi, CheckCircle2, XCircle,
  User, Zap, Bell, Sliders, ChevronRight, RefreshCw, Loader2,
  Server, Brain, Activity,
} from "lucide-react";
import socket from "../lib/socket";
import { useRockyStore } from "../store/useRockyStore";

// ── Types ─────────────────────────────────────────────────────────────────

interface ServiceMap {
  llm: boolean;
  stt: boolean;
  tts: boolean;
  letta: boolean;
  speaker: boolean;
  redis: boolean;
}

interface BackendSettings {
  version: string;
  services: ServiceMap;
  llm: {
    active_model: string | null;
    providers: { groq: boolean; gemini: boolean; nvidia: boolean };
    letta_url: string | null;
  };
  voice: {
    stt_model: string;
    stt_language: string;
    tts_url: string | null;
  };
}

// ── Sub-components ────────────────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 size={14} className="text-green-400 shrink-0" />
    : <XCircle size={14} className="text-white/20 shrink-0" />;
}

function Row({ label, value, sub }: { label: string; value?: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0">
      <div>
        <div className="text-xs font-bold text-white/70">{label}</div>
        {sub && <div className="text-[10px] text-white/25 font-mono mt-0.5">{sub}</div>}
      </div>
      {value && <div className="text-xs font-mono text-white/50 text-right max-w-[55%] truncate">{value}</div>}
    </div>
  );
}

function Section({ icon, title, accent = "amber", children }: {
  icon: React.ReactNode;
  title: string;
  accent?: "amber" | "cyan" | "purple" | "green";
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    amber:  "text-amber-400 bg-amber-500/10 border-amber-500/20",
    cyan:   "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    purple: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    green:  "text-green-400 bg-green-500/10 border-green-500/20",
  };
  const c = colors[accent];
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-6 h-6 rounded-lg border flex items-center justify-center ${c}`}>
          <div className="scale-75">{icon}</div>
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40">{title}</span>
      </div>
      <div className="vibe-card p-0 overflow-hidden">
        <div className="px-4">{children}</div>
      </div>
    </section>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={value}
      className={`relative w-11 h-6 rounded-full transition-colors border touch-manipulation shrink-0 ${
        value ? "bg-amber-500/20 border-amber-500/50" : "bg-white/5 border-white/10"
      }`}
    >
      <motion.div
        animate={{ x: value ? 22 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`absolute top-1 w-4 h-4 rounded-full ${value ? "bg-amber-400" : "bg-white/30"}`}
      />
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [data, setData] = useState<BackendSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Local prefs (from Controls, kept in localStorage)
  const [userName, setUserName] = useState(() => localStorage.getItem("rocky_username") || "Human");
  const [editingName, setEditingName] = useState(false);
  const [editNameVal, setEditNameVal] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const [proactivity, setProactivity] = useState(() => localStorage.getItem("rocky_proactivity") !== "false");
  const [notifications, setNotifications] = useState(() => localStorage.getItem("rocky_notifications") !== "false");
  const [sensitivity, setSensitivity] = useState(() => parseInt(localStorage.getItem("rocky_sensitivity") || "50"));

  // Rocky live state
  const { stats, isConnected, latencyMs } = useRockyStore();

  const load = async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch("/api/settings");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Prefs handlers
  const toggleProactivity = () => {
    const next = !proactivity;
    setProactivity(next);
    localStorage.setItem("rocky_proactivity", String(next));
    socket.emit("set_proactivity", next);
  };
  const toggleNotifications = () => {
    const next = !notifications;
    setNotifications(next);
    localStorage.setItem("rocky_notifications", String(next));
  };
  const changeSensitivity = (v: number) => {
    setSensitivity(v);
    localStorage.setItem("rocky_sensitivity", String(v));
    socket.emit("set_sensitivity", {
      silenceThreshold: Math.round((100 - v) * 0.05),
      silenceTimeout: 600 + v * 20,
    });
  };
  const commitName = () => {
    const t = editNameVal.trim();
    if (t) { setUserName(t); localStorage.setItem("rocky_username", t); }
    setEditingName(false);
  };
  const startEdit = () => { setEditNameVal(userName); setEditingName(true); setTimeout(() => nameRef.current?.focus(), 50); };

  const sensitivityLabel = (v: number) =>
    v <= 25 ? "Low" : v <= 50 ? "Medium" : v <= 75 ? "High" : "Max";

  const modelShort = (m: string | null) =>
    m ? m.replace("groq/", "").replace("gemini/", "").replace("nvidia_nim/meta/", "") : "—";

  const SERVICE_LABELS: Record<keyof ServiceMap, { label: string; icon: React.ReactNode }> = {
    llm:     { label: "LLM",     icon: <Zap size={13} /> },
    stt:     { label: "STT",     icon: <Mic size={13} /> },
    tts:     { label: "TTS",     icon: <Volume2 size={13} /> },
    letta:   { label: "Letta",   icon: <Brain size={13} /> },
    speaker: { label: "Speaker", icon: <Activity size={13} /> },
    redis:   { label: "Redis",   icon: <Database size={13} /> },
  };

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar bg-black/20">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-28 space-y-6">

        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] font-black uppercase tracking-[0.3em] text-white/30">
                System Config
              </div>
            </div>
            <h1 className="text-3xl font-black tracking-tighter uppercase text-white">Settings</h1>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="w-9 h-9 rounded-xl border border-white/10 flex items-center justify-center text-white/30 hover:text-white/70 transition-all"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={22} className="text-white/20 animate-spin" />
          </div>
        ) : (
          <>
            {/* ── Service Status ────────────────────────────── */}
            <Section icon={<Server size={14} />} title="Services" accent="green">
              <div className="grid grid-cols-3 gap-0">
                {data && (Object.keys(data.services) as (keyof ServiceMap)[]).map((key, i) => {
                  const ok = data.services[key];
                  const { label, icon } = SERVICE_LABELS[key];
                  return (
                    <div
                      key={key}
                      className={`flex flex-col items-center gap-1.5 py-4 ${i % 3 !== 2 ? "border-r border-white/[0.04]" : ""} ${i < 3 ? "border-b border-white/[0.04]" : ""}`}
                    >
                      <div className={ok ? "text-green-400" : "text-white/15"}>{icon}</div>
                      <span className={`text-[9px] font-black uppercase tracking-widest ${ok ? "text-white/60" : "text-white/20"}`}>{label}</span>
                      <div className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" : "bg-white/10"}`} />
                    </div>
                  );
                })}
              </div>
            </Section>

            {/* ── Connection ────────────────────────────────── */}
            <Section icon={<Wifi size={14} />} title="Connection" accent="cyan">
              <Row label="Backend Socket" value={
                <span className={isConnected ? "text-green-400" : "text-red-400"}>
                  {isConnected ? "Connected" : "Disconnected"}
                </span>
              } />
              <Row label="Latency" value={latencyMs !== null ? `${latencyMs}ms` : "—"} />
              <Row label="CPU" value={`${stats.cpu}%`} />
              <Row label="RAM" value={`${stats.ram}%  /  ${stats.totalRam}GB`} />
            </Section>

            {/* ── LLM Config ───────────────────────────────── */}
            <Section icon={<Zap size={14} />} title="Language Model" accent="amber">
              <Row
                label="Active Model"
                value={modelShort(data?.llm.active_model ?? null)}
                sub={data?.llm.active_model ?? undefined}
              />
              <div className="flex items-center justify-between py-3 border-b border-white/[0.04]">
                <span className="text-xs font-bold text-white/70">API Keys</span>
                <div className="flex items-center gap-3">
                  {data && Object.entries(data.llm.providers).map(([provider, ok]) => (
                    <div key={provider} className="flex items-center gap-1">
                      <StatusDot ok={ok} />
                      <span className="text-[10px] font-mono text-white/30 capitalize">{provider}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Row
                label="Letta Memory"
                value={data?.llm.letta_url ? <span className="text-green-400">Active</span> : <span className="text-white/20">Disabled</span>}
                sub={data?.llm.letta_url ?? "Set LETTA_URL in .env to enable"}
              />
            </Section>

            {/* ── Voice ────────────────────────────────────── */}
            <Section icon={<Mic size={14} />} title="Voice" accent="purple">
              <Row label="STT Model" value={data?.voice.stt_model} />
              <Row label="Language" value={data?.voice.stt_language === "auto" ? "Auto-detect" : data?.voice.stt_language} />
              <Row
                label="TTS (Voice Engine)"
                value={data?.voice.tts_url ? <span className="text-green-400">Active</span> : <span className="text-white/20">Disabled</span>}
                sub={data?.voice.tts_url ?? "Set VOICE_ENGINE_URL in .env to enable"}
              />
              <div className="py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-white/70">Mic Sensitivity</span>
                  <span className="text-xs font-mono text-amber-400">{sensitivityLabel(sensitivity)}</span>
                </div>
                <input
                  type="range" min="0" max="100" value={sensitivity}
                  onChange={e => changeSensitivity(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-white/5 rounded-full appearance-none accent-amber-500"
                />
              </div>
            </Section>

            {/* ── Preferences ──────────────────────────────── */}
            <Section icon={<Sliders size={14} />} title="Preferences" accent="amber">
              {/* User name */}
              <div className="flex items-center justify-between py-3 border-b border-white/[0.04]">
                <div>
                  <div className="text-xs font-bold text-white/70">Your Name</div>
                  <div className="text-[10px] text-white/25 font-mono">Rocky uses this to address you</div>
                </div>
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      ref={nameRef}
                      value={editNameVal}
                      onChange={e => setEditNameVal(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") commitName(); if (e.key === "Escape") setEditingName(false); }}
                      className="bg-white/10 border border-amber-500/40 rounded-lg px-2 py-1 text-xs font-bold focus:outline-none w-28"
                    />
                    <button onClick={commitName} className="text-[10px] font-bold text-amber-400 uppercase tracking-widest touch-manipulation">
                      Save
                    </button>
                  </div>
                ) : (
                  <button onClick={startEdit} className="flex items-center gap-1.5 text-xs font-mono text-white/40 hover:text-white/70 transition-colors touch-manipulation">
                    {userName} <ChevronRight size={12} />
                  </button>
                )}
              </div>

              {/* Proactivity */}
              <div className="flex items-center justify-between py-3 border-b border-white/[0.04]">
                <div>
                  <div className="text-xs font-bold text-white/70">Proactive Mode</div>
                  <div className="text-[10px] text-white/25">Rocky speaks without being asked</div>
                </div>
                <Toggle value={proactivity} onChange={toggleProactivity} />
              </div>

              {/* Notifications */}
              <div className="flex items-center justify-between py-3">
                <div>
                  <div className="text-xs font-bold text-white/70">Notifications</div>
                  <div className="text-[10px] text-white/25">System alerts and reminders</div>
                </div>
                <Toggle value={notifications} onChange={toggleNotifications} />
              </div>
            </Section>

            {/* ── About ────────────────────────────────────── */}
            <Section icon={<Cpu size={14} />} title="About" accent="cyan">
              <Row label="Rocky Backend" value={`v${data?.version ?? "—"}`} />
              <Row label="Personality" value="Rocky v1.0" sub="docs/PERSONALITY.md" />
              <Row label="Hardware" value="Dell Optiplex 3040" sub="Intel i3-6100 · 12GB · 2TB HDD" />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
