import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen, Zap, Brain, Star, Clock, Calculator,
  Globe, Newspaper, Home, Calendar, Activity,
  ToggleLeft, ToggleRight, Play, Loader2, ChevronRight,
} from "lucide-react";

interface Skill {
  id: string;
  name: string;
  enabled: boolean;
  category: string;
  description: string;
}

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  personal:     <Star size={16} />,
  knowledge:    <Brain size={16} />,
  entertainment:<BookOpen size={16} />,
  productivity: <Clock size={16} />,
  information:  <Globe size={16} />,
  utility:      <Calculator size={16} />,
  news:         <Newspaper size={16} />,
  home:         <Home size={16} />,
  calendar:     <Calendar size={16} />,
};

const CATEGORY_COLOR: Record<string, string> = {
  personal:     "text-amber-400",
  knowledge:    "text-cyan-400",
  entertainment:"text-purple-400",
  productivity: "text-green-400",
  information:  "text-blue-400",
  utility:      "text-slate-400",
  news:         "text-orange-400",
  home:         "text-yellow-400",
  calendar:     "text-pink-400",
};

const ROCKY_IDS = new Set(["rocky-diary", "rocky-mood", "rocky-science", "rocky-stories", "rocky-eli5"]);

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "enabled" | "rocky">("all");

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
