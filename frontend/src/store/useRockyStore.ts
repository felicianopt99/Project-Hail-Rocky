import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

export type AppMode = "dashboard" | "visualizer" | "neural_center" | "protocols" | "skills" | "memories" | "settings";
export type RockyStatus = "idle" | "listening" | "processing_stt" | "thinking_llm" | "synthesizing_tts" | "hot_mic" | "error";

export interface ProtocolSettings {
  brightness: number;
  speed: number;
  color: string;
  color_temp_kelvin?: number;
  transition?: "smooth" | "step";
  subMode?: string;
  palette?: string[];
  sensitivity?: number;
  syncMode?: "master" | "local";
  offBeatBrightness?: number;
  targetLights?: string[];
  features?: string[];
}

export interface Protocol {
  id: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  settings: ProtocolSettings | any;
}

export interface RoutineAction {
  device: string;
  action: string;
  params?: Record<string, any>;
}

export interface Routine {
  id: string;
  label: string;
  icon: string;
  color: string;
  actions: RoutineAction[];
}


export interface Message {
  role: "user" | "model";
  text: string;
  timestamp?: number;
}

export interface Stats {
  cpu: number;
  ram: number;
  totalRam: number;
  temp: number;
}

export interface LogEntry {
  timestamp: number;
  message: string;
}

export interface Weather {
  temp: number;
  desc: string;
  city: string;
  tomorrow?: { tempMax: number; tempMin: number; desc: string };
}

export interface LightState {
  name: string;
  status: "on" | "off";
  brightness: number;
  color: string;
  color_temp_kelvin?: number;
  min_color_temp_kelvin?: number;
  max_color_temp_kelvin?: number;
  areaId?: string;
  areaName?: string;
}

interface RockyState {
  // Global App State
  mode: AppMode;
  activeProtocolId: string | null;
  status: RockyStatus;
  messages: Message[];
  isConnected: boolean;
  latencyMs: number | null;
  isTyping: boolean;
  serviceStatus: { wakeword: boolean };
  inputValue: string;
  isListening: boolean;

  // Dashboard / System State
  stats: Stats;
  logs: LogEntry[];
  lights: Record<string, LightState>;
  areas: Record<string, string>;
  weather: Weather;
  protocols: Protocol[];
  routines: Routine[];
  environmentalState: { noiseFloor: number; isNoisy: boolean; detectedTypes: string[] };

  // Actions
  setMode: (mode: AppMode) => void;
  setActiveProtocolId: (id: string | null) => void;
  setProtocols: (protocols: Protocol[] | ((prev: Protocol[]) => Protocol[])) => void;
  setStatus: (status: RockyStatus | ((prev: RockyStatus) => RockyStatus)) => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setIsConnected: (connected: boolean) => void;
  setLatencyMs: (ms: number | null) => void;
  setIsTyping: (typing: boolean) => void;
  setServiceStatus: (service: string, ok: boolean) => void;
  setInputValue: (value: string) => void;
  setIsListening: (listening: boolean) => void;
  setEnvironmentalState: (state: { noiseFloor: number; isNoisy: boolean; detectedTypes: string[] }) => void;
  setRoutines: (routines: Routine[] | ((prev: Routine[]) => Routine[])) => void;
  
  setStats: (stats: Stats) => void;
  setLogs: (logs: LogEntry[] | ((prev: LogEntry[]) => LogEntry[])) => void;
  setLights: (lights: Record<string, LightState> | ((prev: Record<string, LightState>) => Record<string, LightState>)) => void;
  setAreas: (areas: Record<string, string>) => void;
  setWeather: (weather: Weather) => void;
  updateLight: (id: string, state: LightState) => void;
}

export const useRockyStore = create<RockyState>((set) => ({
  // Initial State
  mode: "dashboard",
  activeProtocolId: null,
  status: "idle",
  messages: [],
  isConnected: true,
  latencyMs: null,
  isTyping: false,
  serviceStatus: { wakeword: false },
  inputValue: "",
  isListening: true,
  environmentalState: { noiseFloor: 0.005, isNoisy: false, detectedTypes: [] },

  stats: { cpu: 0, ram: 0, totalRam: 16, temp: 0 },
  logs: [],
  lights: {},
  areas: {},
  weather: { temp: 18, desc: "Clear Sky", city: "Local" },
  protocols: [],
  routines: [],

  // Actions
  setMode: (mode) => set({ mode }),
  setActiveProtocolId: (id) => set({ activeProtocolId: id }),
  setProtocols: (protocols) => set((state) => ({
    protocols: typeof protocols === "function" ? protocols(state.protocols) : protocols,
  })),
  
  setStatus: (statusOrFn) => set((state) => {
    const status = typeof statusOrFn === "function" ? statusOrFn(state.status) : statusOrFn;
    
    // Finite State Machine logic
    // When moving to thinking/processing, we automatically show typing
    let isTyping = state.isTyping;
    if (status === "thinking_llm" || status === "processing_stt") {
      isTyping = true;
    } else if (status === "idle" || status === "listening" || status === "hot_mic") {
      isTyping = false;
    }
    
    return { status, isTyping };
  }),

  setMessages: (messages) => set((state) => ({
    messages: typeof messages === "function" ? messages(state.messages) : messages
  })),

  setIsConnected: (isConnected) => set({ isConnected }),
  setLatencyMs: (latencyMs) => set({ latencyMs }),
  setIsTyping: (isTyping) => set({ isTyping }),
  
  setServiceStatus: (service, ok) => set((state) => ({
    serviceStatus: { ...state.serviceStatus, [service]: ok }
  })),

  setInputValue: (inputValue) => set({ inputValue }),
  setIsListening: (isListening) => set({ isListening }),
  setEnvironmentalState: (environmentalState) => set({ environmentalState }),
  setRoutines: (routines) => set((state) => ({
    routines: typeof routines === "function" ? routines(state.routines) : routines,
  })),

  setStats: (stats) => set({ stats }),
  
  setLogs: (logs) => set((state) => ({
    logs: typeof logs === "function" ? logs(state.logs) : logs
  })),

  setLights: (lights) => set((state) => ({
    lights: typeof lights === "function" ? lights(state.lights) : lights
  })),

  setAreas: (areas) => set({ areas }),
  setWeather: (weather) => set({ weather }),
  
  updateLight: (id, state) => set((prev) => ({
    lights: { ...prev.lights, [id]: state }
  }))
}));

// Granular selectors to avoid cascading re-renders
export const useMode = () => useRockyStore(s => s.mode);
export const useStatus = () => useRockyStore(s => s.status);
export const useMessages = () => useRockyStore(s => s.messages);
export const useStats = () => useRockyStore(s => s.stats);
export const useLogs = () => useRockyStore(s => s.logs);
export const useLights = () => useRockyStore(useShallow(s => s.lights));
export const useAreas = () => useRockyStore(useShallow(s => s.areas));
export const useWeather = () => useRockyStore(s => s.weather);
export const useProtocols = () => useRockyStore(s => s.protocols);
export const useRoutines = () => useRockyStore(s => s.routines);
export const useIsConnected = () => useRockyStore(s => s.isConnected);
export const useLatency = () => useRockyStore(s => s.latencyMs);
export const useIsTyping = () => useRockyStore(s => s.isTyping);
export const useServiceStatus = () => useRockyStore(useShallow(s => s.serviceStatus));
export const useInputValue = () => useRockyStore(s => s.inputValue);
export const useEnvironmentalState = () => useRockyStore(s => s.environmentalState);
export const useActiveProtocolId = () => useRockyStore(s => s.activeProtocolId);
export const useIsListening = () => useRockyStore(s => s.isListening);
