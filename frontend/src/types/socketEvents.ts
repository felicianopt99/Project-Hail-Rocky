import { Message, RockyStatus, AppMode, LightState, Stats, Weather, LogEntry, Protocol, ProtocolSettings } from "../store/useRockyStore";

export interface ChatResponse {
  text: string;
}

export interface ChatError {
  message: string;
}

export interface SpeakerIdentified {
  name: string;
}

export interface SpeakerChanged {
  from: string;
  to: string;
}

export interface TimerFired {
  label: string;
}

export interface ServiceStatus {
  service: string;
  ok: boolean;
}

export interface UiHint {
  type: string;
  value: any;
}

export interface TtsStart {
  sampleRate: number;
}

export interface SystemStateUpdate {
  emotional_state?: string;
  intimacy?: number;
  intimacy_label?: string;
  logs?: LogEntry[];
  lights?: Record<string, LightState>;
  areas?: Record<string, string>;
  weather?: Weather;
  protocols?: Protocol[];
}

export interface DeviceUpdated {
  device: string;
  state: LightState;
}

export interface ProtocolUpdated {
  id: string;
  settings: ProtocolSettings;
}

export interface ProtocolDeleted {
  id: string;
}

export interface ServerToClientEvents {
  mode_updated: (newMode: string) => void;
  status_update: (status: RockyStatus) => void;
  chat_history: (history: Message[]) => void;
  transcript_result: (text: string) => void;
  chat_token: (token: string) => void;
  chat_response: (data: ChatResponse) => void;
  chat_error: (error: ChatError) => void;
  wake_word_detected: () => void;
  speaker_identified: (data: SpeakerIdentified) => void;
  speaker_changed: (data: SpeakerChanged) => void;
  timer_fired: (data: TimerFired) => void;
  service_status: (data: ServiceStatus) => void;
  ui_hint: (hint: UiHint) => void;
  tts_start: (data: TtsStart) => void;
  tts_chunk: (chunk: Buffer | ArrayBuffer) => void;
  tts_end: () => void;
  tts_error: () => void;
  stop_speaking: () => void;
  weather_updated: (data: Weather) => void;
  stats_updated: (data: Stats) => void;
  system_state_update: (data: SystemStateUpdate) => void;
  areas_updated: (data: Record<string, string>) => void;
  new_log: (log: LogEntry) => void;
  device_updated: (data: DeviceUpdated) => void;
  protocol_updated: (data: ProtocolUpdated) => void;
  protocol_created: (p: Protocol) => void;
  protocol_deleted: (data: ProtocolDeleted) => void;
  routines_list: (routines: any[]) => void;
  pong_latency: (sentAt: number) => void;
}

export interface ClientToServerEvents {
  chat_request: (data: { content: string }) => void;
  manual_stop: (data?: any) => void;
  voice_interrupt: (data?: any) => void;
  manual_activation: (data?: any) => void;
  auth_granted: (data: { id: string }) => void;
  ping: (data: number) => void;
}
