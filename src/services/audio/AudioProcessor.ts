import { eventBus, RockyEvents } from "../../lib/eventBus";
import { vadService } from "../vadService";
import { sessionManager, Session } from "../../managers/SessionManager";
import { createTag } from "../../lib/logger";
import { noiseMonitor } from "../noiseMonitorService";

const log = createTag("AudioProcessor");

// VAD thresholds (Silero VAD optimized)
const SPEECH_START_THRESHOLD = 0.45;
const SPEECH_STOP_THRESHOLD = 0.35;

const SILENCE_FRAMES_TO_STOP = 18;
const MAX_COMMAND_DURATION_MS = 15000; // 15s safety net
const MIN_COMMAND_DURATION_MS = 300;   // Ignore very short noise spikes
const INITIAL_LISTENING_TIMEOUT_MS = 4000; // 4s to start talking after wake word

// Hard timeout after last speech frame: 1500ms (Market standard for comfortable VUI)
const SILENCE_TIMEOUT_MS = 1500;

// Hot mic thresholds (must be higher than normal to suppress echo)
const HOT_MIC_START_THRESHOLD = 0.65;
const HOT_MIC_FRAMES_REQUIRED = 3;

// Barge-in (interrupt Rocky while speaking)
const BARGE_IN_THRESHOLD = 0.80;

// Command validation thresholds
const MIN_SPEECH_FRAMES = 1;    // 1 frame = ~128ms minimum speech
const MIN_SPEECH_RATIO = 0.05;  // 5% of buffer must be speech

/**
 * AudioProcessor handles the incoming audio stream from the client.
 * It manages Voice Activity Detection (VAD), pre-roll buffering, and
 * command capture gating.
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

    // Listen for wake word to start capturing
    eventBus.on(RockyEvents.WAKE_WORD_DETECTED, ({ sessionId, name }) => {
      this.startCommandCapture(sessionId, name);
    });

    // Manual stop trigger
    eventBus.on(RockyEvents.MANUAL_STOP, (sessionId) => {
      this.forceFinishCommand(sessionId);
    });

    // Listen for interrupts to clear buffers
    eventBus.on(RockyEvents.INTERRUPT, (sessionId) => {
      const session = sessionManager.getSessionByDevice(sessionId);
      // Only clear if we are NOT in the middle of capturing a command 
      // (to avoid the race condition where wake word trigger clears its own buffer)
      if (session && !session.isCapturing) {
        this.clearBuffers(sessionId);
      }
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

    // 1. Analyze Environment
    const prevState = { ...session.environmentalState };
    session.environmentalState = noiseMonitor.analyzeChunk(chunk);

    // Emit UI hint if noisy status or detected types changed
    if (session.environmentalState.isNoisy !== prevState.isNoisy ||
        JSON.stringify(session.environmentalState.detectedTypes) !== JSON.stringify(prevState.detectedTypes)) {
      eventBus.emit(RockyEvents.UI_HINT, {
        sessionId: session.id,
        type: "environmental_update",
        value: session.environmentalState
      });
    }

    // 2. Perform VAD
    let speechProb: number;
    try {
      if (!session.vadState) {
        log.warn("VAD state not initialized, creating new state", { sessionId });
        session.vadState = vadService.createState();
      }

      speechProb = await vadService.isSpeech(session.vadState, chunk);

      // DIAGNOSTIC: Log VAD every time during active command
      if (session.isCommandActive && (session as any).chunkCount % 10 === 0) {
        log.info(`[DIAGNOSTIC-VAD] speechProb=${speechProb.toFixed(3)} isCommandActive=${session.isCommandActive}`, {
          sessionId,
          chunkCount: (session as any).chunkCount
        });
      }
    } catch (err: any) {
      log.error("VAD inference failed, resetting session state", { sessionId, error: err.message, stack: err.stack });
      session.isCommandActive = false;
      session.isCapturing = false;
      return;
    }

    // 2b. Calculate RMS (Energy) for environmental awareness
    const samples = chunk.length / 2;
    let sumSq = 0;
    for (let i = 0; i < samples; i++) {
      const s = chunk.readInt16LE(i * 2) / 32768.0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / samples);
    
    if ((session as any).chunkCount === undefined) (session as any).chunkCount = 0;
    (session as any).chunkCount++;

    // 3. Adaptive Thresholding (Based on environmental noise floor)
    // Multipliers reduced (3x->1.5x, 2x->1.2x) to maintain sensitivity even in noise
    const adaptiveStartTh = Math.min(0.80, SPEECH_START_THRESHOLD + (session.environmentalState.noiseFloor * 1.5));
    const adaptiveStopTh = Math.min(0.65, SPEECH_STOP_THRESHOLD + (session.environmentalState.noiseFloor * 1.2));

    const startTh = session.silenceThreshold ?? adaptiveStartTh;
    const stopTh = session.speechStopThreshold ?? adaptiveStopTh;
    
    const currentlySpeaking = (session.speechFramesInCommand || 0) > 0;

    // Noise Gate: Force silence if energy is extremely low (prevents VAD hallucinations)
    const isEnergyLow = rms < 0.005;
    let isSpeech = !isEnergyLow && speechProb > (currentlySpeaking ? stopTh : startTh);

    // AGGRESSIVE logging for all chunks to debug VAD
    log.info(`[VAD-DECISION] rms=${rms.toFixed(4)} prob=${speechProb.toFixed(4)} isSpeech=${isSpeech} isEnergyLow=${isEnergyLow} activeCmd=${session.isCommandActive}`, {
      activeThreshold: currentlySpeaking ? stopTh.toFixed(2) : startTh.toFixed(2),
      noiseFloor: session.environmentalState.noiseFloor.toFixed(4),
      isNoisy: session.environmentalState.isNoisy,
      chunkCount: (session as any).chunkCount
    });

    // 4. Manage Pre-Roll (Always running to capture context before wake word)
    session.preRollBuffer.push(chunk);
    if (session.preRollBuffer.length > sessionManager.getPreRollMax()) {
      session.preRollBuffer.shift();
    }

    // 3. Routing Logic
    if (session.isCommandActive) {
      this.processActiveCommandChunk(session, chunk, isSpeech);
    } else {
      this.processIdleChunk(session, chunk, speechProb);
    }
  }

  private processActiveCommandChunk(session: Session, chunk: Buffer, isSpeech: boolean) {
    // Buffer ALL chunks during active command
    if (session.isCapturing) {
      session.commandBuffers.push(chunk);

      if (isSpeech) {
        session.silenceFrames = 0;
        session.speechFramesInCommand = (session.speechFramesInCommand || 0) + 1;
        if ((session as any).chunkCount % 20 === 0) {
          log.info("[SPEECH-DETECTED] VAD detected speech", {
            sessionId: session.id,
            speechFramesInCommand: session.speechFramesInCommand,
            chunkCount: (session as any).chunkCount
          });
        }
        this.resetSilenceTimeout(session);
        eventBus.emit(RockyEvents.VAD_SPEECH_START, session.id);
      } else {
        session.silenceFrames = (session.silenceFrames || 0) + 1;
        if (session.silenceFrames % 5 === 0) {
           log.debug("Silence accumulating", {
             sessionId: session.id,
             silenceFrames: session.silenceFrames,
             speechFramesInCommand: session.speechFramesInCommand || 0
           });
        }
      }
    }

    // Max duration safety net
    const duration = Date.now() - ((session as any).commandStartTime || 0);
    const isOverDuration = duration > MAX_COMMAND_DURATION_MS;

    // Predictive silence detection or hard timeout
    const hasStartedSpeaking = (session.speechFramesInCommand || 0) > 0;
    
    // If we haven't heard any speech yet, be more patient (use INITIAL_LISTENING_TIMEOUT_MS)
    // If we HAVE heard speech, use the snappier SILENCE_FRAMES_TO_STOP (1.1s)
    const silenceLimit = hasStartedSpeaking ? SILENCE_FRAMES_TO_STOP : Math.ceil(INITIAL_LISTENING_TIMEOUT_MS / 64);

    if (((session.silenceFrames || 0) >= silenceLimit && session.commandBuffers.length > 3) || isOverDuration) {
      if (isOverDuration) {
        log.info("Command force-ended: max duration reached", { sessionId: session.id });
      } else {
        log.info(hasStartedSpeaking ? "End of speech detected" : "Initial silence timeout", {
          sessionId: session.id,
          silenceFrames: session.silenceFrames,
          limit: silenceLimit,
          hasStartedSpeaking
        });
      }
      this.emitCommandReady(session);
    }
  }

  private processIdleChunk(session: Session, chunk: Buffer, speechProb: number) {
    // Barge-in: Rocky is speaking, user wants to interrupt
    if (session.isSpeaking && session.conversationMode) {
      if (speechProb > BARGE_IN_THRESHOLD) {
        log.info("Barge-in detected", { sessionId: session.id, prob: speechProb.toFixed(3) });
        eventBus.emit(RockyEvents.INTERRUPT, session.id);
        this.startCommandCapture(session.id, "barge_in");
      }
      return; // Don't feed wake word engine during TTS
    }

    // Hot mic: Rocky finished speaking, follow-up window is active
    // Requires higher threshold to suppress echo from speakers
    if (session.hotMicActive && !session.isSpeaking) {
      const adaptiveHotMicTh = session.environmentalState.isNoisy ? 0.75 : HOT_MIC_START_THRESHOLD;
      if (speechProb > adaptiveHotMicTh) {
        session.hotMicSpeechFrames = (session.hotMicSpeechFrames || 0) + 1;

        if (session.hotMicSpeechFrames >= HOT_MIC_FRAMES_REQUIRED) {
          log.info("Hot mic: speech confirmed", { sessionId: session.id, frames: session.hotMicSpeechFrames });
          session.hotMicSpeechFrames = 0;
          if (session.conversationExpiryTimeout) {
            clearTimeout(session.conversationExpiryTimeout);
            session.conversationExpiryTimeout = null;
          }
          this.startCommandCapture(session.id, "hot_mic");
        }
        return; // Don't feed wake word engine while accumulating frames
      } else {
        session.hotMicSpeechFrames = 0; // Reset if falls below threshold
      }
    }

    // Default: feed wake word engine (echo gate maintained)
    if (!session.isSpeaking) {
      if (Math.random() < 0.01) log.info("Feeding wake word engine", { sessionId: session.id });
      session.wwService.sendAudio(chunk);
    } else {
      if (Math.random() < 0.01) log.info("Skipping wake word feed: isSpeaking=true", { sessionId: session.id });
    }

    if (speechProb > 0.1) {
      eventBus.emit(RockyEvents.UI_HINT, {
        sessionId: session.id,
        type: "mic_energy",
        value: speechProb
      });
    }
  }

  private startCommandCapture(sessionId: string, name: string) {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (!session) {
      log.warn("startCommandCapture: session not found", { sessionId });
      return;
    }

    if (session.isCommandActive) return;

    log.info("Starting command capture", { sessionId, name });
    (session as any).commandStartTime = Date.now();

    eventBus.emit(RockyEvents.SOUND_TRIGGER, { sessionId, type: "accept" });

    // Take a snapshot of pre-roll before resetting state
    const preRoll = [...session.preRollBuffer];

    session.isCommandActive = true;
    session.isCapturing = true;
    session.isProcessingCommand = false;
    session.commandBuffers = preRoll;
    session.preRollBuffer = [];
    session.silenceFrames = 0;
    session.speechFramesInCommand = 0;
    session.hotMicSpeechFrames = 0;
    session.vadState = vadService.createState();

    this.resetSilenceTimeout(session);
    eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId, status: "listening" });
    log.info("Status updated to listening", { sessionId });
  }

  private resetSilenceTimeout(session: Session) {
    if (session.silenceTimeout) {
      clearTimeout(session.silenceTimeout);
    }

    // Adaptive Silence Timeout (Gemini Live Pattern)
    // If environment is noisy, use slightly longer timeout to be sure.
    // If we have many speech frames, we can be more aggressive.
    const baseTimeout = session.silenceTimeout_ms || SILENCE_TIMEOUT_MS;
    const noisePenalty = session.environmentalState.isNoisy ? 300 : 0;
    const adaptiveTimeout = baseTimeout + noisePenalty;

    session.silenceTimeout = setTimeout(() => {
      log.debug("Hard silence timeout triggered", { 
        sessionId: session.id, 
        timeout: adaptiveTimeout,
        isNoisy: session.environmentalState.isNoisy 
      });
      this.finishCommand(session.id);
    }, adaptiveTimeout);
  }

  private finishCommand(sessionId: string) {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (!session || !session.isCommandActive) return;

    this.emitCommandReady(session);
  }

  public forceFinishCommand(sessionId: string) {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (session && session.isCommandActive) {
      log.info("Force finishing command", { sessionId });
      this.emitCommandReady(session);
    }
  }

  private emitCommandReady(session: Session) {
    if (!session.isCommandActive) return;

    // Immediately stop active capture to prevent re-entry loops
    session.isCommandActive = false;
    session.isCapturing = false;

    if (session.isProcessingCommand) {
      log.warn("Command ready but already processing, discarding redundant trigger", { sessionId: session.id });
      return;
    }

    const audioBuffer = Buffer.concat(session.commandBuffers);
    const totalFrames = session.commandBuffers.length;
    session.commandBuffers = []; // Clear buffer AFTER taking what we need
    const duration = Date.now() - ((session as any).commandStartTime || 0);
    const speechFrames = session.speechFramesInCommand || 0;
    const speechRatio = totalFrames > 0 ? speechFrames / totalFrames : 0;

    if (duration < MIN_COMMAND_DURATION_MS || speechFrames < MIN_SPEECH_FRAMES || speechRatio < MIN_SPEECH_RATIO) {
      log.error("[CRITICAL-DISCARD] Command discarded before STT: insufficient speech or duration", {
        sessionId: session.id,
        duration: duration + "ms",
        minDuration: MIN_COMMAND_DURATION_MS + "ms",
        speechFrames,
        minSpeechFrames: MIN_SPEECH_FRAMES,
        totalFrames,
        ratio: speechRatio.toFixed(3),
        minRatio: MIN_SPEECH_RATIO.toFixed(3),
        reason: speechFrames < MIN_SPEECH_FRAMES ? "ZERO_SPEECH_DETECTED" : (duration < MIN_COMMAND_DURATION_MS ? "TOO_FAST" : "LOW_RATIO"),
        audioBufferSize: audioBuffer.length
      });

      // Clear state without emitting COMMAND_READY
      session.silenceFrames = 0;
      session.speechFramesInCommand = 0;
      eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "idle" });
      return;
    }

    log.info("[COMMAND-ACCEPTED] Command buffer ready to send to STT", {
      sessionId: session.id,
      audioBufferSize: audioBuffer.length,
      audioBufferDuration: (audioBuffer.length / 32000).toFixed(2) + "s",
      totalChunks: totalFrames,
      speechFrames,
      speechRatio: speechRatio.toFixed(3),
      duration: duration + "ms"
    });

    // Clear state before emit so new chunks route to idle immediately
    session.isCommandActive = false;
    session.isCapturing = false;
    session.commandBuffers = [];
    session.silenceFrames = 0;
    session.speechFramesInCommand = 0;

    // Emit AFTER resetting local capture state but the orchestrator guard
    // checks isCommandActive which we just cleared — so processAudioCommand
    // must NOT gate on isCommandActive for the COMMAND_READY path.
    eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "processing_stt" });
    eventBus.emit(RockyEvents.COMMAND_READY, {
      sessionId: session.id,
      audioBuffer
    });
  }

  private clearBuffers(sessionId: string) {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (session) {
      if (session.silenceTimeout) {
        clearTimeout(session.silenceTimeout);
        session.silenceTimeout = null;
      }
      session.isCapturing = false;
      session.commandBuffers = [];
      session.preRollBuffer = [];
      session.silenceFrames = 0;
      session.speechFramesInCommand = 0;
      session.hotMicSpeechFrames = 0;
    }
  }
}

export const audioProcessor = new AudioProcessor();
