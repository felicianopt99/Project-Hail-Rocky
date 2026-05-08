import { motion } from "motion/react";
import { Cpu, Activity } from "lucide-react";
import socket from "../../lib/socket";
import { useRockyStore } from "../../store/useRockyStore";

interface GenericProtocolViewProps {
  protocolId: string;
}

export function GenericProtocolView({ protocolId }: GenericProtocolViewProps) {
  const { protocols, lights } = useRockyStore();
  const protocol = protocols.find(p => p.id === protocolId);

  const reapply = () => {
    if (!protocol) return;
    const targets = protocol.settings.targetLights?.length
      ? protocol.settings.targetLights
      : Object.keys(lights);
    targets.forEach((id: string) =>
      socket.emit("control_device", {
        device: id,
        action: "set",
        params: { brightness: protocol.settings.brightness, color: protocol.settings.color },
      })
    );
  };

  return (
    <div className="max-w-2xl w-full space-y-8">
      <div>
        <div className="vibe-label text-cyan-400 mb-2 flex items-center gap-2">
          <Cpu size={14} /> Active Protocol
        </div>
        <h1 className="text-4xl font-bold tracking-tight">{protocol?.label ?? protocolId}</h1>
        <p className="text-white/40 mt-2 text-sm">{protocol?.description ?? "Custom protocol active."}</p>
      </div>

      {protocol && (
        <div className="grid grid-cols-2 gap-5">
          <div className="vibe-card p-6 border-white/5 bg-white/5 space-y-3 rounded-2xl">
            <div className="text-[9px] uppercase tracking-widest text-white/30">Brightness</div>
            <div className="text-3xl font-black font-mono text-cyan-400">{protocol.settings.brightness}%</div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-400 rounded-full" style={{ width: `${protocol.settings.brightness}%` }} />
            </div>
          </div>
          <div className="vibe-card p-6 border-white/5 bg-white/5 space-y-3 rounded-2xl">
            <div className="text-[9px] uppercase tracking-widest text-white/30">Color</div>
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg border border-white/10"
                style={{ background: protocol.settings.color, boxShadow: `0 0 12px ${protocol.settings.color}66` }}
              />
              <div className="text-sm font-mono text-white/70">{protocol.settings.color}</div>
            </div>
          </div>
        </div>
      )}

      <motion.button
        onClick={reapply}
        whileTap={{ scale: 0.97 }}
        className="w-full py-4 bg-cyan-500 text-black font-black uppercase tracking-widest text-[11px] rounded-2xl touch-manipulation flex items-center justify-center gap-3"
      >
        <Activity size={15} /> Reapply Protocol
      </motion.button>

      <div className="vibe-card p-5 border-white/5 bg-white/5 rounded-2xl">
        <div className="vibe-label flex items-center gap-2 mb-4">
          <Activity size={12} className="text-cyan-400" /> Target Nodes
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {(protocol?.settings.targetLights?.length ? protocol.settings.targetLights : Object.keys(lights)).map((id: string) => {
            const state = lights[id];
            return (
              <div key={id} className="p-3 border border-white/5 bg-white/[0.02] rounded-xl">
                <div className="text-[10px] uppercase tracking-widest text-white/40 truncate">
                  {id.includes(".") ? (id.split(".")[1] ?? id).replace(/_/g," ") : id}
                </div>
                {state && (
                  <div className="flex items-center gap-2 mt-1">
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: state.status === "on" ? (state.color || "#00ffff") : "rgba(255,255,255,0.1)" }}
                    />
                    <span className="text-[9px] font-mono text-white/30">
                      {state.status === "on" ? `${state.brightness}%` : "off"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
