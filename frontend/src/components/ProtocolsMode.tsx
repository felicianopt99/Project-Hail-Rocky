import { ArrowLeft } from "lucide-react";
import { useRockyStore } from "../store/useRockyStore";
import { CinemaView } from "./protocols/CinemaView";
import { MusicView } from "./protocols/MusicView";
import { SunsetView } from "./protocols/SunsetView";
import { GenericProtocolView } from "./protocols/GenericProtocolView";

interface ProtocolsModeProps {
  analyzerNode?: AnalyserNode | null;
}

export default function ProtocolsMode({ analyzerNode }: ProtocolsModeProps) {
  const { activeProtocolId, setMode, setActiveProtocolId } = useRockyStore();

  const goBack = () => {
    setMode("neural_center");
    setActiveProtocolId(null);
  };

  const renderSubView = () => {
    if (!activeProtocolId) return null;
    if (activeProtocolId === "cinema") return <CinemaView />;
    if (activeProtocolId === "music")  return <MusicView analyzerNode={analyzerNode} />;
    if (activeProtocolId === "sunset") return <SunsetView />;
    return <GenericProtocolView protocolId={activeProtocolId} />;
  };

  const bgClass =
    activeProtocolId === "cinema"  ? "from-yellow-950/15 via-black to-black" :
    activeProtocolId === "music"   ? "from-purple-950/20 via-black to-black" :
    activeProtocolId === "sunset"  ? "from-orange-950/20 via-purple-950/10 to-black" :
    "from-black to-black";

  return (
    <div className={`h-full w-full flex flex-col items-center justify-start p-6 bg-gradient-to-b ${bgClass} relative overflow-auto custom-scrollbar`}>
      <div className="w-full max-w-6xl mb-6">
        <button
          onClick={goBack}
          className="flex items-center gap-2 text-white/40 active:text-white transition-colors text-[11px] uppercase tracking-widest font-bold py-3 pr-4 touch-manipulation"
        >
          <ArrowLeft size={16} />
          Neural Center
        </button>
      </div>
      {renderSubView()}
    </div>
  );
}
