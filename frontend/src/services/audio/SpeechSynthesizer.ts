import { eventBus, RockyEvents } from "../../lib/eventBus";
import { createTag } from "../../lib/logger";

const log = createTag("SpeechSynthesizer");

export class SpeechSynthesizer {
  private activeStreams: Map<string, boolean> = new Map();
  private queues: Map<string, Promise<void>> = new Map();
  private currentStreams: Map<string, any> = new Map();

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    eventBus.on(RockyEvents.LLM_SENTENCE, ({ sessionId, text }) => {
      this.speak(sessionId, text).catch(err => {
        log.error("Synthesis failed", { sessionId, error: err.message });
      });
    });

    eventBus.on(RockyEvents.INTERRUPT, (sessionId) => {
      this.interrupt(sessionId);
    });
  }

  async speak(sessionId: string, text: string) {
    if (!text?.trim() || text.length < 2) return;

    log.info("Queueing synthesis", { text: text.substring(0, 50) + "...", sessionId });
    this.activeStreams.set(sessionId, true);

    const synthesisPromise = this.prepareSpeech(sessionId, text);
    const queue = this.queues.get(sessionId) || Promise.resolve();
    const nextSpeech = queue.then(async () => {
      try {
        const result = await synthesisPromise;
        if (result && result.stream) {
          await this.emitSpeechStream(sessionId, result.stream, result.sampleRate);
        }
      } catch (err: any) {
        log.error("Queue item failed, continuing queue", { sessionId, error: err.message });
      }
    });

    this.queues.set(sessionId, nextSpeech);
  }

  interrupt(sessionId: string) {
    log.info("Interrupting synthesis", { sessionId });
    this.activeStreams.set(sessionId, false);

    const stream = this.currentStreams.get(sessionId);
    if (stream) {
      log.debug("Destroying active stream", { sessionId });
      if (stream.destroy) stream.destroy();
      this.currentStreams.delete(sessionId);
    }

    this.queues.set(sessionId, Promise.resolve());
    eventBus.emit(RockyEvents.TTS_END, { sessionId, interrupted: true });
  }

  private async prepareSpeech(sessionId: string, text: string) {
    const isActive = () => this.activeStreams.get(sessionId) !== false;
    if (!isActive()) return null;
    return null;
  }

  private async emitSpeechStream(sessionId: string, stream: any, sampleRate: number) {
    const isActive = () => this.activeStreams.get(sessionId) !== false;
    if (!isActive()) {
      if (stream.destroy) stream.destroy();
      return;
    }

    const emitStart = Date.now();
    this.currentStreams.set(sessionId, stream);

    eventBus.emit(RockyEvents.TTS_START, { sessionId, sampleRate });
    eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId, status: "synthesizing_tts" });

    return new Promise<void>((resolve) => {
      let chunksReceived = 0;
      
      stream.on("data", (chunk: Buffer) => {
        if (chunksReceived === 0) {
          log.debug("TTFA Measured (Internal)", { ttfa: (Date.now() - emitStart) + "ms", sessionId });
        }
        chunksReceived++;

        if (!isActive()) {
          stream.destroy();
          resolve();
          return;
        }
        eventBus.emit(RockyEvents.TTS_CHUNK, { sessionId, chunk });
      });

      stream.on("end", () => {
        this.currentStreams.delete(sessionId);
        eventBus.emit(RockyEvents.TTS_END, { sessionId });
        resolve();
      });

      stream.on("error", (err: any) => {
        this.currentStreams.delete(sessionId);
        log.error("Stream error", { sessionId, error: err.message });
        eventBus.emit(RockyEvents.TTS_END, { sessionId, error: true });
        resolve();
      });
    });
  }

  /**
   * Waits for all queued speech to finish playing.
   * Used by orchestratorService to know when the full turn is done.
   */
  async waitForQueue(sessionId: string): Promise<void> {
    const queue = this.queues.get(sessionId);
    if (queue) await queue;
  }

  /**
   * Cleanup session data when a user disconnects.
   */
  cleanup(sessionId: string) {
    this.interrupt(sessionId);
    this.activeStreams.delete(sessionId);
    this.queues.delete(sessionId);
  }
}

export const speechSynthesizer = new SpeechSynthesizer();
