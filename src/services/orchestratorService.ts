import { transcribeAudio } from "./sttService";
import { EventEmitter } from "events";
import { llmService, ChatMessage } from "./llmService";
import { memoryService } from "./memoryService";
import { memoryManager } from "../managers/MemoryManager";
import { prisma } from "../lib/db";
import { Session, sessionManager } from "../managers/SessionManager";
import { skillManager } from "../skills/SkillManager";
import { ragService } from "./ragService";
import { createTag } from "../lib/logger";
import { RockyContext } from "../skills/BaseSkill";
import { addWavHeader } from "../lib/utils/audioUtils";
import { speechSynthesizer } from "./audio/SpeechSynthesizer";
import { looksLikeToolSchemaDump, parseDirectLightCommand } from "../lib/utils/parserUtils";
import { eventBus, RockyEvents } from "../lib/eventBus";
import { systemStateManager } from "../managers/SystemStateManager";
import { latencyTracker } from "../lib/latencyTracker";

const log = createTag("Orchestrator");

const ECHO_SUPPRESSION_DELAY_MS = 500;

/**
 * OrchestratorService acts as the central coordinator (the "Maestro").
 * It reacts to events from AudioProcessor and manages the flow between
 * STT, LLM, Skills, and TTS.
 */
export class OrchestratorService extends EventEmitter {
  constructor() {
    super();
    this.setupListeners();
  }

  private setupListeners() {
    // 1. React to Wake Word
    eventBus.on(RockyEvents.WAKE_WORD_DETECTED, ({ sessionId, name }) => {
      const session = sessionManager.getSessionByDevice(sessionId);
      if (session) this.handleWakeWord(session, name);
    });

    // 2. React to VAD / Silence triggers
    eventBus.on(RockyEvents.VAD_SPEECH_STOP, (sessionId) => {
      const session = sessionManager.getSessionByDevice(sessionId);
      if (session && session.isCommandActive) {
        this.processAudioCommand(session, Buffer.concat(session.commandBuffers));
      }
    });

    // 3. React to AudioProcessor completing a buffer
    eventBus.on(RockyEvents.COMMAND_READY, ({ sessionId, audioBuffer }) => {
      const session = sessionManager.getSessionByDevice(sessionId);
      if (session) this.processAudioCommand(session, audioBuffer);
    });

    // 4. Echo Gate management
    eventBus.on(RockyEvents.TTS_START, ({ sessionId }) => {
      const session = sessionManager.getSessionByDevice(sessionId);
      if (session) session.isSpeaking = true;
    });

    eventBus.on(RockyEvents.TTS_END, ({ sessionId }) => {
      const session = sessionManager.getSessionByDevice(sessionId);
      if (session) session.isSpeaking = false;
    });

    // 5. Handle Interrupts (Barge-in)
    eventBus.on(RockyEvents.INTERRUPT, (sessionId) => {
      const session = sessionManager.getSessionByDevice(sessionId);
      if (session && session.abortController) {
        log.info("Aborting active LLM interaction", { sessionId });
        session.abortController.abort();
        session.abortController = null;
      }
    });
  }

  private handleWakeWord(session: Session, name: string) {
    // Barge-in: abort any active LLM / TTS
    eventBus.emit(RockyEvents.INTERRUPT, session.id);

    if (Date.now() < session.echoSuppressionUntil) {
      log.debug("Wake word suppressed (echo protection)", { sessionId: session.id });
      return;
    }

    log.info("Wake word detected", { name, sessionId: session.id });
    session.echoSuppressionUntil = Date.now() + 2000; // Block re-trigger for 2s

    // Reset processing mutex so a new command can start
    session.isProcessingCommand = false;

    // Enter conversation mode — persists until the hot mic expiry timer fires
    session.conversationMode = true;
    if (session.conversationExpiryTimeout) {
      clearTimeout(session.conversationExpiryTimeout);
      session.conversationExpiryTimeout = null;
    }

    // Buffer management (commandBuffers, preRoll, silenceTimeout_ms, isCommandActive,
    // isCapturing) is handled exclusively by AudioProcessor's startCommandCapture.
    // Orchestrator only signals status to the UI.
    eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "listening" });
  }

  private startHotMicWindow(session: Session) {
    const HOT_MIC_TIMEOUT_MS = 10_000;

    if (session.conversationExpiryTimeout) {
      clearTimeout(session.conversationExpiryTimeout);
      session.conversationExpiryTimeout = null;
    }

    // Echo suppression: delay before activating hot mic to suppress speaker feedback
    session.echoSuppressionUntil = Date.now() + ECHO_SUPPRESSION_DELAY_MS;
    session.hotMicSpeechFrames = 0;
    session.speechFramesInCommand = 0;

    setTimeout(() => {
      // Guard: if a command started during echo suppression, don't activate hot mic
      if (session.isCommandActive || session.isCapturing || session.isProcessingCommand) {
        return;
      }

      session.hotMicActive = true;
      eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "hot_mic" });
      log.info("Hot mic window started", { sessionId: session.id });

      session.conversationExpiryTimeout = setTimeout(() => {
        // Guard: if a command started just before the timer fired, don't exit conversation
        if (session.isCommandActive || session.isCapturing || session.isProcessingCommand) {
          session.conversationExpiryTimeout = null;
          return;
        }
        log.info("Hot mic expired, returning to standby", { sessionId: session.id });
        session.hotMicActive = false;
        session.conversationMode = false;
        session.conversationExpiryTimeout = null;
        eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "idle" });
      }, HOT_MIC_TIMEOUT_MS);

    }, ECHO_SUPPRESSION_DELAY_MS);
  }

  async processAudioCommand(session: Session, audioBuffer: Buffer) {
    // isCommandActive is already cleared by AudioProcessor before COMMAND_READY fires;
    // only gate on the processing mutex to prevent concurrent runs.
    if (session.isProcessingCommand) return;
    session.isProcessingCommand = true;
    session.isCommandActive = false;

    // Deactivate hot mic window — new command is now being processed
    session.hotMicActive = false;
    if (session.conversationExpiryTimeout) {
      clearTimeout(session.conversationExpiryTimeout);
      session.conversationExpiryTimeout = null;
    }

    if (audioBuffer.length === 0) {
      session.isProcessingCommand = false;
      eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "idle" });
      return;
    }

    try {
      const traceId = Math.random().toString(36).substring(7);
      latencyTracker.start(traceId);
      
      eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "processing_stt" });
      
      log.info("Processing audio buffer", { 
        sessionId: session.id, 
        size: audioBuffer.length, 
        duration: (audioBuffer.length / 32000).toFixed(2) + "s" 
      });

      let transcript = "";
      try {
        const wavBuffer = addWavHeader(audioBuffer, 16000);
        latencyTracker.mark(traceId, "stt_start");
        eventBus.emit(RockyEvents.UI_HINT, { sessionId: session.id, type: "transcript", value: "..." });
        const result = await transcribeAudio(wavBuffer);
        transcript = result.text;
        log.info("STT Result received", { source: result.source, transcript });
        latencyTracker.mark(traceId, "stt_end");
      } catch (error: any) {
        log.error("STT failed", { error: error.message });
        this.handleFailure(session.id, "Bad math! System is leaky, Friend.");
        return;
      }

      log.info("STT Result", { transcript: transcript || "<empty>" });
      
      const sessionHistory = await this.getHistory(session.id);
      const isValid = this.isValidTranscript(transcript, session, sessionHistory);

      if (isValid) {
        // Circuit Breaker: Track turn frequency
        if (!session.interactionStats) session.interactionStats = { turnsInWindow: 0, windowStart: Date.now() };
        const now = Date.now();
        if (now - session.interactionStats.windowStart > 60000) {
          session.interactionStats.turnsInWindow = 0;
          session.interactionStats.windowStart = now;
        }
        session.interactionStats.turnsInWindow++;

        if (session.interactionStats.turnsInWindow > 12) {
          log.warn("Circuit breaker triggered: too many turns", { sessionId: session.id });
          this.handleFailure(session.id, "Friend, I am dizzy! Too many words. Resting now.");
          session.conversationMode = false;
          return;
        }

        eventBus.emit(RockyEvents.UI_HINT, { sessionId: session.id, type: "transcript", value: transcript });

        const devices = systemStateManager.getState().availableDevices;
        await this.handleChatRequest(session, transcript, sessionHistory, devices, traceId);
      } else {
        log.info("Transcript discarded by safety filter", { sessionId: session.id, transcript });
        eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "idle" });
      }
    } catch (err: any) {
      log.error("Command processing failure", { error: err.message });
      eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "error" });
    } finally {
      session.isProcessingCommand = false;
    }
  }

  async handleChatRequest(session: Session, message: string, history: ChatMessage[], devices: string[], traceId?: string) {
    eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "thinking_llm" });

    const finalTraceId = traceId || Math.random().toString(36).substring(7);
    if (!traceId) latencyTracker.start(finalTraceId);

    const startTime = Date.now();
    log.info("Interaction started", { traceId: finalTraceId, sessionId: session.id, message });

    // Initialize abort controller for this interaction
    if (session.abortController) session.abortController.abort();
    session.abortController = new AbortController();
    const signal = session.abortController.signal;

    const LLM_GLOBAL_TIMEOUT_MS = 60000;
    const globalTimeoutId = setTimeout(() => {
      log.warn("LLM global timeout reached, aborting interaction", { traceId: finalTraceId });
      session.abortController?.abort();
    }, LLM_GLOBAL_TIMEOUT_MS);

    try {
      const currentMessages: ChatMessage[] = [...history, { role: "user", content: message }];
      const [memories, systemStatus] = await Promise.all([
        memoryService.getRecentMemories(5, message),
        ragService.getSystemContext(message),
      ]);
      
      const env = session.environmentalState;
      const envContext = `\n[ENVIRONMENT] Noise Floor: ${env.noiseFloor.toFixed(4)}. Status: ${env.isNoisy ? 'Noisy' : 'Quiet'}. Detected: ${env.detectedTypes.join(', ') || 'None'}.`;
      const systemContext = `${systemStatus}\nMemories: ${memories.map(m => m.content).join(", ")}${envContext}`;

      const proactiveHabits = await memoryManager.getProactiveSuggestions();
      if (proactiveHabits.length > 0) {
        eventBus.emit(RockyEvents.UI_HINT, { 
          sessionId: session.id, 
          type: "proactive_suggestion", 
          data: proactiveHabits[0].content 
        });
      }

      const context: RockyContext = {
        sessionId: session.id,
        system: systemStateManager,
        events: eventBus
      };

      let sentenceBuffer = "";
      let isFirstSentence = true;

      latencyTracker.mark(finalTraceId, "llm_start");
      const result = await llmService.processChat(
        currentMessages,
        skillManager.getDefinitions(context),
        systemContext,
        context,
        (token) => {
          if (signal.aborted) return;
          
          // Mark first token for TTFT
          if (!sentenceBuffer) {
            latencyTracker.mark(finalTraceId, "llm_first_token");
          }

          eventBus.emit(RockyEvents.LLM_TOKEN, { sessionId: session.id, token });
          sentenceBuffer += token;

          const minLen = isFirstSentence ? 12 : 25;
          const endsWithSentence = /[.!?]\s*$/.test(sentenceBuffer.trim());
          if (endsWithSentence && sentenceBuffer.trim().length > minLen) {
            eventBus.emit(RockyEvents.LLM_SENTENCE, { sessionId: session.id, text: sentenceBuffer.trim() });
            sentenceBuffer = "";
            isFirstSentence = false;
          }
        },
        signal
      );

      latencyTracker.mark(finalTraceId, "llm_end");
      let { content } = result;
      log.info("LLM Interaction complete", { traceId: finalTraceId });
      let finalContent = content || "";
      const directControl = parseDirectLightCommand(message, devices);

      if (sentenceBuffer.trim()) {
        eventBus.emit(RockyEvents.LLM_SENTENCE, { sessionId: session.id, text: sentenceBuffer.trim() });
        sentenceBuffer = "";
      }

      if (directControl) {
        eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "executing_skills" });
        if (sentenceBuffer.trim()) {
          eventBus.emit(RockyEvents.LLM_SENTENCE, { sessionId: session.id, text: sentenceBuffer.trim() });
          sentenceBuffer = "";
        }
        try {
          const output = await skillManager.executeSkill("control_device", directControl, context);
          if (output?.success) {
            eventBus.emit(RockyEvents.SOUND_TRIGGER, { sessionId: session.id, type: "success" });
            eventBus.emit(RockyEvents.UI_HINT, { sessionId: session.id, type: "control_device", data: directControl });
            finalContent = `${directControl.device} ${directControl.action}, Friend.`;
          } else {
            eventBus.emit(RockyEvents.SOUND_TRIGGER, { sessionId: session.id, type: "error" });
            finalContent = `Bad math. Could not control ${directControl.device}, Friend.`;
          }
        } catch {
          finalContent = "Bad math. Control path failed, Friend.";
        }
        eventBus.emit(RockyEvents.LLM_SENTENCE, { sessionId: session.id, text: finalContent });

      }
      
      if (looksLikeToolSchemaDump(finalContent)) {
        finalContent = "Bad math! Brain noisy now, Friend. Try again later.";
        eventBus.emit(RockyEvents.LLM_SENTENCE, { sessionId: session.id, text: finalContent });
      }

      const totalTime = Date.now() - startTime;
      log.info("Interaction complete", { traceId: finalTraceId, totalTime: totalTime + "ms" });

      latencyTracker.printReport(finalTraceId);

      eventBus.emit(RockyEvents.UI_HINT, { sessionId: session.id, type: "chat_response", data: { text: finalContent } });

      // Wait for all TTS sentences to finish playing before deciding next state
      await Promise.race([
        speechSynthesizer.waitForQueue(session.id),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("TTS queue timeout")), 30_000)
        ),
      ]).catch((err) => log.warn("TTS queue wait ended", { sessionId: session.id, reason: err.message }));

      if (!signal.aborted) {
        if (session.conversationMode) {
          this.startHotMicWindow(session);
        } else {
          eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId: session.id, status: "idle" });
        }
      }

      this.persistInteraction(session.id, message, finalContent, currentMessages).catch((err) => {
        log.error("Failed to persist interaction", { sessionId: session.id, error: err.message });
      });

    } catch (err: any) {
      if (err.name === "AbortError") {
        log.info("Interaction aborted by user", { traceId: finalTraceId, sessionId: session.id });
      } else {
        log.error("Interaction error", { traceId: finalTraceId, error: err.message });
        this.handleFailure(session.id, "Bad math! Brain is offline, Friend.");
      }
    } finally {
      clearTimeout(globalTimeoutId);
      if (session.abortController?.signal === signal) {
        session.abortController = null;
      }
    }
  }

  private async getHistory(deviceId: string): Promise<ChatMessage[]> {
    const history = await prisma.message.findMany({
      where: { deviceId },
      orderBy: { timestamp: "asc" },
      take: 10,
    });
    return history.map(h => ({
      role: (h.role === "model" ? "assistant" : "user") as any,
      content: h.text,
    }));
  }

  private async persistInteraction(deviceId: string, userMsg: string, aiMsg: string, currentMessages: ChatMessage[]) {
    await Promise.all([
      prisma.message.create({ data: { role: "user", text: userMsg, deviceId } }),
      prisma.message.create({ data: { role: "model", text: aiMsg, deviceId } }),
      memoryService.extractMemoriesFromChat([...currentMessages, { role: "assistant", content: aiMsg }])
    ]);
  }

  private isValidTranscript(text: string, session: Session, history: ChatMessage[]): boolean {
    if (!text || !text.trim()) return false;
    
    const cleanText = text.trim().toLowerCase().replace(/[.,!?]/g, "");
    
    // 1. Common Whisper Hallucinations (especially in noisy/silent rooms)
    const hallucinations = [
      "thanks for watching",
      "thank you for watching",
      "subtitles by",
      "subscribe",
      "please like and subscribe",
      "you",
      "thank you",
      "oh",
      "bye",
      "i am sorry",
      "it is",
      "thank you very much"
    ];
    
    const validShortCommands = ["sim", "não", "ok", "go", "stop", "luz", "oi", "ola", "olá"];
    const isHallucination = hallucinations.includes(cleanText);
    const isTooShort = cleanText.length < 2 && !validShortCommands.includes(cleanText);

    if (isHallucination || isTooShort) {
      log.warn("Transcript discarded as hallucination/too short", { 
        transcript: cleanText, 
        isHallucination, 
        isTooShort 
      });
      return false;
    }

    // 2. Echo Guard: Check if the text is just a repeat of Rocky's last response
    const lastAssistantMsg = [...history].reverse().find(m => m.role === "assistant" || (m as any).role === "model");
    if (lastAssistantMsg && lastAssistantMsg.content) {
      const lastContent = lastAssistantMsg.content.toLowerCase().replace(/[.,!?]/g, "");
      // If transcript is a significant substring of the last message (Echo)
      if (lastContent.includes(cleanText) && cleanText.length > 5) {
        log.warn("Echo detected and suppressed", { transcript: cleanText });
        return false;
      }
    }

    // 3. Noise Floor Sanity (Relaxed: let short commands through for testing)
    /*
    if (session.environmentalState.isNoisy && cleanText.split(" ").length < 2) {
      log.debug("Discarding short command in noisy environment", { transcript: cleanText });
      return false;
    }
    */

    return true;
  }

  private handleFailure(sessionId: string, message: string) {
    eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId, status: "error" });
    eventBus.emit(RockyEvents.SOUND_TRIGGER, { sessionId, type: "error" });
    eventBus.emit(RockyEvents.LLM_SENTENCE, { sessionId, text: message });
    
    // Force return to IDLE after UI shows error
    setTimeout(() => {
      const session = sessionManager.getSessionByDevice(sessionId);
      if (session) {
        eventBus.emit(RockyEvents.STATUS_UPDATE, { sessionId, status: "idle" });
      }
    }, 5000);
  }

  cleanupSession(sessionId: string) {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (session?.abortController) {
      session.abortController.abort();
      session.abortController = null;
    }
  }
}

export const orchestratorService = new OrchestratorService();
