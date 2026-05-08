import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen, Zap, Brain, Star, Clock, Calculator,
  Globe, Newspaper, Home, Calendar, Activity,
  ToggleLeft, ToggleRight, Play, Loader2, ChevronRight,
  ChevronDown, RefreshCw, Wifi, WifiOff, Lightbulb,
} from "lucide-react";
import { useRockyStore } from "../store/useRockyStore";
import { useShallow } from "zustand/react/shallow";

interface Skill {
  id: string;
  name: string;
  enabled: boolean;
  category: string;
  description: string;
  type?: "tool" | "integration";
  deviceCount?: number;
  connected?: boolean;
}

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  personal:      <Star size={16} />,
  knowledge:     <Brain size={16} />,
  entertainment: <BookOpen size={16} />,
  productivity:  <Clock size={16} />,
  information:   <Globe size={16} />,
  utility:       <Calculator size={16} />,
  news:          <Newspaper size={16} />,
  home:          <Home size={16} />,
  calendar:      <Calendar size={16} />,
};

const CATEGORY_COLOR: Record<string, string> = {
  personal:      "text-amber-400",
  knowledge:     "text-cyan-400",
  entertainment: "text-purple-400",
  productivity:  "text-green-400",
  information:   "text-blue-400",
  utility:       "text-slate-400",
  news:          "text-orange-400",
  home:          "text-yellow-400",
  calendar:      "text-pink-400",
};

const ROCKY_IDS = new Set(["rocky-diary", "rocky-mood", "rocky-science", "rocky-stories", "rocky-eli5"]);

// ── Home Assistant expandable card ─────────────────────────────────────────

interface HACardProps {
  skill: Skill;
  devicesByArea: Record<string, number>;
  expanded: boolean;
  toggling: boolean;
  refreshing: boolean;
  onExpand: () => void;
  onToggle: () => void;
  onRefresh: () => void;
}

function HAIntegrationCard({
  skill, devicesByArea, expanded, toggling, refreshing,
  onExpand, onToggle, onRefresh,
}: HACardProps) {
  const areaEntries = Object.entries(devicesByArea).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`vibe-card overflow-hidden ${!skill.enabled ? "opacity-50" : ""}`}
    >
      {/* Header row */}
      <div className="p-4 flex items-center gap-3">
        {/* Icon */}
        <div className="w-9 h-9 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center shrink-0 text-yellow-400">
          <Home size={16} />
        </div>

        {/* Info */}
        <button
          className="flex-1 min-w-0 text-left"
          onClick={onExpand}
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-white">Home Assistant</span>
            {/* Connection badge */}
            {skill.connected ? (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-[8px] font-black uppercase tracking-widest text-green-400">
                <Wifi size={8} /> connected
              </span>
            ) : (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[8px] font-black uppercase tracking-widest text-white/30">
                <WifiOff size={8} /> no mcp
              </span>
            )}
            {/* Device count badge */}
            {(skill.deviceCount ?? 0) > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/20 text-[8px] font-black uppercase tracking-widest text-yellow-400">
                {skill.deviceCount} tools
              </span>
            )}
          </div>
          <p className="text-[11px] text-white/30 truncate mt-0.5">{skill.description}</p>
        </button>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Expand chevron */}
          <button
            onClick={onExpand}
            className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-white/30 hover:text-white/70 hover:border-white/30 transition-all"
            title={expanded ? "Collapse" : "Expand"}
          >
            <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={13} />
            </motion.div>
          </button>

          {/* Refresh */}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-white/30 hover:text-white/70 hover:border-white/30 transition-all disabled:opacity-30"
            title="Re-discover devices"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>

          {/* Toggle */}
          <button
            onClick={onToggle}
            disabled={toggling}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
            title={skill.enabled ? "Disable all HA tools" : "Enable all HA tools"}
          >
            {toggling
              ? <Loader2 size={18} className="animate-spin text-white/30" />
              : skill.enabled
                ? <ToggleRight size={22} className="text-amber-400" />
                : <ToggleLeft size={22} className="text-white/20" />
            }
          </button>
        </div>
      </div>

      {/* Expanded: areas with device counts */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-1">
              {areaEntries.length > 0 ? (
                <>
                  <p className="text-[10px] font-mono text-white/20 uppercase tracking-widest mb-2">
                    {skill.deviceCount ?? 0} devices across {areaEntries.length} areas
                  </p>
                  {areaEntries.map(([area, count]) => (
                    <div key={area} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-white/3 border border-white/5">
                      <Lightbulb size={12} className="text-yellow-400/60 shrink-0" />
                      <span className="text-[12px] text-white/60 flex-1">{area}</span>
                      <span className="text-[10px] font-mono text-white/30">{count} light{count !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-[11px] text-white/20 font-mono py-2">
                  {skill.connected
                    ? "No devices synced yet — open Dashboard to sync."
                    : "HA MCP server not reachable. Check HA_MCP_URL."}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "enabled" | "rocky">("all");
  const [expandedHA, setExpandedHA] = useState(false);

  // Only track area-related fields — avoids re-computing on brightness/color changes
  const lightAreaMap = useRockyStore(
    useShallow(s => Object.fromEntries(
      Object.entries(s.lights).map(([id, l]) => [
        id,
        l.areaName ?? (s.areas[l.areaId ?? ""] ?? "Uncategorized"),
      ])
    ))
  );

  const devicesByArea = useMemo(() => {
    const grouped: Record<string, number> = {};
    Object.values(lightAreaMap).forEach(area => {
      grouped[area] = (grouped[area] ?? 0) + 1;
    });
    return grouped;
  }, [lightAreaMap]);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/skills");
      if (res.ok) setSkills(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const toggle = async (id: string) => {
    setToggling(id);
    try {
      const res = await fetch(`/api/skills/${id}/toggle`, { method: "POST" });
      if (res.ok) {
        const { enabled } = await res.json();
        setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled } : s));
      }
    } finally {
      setToggling(null);
    }
  };

  const refreshHA = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/skills/home_assistant/refresh", { method: "POST" });
      await fetchSkills();
    } finally {
      setRefreshing(false);
    }
  };

  const test = async (skill: Skill) => {
    setTesting(skill.id);
    setTestResult(prev => ({ ...prev, [skill.id]: "" }));
    try {
      const res = await fetch(`/api/skills/${skill.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `test ${skill.name}`, lang: "en-us" }),
      });
      const data = await res.json();
      setTestResult(prev => ({
        ...prev,
        [skill.id]: data.result ?? data.note ?? "No response",
      }));
    } catch {
      setTestResult(prev => ({ ...prev, [skill.id]: "Error contacting service" }));
    } finally {
      setTesting(null);
    }
  };

  const filtered = skills.filter(s => {
    if (filter === "enabled") return s.enabled;
    if (filter === "rocky") return ROCKY_IDS.has(s.id);
    return true;
  });

  const enabledCount = skills.filter(s => s.enabled).length;

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar bg-black/20">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24 space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[9px] font-black uppercase tracking-[0.3em] text-amber-400">
              Skill Matrix
            </div>
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase text-white">
            Skills
          </h1>
          <p className="text-white/30 text-xs font-mono mt-1">
            {enabledCount}/{skills.length} modules active — Rocky operational
          </p>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2">
          {(["all", "enabled", "rocky"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border ${
                filter === f
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                  : "border-white/10 text-white/30 hover:text-white/60"
              }`}
            >
              {f === "rocky" ? "Rocky Custom" : f}
            </button>
          ))}
        </div>

        {/* Skills grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="text-amber-400 animate-spin" />
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {filtered.map((skill, i) => {
                // Home Assistant integration — special expandable card
                if (skill.id === "home_assistant") {
                  return (
                    <HAIntegrationCard
                      key="home_assistant"
                      skill={skill}
                      devicesByArea={devicesByArea}
                      expanded={expandedHA}
                      toggling={toggling === "home_assistant"}
                      refreshing={refreshing}
                      onExpand={() => setExpandedHA(v => !v)}
                      onToggle={() => toggle("home_assistant")}
                      onRefresh={refreshHA}
                    />
                  );
                }

                const isRocky = ROCKY_IDS.has(skill.id);
                const iconColor = CATEGORY_COLOR[skill.category] ?? "text-white/40";
                const icon = CATEGORY_ICON[skill.category] ?? <Zap size={16} />;
                const result = testResult[skill.id];

                return (
                  <motion.div
                    key={skill.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ delay: i * 0.03 }}
                    className={`vibe-card p-4 ${!skill.enabled ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Icon */}
                      <div className={`w-9 h-9 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center shrink-0 ${iconColor}`}>
                        {icon}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white truncate">{skill.name}</span>
                          {isRocky && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[8px] font-black uppercase tracking-widest text-amber-400">
                              Rocky
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-white/30 truncate">{skill.description}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => test(skill)}
                          disabled={!skill.enabled || testing === skill.id}
                          className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-white/30 hover:text-white/70 hover:border-white/30 transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                          title="Test skill"
                        >
                          {testing === skill.id
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Play size={13} fill="currentColor" />
                          }
                        </button>

                        <button
                          onClick={() => toggle(skill.id)}
                          disabled={toggling === skill.id}
                          className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                          title={skill.enabled ? "Disable" : "Enable"}
                        >
                          {toggling === skill.id
                            ? <Loader2 size={18} className="animate-spin text-white/30" />
                            : skill.enabled
                              ? <ToggleRight size={22} className="text-amber-400" />
                              : <ToggleLeft size={22} className="text-white/20" />
                          }
                        </button>
                      </div>
                    </div>

                    {/* Test result */}
                    <AnimatePresence>
                      {result && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 pt-3 border-t border-white/5 flex items-start gap-2">
                            <ChevronRight size={12} className="text-amber-400 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-white/50 font-mono">{result}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Activity size={32} className="text-white/10 mb-4" />
                <p className="text-white/30 text-sm font-mono uppercase tracking-widest">No skills match filter</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
