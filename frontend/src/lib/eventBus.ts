import { EventEmitter } from "events";

/**
 * RockyEvents defines all the internal events that coordinate the AI pipeline.
 */
export enum RockyEvents {
  // Audio Input Events
  AUDIO_INPUT_CHUNK = "audio:input_chunk",
  VAD_SPEECH_START = "audio:vad_start",
  VAD_SPEECH_STOP = "audio:vad_stop",
  WAKE_WORD_DETECTED = "audio:wake_word",
  
  // Pipeline Control Events
  COMMAND_STARTED = "pipeline:command_start",
  COMMAND_READY = "pipeline:command_ready", // Triggered when STT is done
  
  // LLM Events
  LLM_TOKEN = "llm:token",
  LLM_SENTENCE = "llm:sentence", // For sentence-based TTS streaming
  LLM_RESPONSE_COMPLETE = "llm:complete",
  
  // TTS Output Events
  TTS_START = "tts:start",
  TTS_CHUNK = "tts:chunk",
  TTS_END = "tts:end",
  
  // System State Events
  STATUS_UPDATE = "system:status",
  UI_HINT = "system:ui_hint",
  INTERRUPT = "system:interrupt",
  SOUND_TRIGGER = "system:sound_trigger",
}

export class EventBus extends EventEmitter {
  constructor() {
    super();
    // Increase limit for multiple services listening
    this.setMaxListeners(20);
  }
}

export const eventBus = new EventBus();
