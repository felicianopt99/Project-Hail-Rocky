import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Music2, Settings2, Save } from "lucide-react";
import socket from "../../lib/socket";
import { useRockyStore, LightState } from "../../store/useRockyStore";

interface MusicViewProps {
  analyzerNode?: AnalyserNode | null;
}

const ALGO_DESC: Record<string, string> = {
  beat: "Pulses on bass hits",
  freq: "Colors follow frequency spectrum",
  ambient: "Smooth amplitude envelope",
  strobe: "Strobe on hard bass",
};

export function MusicView({ analyzerNode }: MusicViewProps) {
  const { lights, protocols } = useRockyStore();
  const protocol = protocols.find(p => p.id === "music");

  const [sensitivity, setSensitivity] = useState(protocol?.settings?.sensitivity || 0.8);
  const [algorithm, setAlgorithm] = useState<"beat" | "freq" | "ambient" | "strobe">((protocol?.settings?.algorithm as "beat" | "freq" | "ambient" | "strobe") || "freq");
  const [isEditing, setIsEditing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const algorithmRef = useRef(algorithm);
  const lightsRef = useRef<Record<string, LightState>>({});
  const sensitivityRef = useRef(sensitivity);
  const lastEmitRef = useRef(0);
  const lastBassRef = useRef(0);
  const ambientBrightnessRef = useRef(0);
  const strobeStateRef = useRef(false);

  const saveChanges = () => {
    socket.emit("save_protocol", {
      id: "music",
      label: protocol?.label,
      description: protocol?.description,
      settings: { ...protocol?.settings, sensitivity, algorithm }
    });
    setIsEditing(false);
  };

  useEffect(() => { algorithmRef.current = algorithm; }, [algorithm]);
  useEffect(() => { lightsRef.current = lights; }, [lights]);
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);

  useEffect(() => {
    if (!analyzerNode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frameId: number;
    const data = new Uint8Array(analyzerNode.frequencyBinCount);

    const emitAll = (params: Partial<LightState>) => {
      const now = Date.now();
      if (now - lastEmitRef.current < 300) return;
      lastEmitRef.current = now;
      Object.keys(lightsRef.current).forEach(id =>
        socket.emit("control_device", { device: id, action: "set", params })
      );
    };

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        canvas.width = entry.contentRect.width;
        canvas.height = entry.contentRect.height;
      }
    });
    resizeObserver.observe(canvas);

    const draw = () => {
      analyzerNode.getByteFrequencyData(data);
      const freqs = data.slice(0, 32);
      const amplitude = freqs.reduce((a, b) => a + b, 0) / (freqs.length * 255);
      const s = sensitivityRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barW = canvas.width / freqs.length;
      freqs.forEach((v, i) => {
        const h = (v / 255) * canvas.height;
        const hue = (i / freqs.length) * 240;
        ctx.shadowBlur = 4;
        ctx.shadowColor = `hsla(${hue},100%,60%,0.6)`;
        ctx.fillStyle = `hsla(${hue},100%,60%,0.85)`;
        ctx.fillRect(i * barW, canvas.height - h, barW - 1, h);
      });

      const algo = algorithmRef.current;
      if (algo === "beat") {
        const bass = data.slice(0, 4).reduce((a, b) => a + b, 0) / (4 * 255);
        if (bass > 0.6 && bass - lastBassRef.current > 0.1) {
          emitAll({ brightness: Math.round(bass * 100 * s), color: "#ff00ff" });
        }
        lastBassRef.current = bass;
      } else if (algo === "freq") {
        const mid = data.slice(8, 16).reduce((a, b) => a + b, 0) / (8 * 255);
        const hue = Math.round(mid * 240);
        const bri = Math.round(amplitude * 100 * s);
        emitAll({ brightness: Math.max(5, bri), color: `hsl(${hue},100%,50%)` });
      } else if (algo === "ambient") {
        ambientBrightnessRef.current = ambientBrightnessRef.current * 0.9 + amplitude * 0.1;
        emitAll({ brightness: Math.round(ambientBrightnessRef.current * 100 * s) });
      } else if (algo === "strobe") {
        const bass = data.slice(0, 4).reduce((a, b) => a + b, 0) / (4 * 255);
        if (bass > 0.7) {
          strobeStateRef.current = !strobeStateRef.current;
          emitAll({ brightness: strobeStateRef.current ? 100 : 0 });
        }
      }

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [analyzerNode]);

  return (
    <div className="max-w-5xl w-full space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <div className="vibe-label text-purple-400 mb-2 flex items-center gap-2">
            <Music2 size={14} /> Music Sync Protocol
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Neural Frequency Sync</h1>
          <p className="text-white/40 mt-2 text-sm">Real-time light synchronisation via microphone analysis.</p>
        </div>
        <button
          onClick={() => isEditing ? saveChanges() : setIsEditing(true)}
          className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${
            isEditing ? "bg-purple-500 text-white" : "bg-white/5 text-white/40 hover:text-white"
          }`}
        >
          {isEditing ? <><Save size={12} /> Save Config</> : <><Settings2 size={12} /> Edit Config</>}
        </button>
      </div>

      <canvas ref={canvasRef} className="w-full h-36 rounded-2xl bg-black/40 border border-white/5" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(["beat", "freq", "ambient", "strobe"] as const).map(a => (
          <motion.button
            key={a}
            onClick={() => setAlgorithm(a)}
            whileTap={{ scale: 0.95 }}
            className={`p-4 rounded-2xl border text-left transition-all touch-manipulation ${
              algorithm === a
                ? "border-purple-500/60 bg-purple-500/10 text-purple-400"
                : "border-white/5 bg-white/5 text-white/30 active:text-white active:border-white/20"
            }`}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest">{a}</div>
            <div className="text-[8px] opacity-50 mt-1 leading-tight">{ALGO_DESC[a]}</div>
          </motion.button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-[10px] uppercase tracking-widest text-white/40">
          <span>Sensitivity</span>
          <span className="text-purple-400 font-mono">{Math.round(sensitivity * 100)}%</span>
        </div>
        <input
          type="range" min="0.1" max="1" step="0.05"
          value={sensitivity}
          onChange={e => setSensitivity(parseFloat(e.target.value))}
          className="w-full h-2 bg-white/10 rounded-full appearance-none accent-purple-500"
        />
      </div>

      {!analyzerNode && (
        <div className="vibe-card p-5 border-yellow-500/20 bg-yellow-500/5 rounded-xl text-sm text-yellow-400">
          Mic must be active for light sync — tap the mic button first.
        </div>
      )}
    </div>
  );
}
