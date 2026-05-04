export enum RockyEvents {
  AUDIO_INPUT_CHUNK = "audio:input_chunk",
  VAD_SPEECH_START = "audio:vad_start",
  VAD_SPEECH_STOP = "audio:vad_stop",
  WAKE_WORD_DETECTED = "audio:wake_word",
  COMMAND_STARTED = "pipeline:command_start",
  COMMAND_READY = "pipeline:command_ready",
  LLM_TOKEN = "llm:token",
  LLM_SENTENCE = "llm:sentence",
  LLM_RESPONSE_COMPLETE = "llm:complete",
  TTS_START = "tts:start",
  TTS_CHUNK = "tts:chunk",
  TTS_END = "tts:end",
  STATUS_UPDATE = "system:status",
  UI_HINT = "system:ui_hint",
  INTERRUPT = "system:interrupt",
  SOUND_TRIGGER = "system:sound_trigger",
}

type Listener = (...args: unknown[]) => void;

export class EventBus {
  private listeners: Map<string, Set<Listener>> = new Map();

  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const fns = this.listeners.get(event);
    if (!fns || fns.size === 0) return false;
    fns.forEach(fn => fn(...args));
    return true;
  }

  once(event: string, listener: Listener): this {
    const wrapper: Listener = (...args) => {
      listener(...args);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }
}

export const eventBus = new EventBus();
