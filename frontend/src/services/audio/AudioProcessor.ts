import { eventBus, RockyEvents } from "../../lib/eventBus";
import { sessionManager } from "../../managers/SessionManager";
import { createTag } from "../../lib/logger";
import { noiseMonitor } from "../noiseMonitorService";
import { backendService } from "../backendService";

const log = createTag("AudioProcessor");

/**
 * AudioProcessor handles the incoming audio stream from the client.
 * In the new architecture, it delegates processing to the Python backend
 * and only handles environment analysis for local UI feedback.
 */
export class AudioProcessor {
  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    // Listen for raw audio chunks from the socket/bridge
    eventBus.on(RockyEvents.AUDIO_INPUT_CHUNK, ({ sessionId, chunk }) => {
      this.handleAudioChunk(sessionId, chunk).catch(err => {
        log.error("Chunk processing failed", { sessionId, error: err.message });
      });
    });

    // Listen for interrupts to signal backend
    eventBus.on(RockyEvents.INTERRUPT, (sessionId) => {
      backendService.interrupt();
    });
  }

  /**
   * Main entry point for every incoming audio chunk.
   */
  async handleAudioChunk(sessionId: string, chunk: Buffer) {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (!session) {
      log.warn("Session not found for chunk", { sessionId });
      return;
    }

    // 1. Analyze Environment for local UI hints
    const prevState = { ...session.environmentalState };
    session.environmentalState = noiseMonitor.analyzeChunk(chunk);

    if (session.environmentalState.isNoisy !== prevState.isNoisy ||
        JSON.stringify(session.environmentalState.detectedTypes) !== JSON.stringify(prevState.detectedTypes)) {
      eventBus.emit(RockyEvents.UI_HINT, {
        sessionId: session.id,
        type: "environmental_update",
        value: session.environmentalState
      });
    }

    // 2. Stream audio directly to the Python Backend
    // The Python backend (vision-agents) handles VAD, STT, and orchestration
    backendService.sendAudio(chunk);
    
    // 3. Emit mic energy for UI feedback
    // Calculate RMS for energy visualization
    const samples = chunk.length / 2;
    let sumSq = 0;
    for (let i = 0; i < samples; i++) {
      const s = chunk.readInt16LE(i * 2) / 32768.0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / samples);
    
    eventBus.emit(RockyEvents.UI_HINT, {
      sessionId: session.id,
      type: "mic_energy",
      value: rms * 10 // scale for UI
    });
  }
}

export const audioProcessor = new AudioProcessor();

