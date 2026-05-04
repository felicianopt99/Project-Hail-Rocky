import React, { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, Brain, Clock, AlertTriangle, Loader2, Trash2, User, Cpu } from "lucide-react";

interface Memory {
  text?: string;
  content?: string;
  timestamp?: string;
  created_at?: string;
  importance?: number;
  context?: string;
}

interface CoreMemory {
  persona?: { value: string };
  human?: { value: string };
}

interface Profile {
  available: boolean;
  note?: string;
  memory?: CoreMemory;
}

function formatDate(ts?: string): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return ts;
  }
}

function memoryText(m: Memory): string {
  return m.text ?? m.content ?? "";
}

function memoryDate(m: Memory): string {
  return formatDate(m.timestamp ?? m.created_at);
}

export default function MemoriesPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recent, setRecent] = useState<Memory[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Memory[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [forgetStage, setForgetStage] = useState<"idle" | "confirm" | "working">("idle");
  const [forgetResult, setForgetResult] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [profileRes, recentRes] = await Promise.allSettled([
      fetch("/api/memory/profile"),
      fetch("/api/memory/recent"),
    ]);

    if (profileRes.status === "fulfilled" && profileRes.value.ok) {
      setProfile(await profileRes.value.json());
    }
    if (recentRes.status === "fulfilled" && recentRes.value.ok) {
      const data = await recentRes.value.json();
      setRecent(data.memories ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim() || q.length < 2) {
      setSearchResults(null);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/memory/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results ?? []);
        }
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  const handleForget = async () => {
    if (forgetStage === "idle") { setForgetStage("confirm"); return; }
    if (forgetStage === "confirm") {
      setForgetStage("working");
      try {
        const res = await fetch("/api/memory/forget-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: "YES_FORGET_EVERYTHING" }),
        });
        const data = await res.json();
        setForgetResult(data.message ?? (res.ok ? "Memory cleared." : "Failed."));
        setRecent([]);
        setProfile(null);
        setSearchResults(null);
      } catch {
        setForgetResult("Error contacting server.");
      } finally {
        setForgetStage("idle");
      }
    }
  };

  const displayList = searchResults ?? recent;
  const isSearch = searchResults !== null;

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar bg-black/20">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-24 space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-[9px] font-black uppercase tracking-[0.3em] text-purple-400">
              Archival Memory
            </div>
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase text-white">Memories</h1>
          <p className="text-white/30 text-xs font-mono mt-1">
            What Rocky remembers about you
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search memories…"
            className="w-full bg-white/[0.03] border border-white/10 rounded-2xl pl-9 pr-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/40 focus:bg-white/[0.05] transition-all font-mono"
          />
          {searching && (
            <Loader2 size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-purple-400 animate-spin" />
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="text-purple-400 animate-spin" />
          </div>
        ) : (
          <>
            {/* Core memory profile */}
            {!isSearch && profile && (
              <section className="space-y-3">
                <div className="vibe-label text-white/30">Core Memory</div>
                {!profile.available ? (
                  <div className="vibe-card p-4 flex items-center gap-3 border-dashed">
                    <Brain size={18} className="text-white/20 shrink-0" />
                    <p className="text-xs text-white/30 font-mono">{profile.note ?? "Letta not running"}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {profile.memory?.human?.value && (
                      <div className="vibe-card p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <User size={13} className="text-purple-400" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">Human Profile</span>
                        </div>
                        <p className="text-xs text-white/60 font-mono leading-relaxed whitespace-pre-wrap">
                          {profile.memory.human.value}
                        </p>
                      </div>
                    )}
                    {profile.memory?.persona?.value && (
                      <div className="vibe-card p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Cpu size={13} className="text-amber-400" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">Rocky Persona</span>
                        </div>
                        <p className="text-xs text-white/40 font-mono leading-relaxed line-clamp-4">
                          {profile.memory.persona.value}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* Memory list */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="vibe-label text-white/30">
                  {isSearch ? `Results for "${searchQuery}"` : "Recent Memories"}
                </div>
                {isSearch && searchResults && (
                  <span className="text-[10px] font-mono text-white/20">{searchResults.length} found</span>
                )}
              </div>

              <AnimatePresence mode="popLayout">
                {displayList.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center py-12 text-center"
                  >
                    <Brain size={28} className="text-white/10 mb-3" />
                    <p className="text-white/20 text-xs font-mono uppercase tracking-widest">
                      {isSearch ? "No memories match query" : "No memories yet"}
                    </p>
                  </motion.div>
                ) : (
                  displayList.map((m, i) => (
                    <motion.div
                      key={`${i}-${memoryDate(m)}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ delay: i * 0.02 }}
                      className="vibe-card p-4"
                    >
                      <p className="text-sm text-white/80 leading-relaxed">{memoryText(m)}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <Clock size={10} className="text-white/20" />
                        <span className="text-[10px] font-mono text-white/20">{memoryDate(m)}</span>
                        {m.importance !== undefined && (
                          <span className="text-[10px] font-mono text-white/20">
                            importance {(m.importance * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </section>

            {/* Forget everything */}
            {!isSearch && (
              <section className="pt-4 border-t border-white/5">
                <AnimatePresence>
                  {forgetResult && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="text-xs font-mono text-purple-300 mb-3"
                    >
                      {forgetResult}
                    </motion.p>
                  )}
                </AnimatePresence>
                <motion.button
                  onClick={handleForget}
                  whileTap={{ scale: 0.97 }}
                  className={`w-full py-3 rounded-2xl border text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                    forgetStage === "confirm"
                      ? "border-red-500/60 bg-red-500/10 text-red-400"
                      : forgetStage === "working"
                        ? "border-white/10 text-white/20 cursor-not-allowed"
                        : "border-white/10 text-white/20 hover:border-red-500/30 hover:text-red-400/60"
                  }`}
                  disabled={forgetStage === "working"}
                >
                  {forgetStage === "working"
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Trash2 size={13} />
                  }
                  {forgetStage === "idle" && "Forget Everything"}
                  {forgetStage === "confirm" && "Tap again — this is permanent"}
                  {forgetStage === "working" && "Clearing memory…"}
                </motion.button>
                {forgetStage === "confirm" && (
                  <p className="text-[10px] text-white/20 font-mono mt-2 text-center">
                    <AlertTriangle size={9} className="inline mr-1" />
                    All memories, profile and intimacy score will be erased
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
