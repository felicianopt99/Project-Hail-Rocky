import { Server, Socket } from "socket.io";
import { sessionManager } from "../managers/SessionManager";
import { orchestratorService } from "../services/orchestratorService";
import { systemStateManager } from "../managers/SystemStateManager";
import { skillManager } from "../skills/SkillManager";
import { createTag } from "../lib/logger";
import {
  ControlDeviceSchema,
  ChatRequestSchema,
  SaveProtocolSchema,
  CreateProtocolSchema,
  DeleteProtocolSchema,
  SetSensitivitySchema,
  SetModeSchema,
} from "../lib/validation";
import { z } from "zod";
import { eventBus, RockyEvents } from "../lib/eventBus";
import { speechSynthesizer } from "../services/audio/SpeechSynthesizer";
import { audioProcessor } from "../services/audio/AudioProcessor";

const log = createTag("SocketHandlers");

// ========== AUDIO SESSION MANAGEMENT ==========
interface AudioSession {
  socketId: string;
  audioBuffer: Buffer;
  audioQueueSize: number;
  lastChunkTime: number;
  chunkCount: number;
  silenceCounter: number;
}

const audioSessions = new Map<string, AudioSession>();
const MAX_AUDIO_BUFFER_SIZE = 5 * 1024 * 1024; // 5MB max
const AUDIO_CHUNK_TIMEOUT = 5000; // 5s timeout
const MAX_CONSECUTIVE_SILENCE = 10;

export function setupSocketHandlers(io: Server) {
  // ─── Event Bus Bridge (Server-side events -> Client-side sockets) ────────────

  eventBus.on(RockyEvents.STATUS_UPDATE, ({ sessionId, status }) => {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (session) io.to(session.socketId).emit("status_update", status);
  });

  eventBus.on(RockyEvents.SOUND_TRIGGER, ({ sessionId, type }) => {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (session) io.to(session.socketId).emit("sound_trigger", { type });
  });

  eventBus.on(RockyEvents.TTS_START, ({ sessionId, sampleRate }) => {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (session) io.to(session.socketId).emit("tts_start", { sampleRate });
  });

  eventBus.on(RockyEvents.TTS_CHUNK, ({ sessionId, chunk }) => {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (session) io.to(session.socketId).emit("tts_chunk", chunk);
  });

  eventBus.on(RockyEvents.TTS_END, ({ sessionId, interrupted }) => {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (!session) return;

    if (interrupted) {
      io.to(session.socketId).emit("stop_speaking");
    } else {
      io.to(session.socketId).emit("tts_end");
    }
  });

  eventBus.on(RockyEvents.LLM_TOKEN, ({ sessionId, token }) => {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (session) io.to(session.socketId).emit("chat_token", token);
  });

  eventBus.on(RockyEvents.WAKE_WORD_DETECTED, ({ sessionId, name }) => {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (session) {
      log.info(`[WAKE_WORD] ${name}`, { sessionId });
      io.to(session.socketId).emit("status_update", "listening");
      io.to(session.socketId).emit("wake_word_detected", { name });
    }
  });

  eventBus.on(RockyEvents.UI_HINT, ({ sessionId, type, value }) => {
    const session = sessionManager.getSessionByDevice(sessionId);
    if (session) {
      io.to(session.socketId).emit("ui_hint", { type, value });

      // Compatibility for legacy socket events
      if (type === "timer_fired") io.to(session.socketId).emit("timer_fired", value);
      if (type === "set_volume") io.to(session.socketId).emit("set_volume", value);
      if (type === "transcript") io.to(session.socketId).emit("transcript_result", value);
      if (type === "chat_response") io.to(session.socketId).emit("chat_response", value);
    }
  });

  // Global System State Forwarding
  systemStateManager.on("stats_updated", (stats) => {
    io.emit("stats_updated", stats);
  });

  systemStateManager.on("new_log", (newLog) => {
    io.emit("new_log", newLog);
  });

  systemStateManager.on("device_updated", (data) => {
    io.emit("device_updated", data);
  });

  systemStateManager.on("weather_updated", (weather) => {
    io.emit("weather_updated", weather);
  });

  systemStateManager.on("mode_updated", (mode) => {
    io.emit("mode_updated", mode);
  });

  systemStateManager.on("areas_updated", (areas) => {
    io.emit("areas_updated", areas);
  });

  systemStateManager.on("state_synced", () => {
    io.emit("system_state_update", systemStateManager.getState());
  });

  systemStateManager.on("protocol_updated", (data) => {
    io.emit("protocol_updated", data);
  });

  systemStateManager.on("protocol_created", (data) => {
    io.emit("protocol_created", data);
  });

  systemStateManager.on("protocol_deleted", (data) => {
    io.emit("protocol_deleted", data);
  });

  const wrapHandler = (
    socket: Socket,
    event: string,
    schema: z.ZodSchema | null,
    handler: (data: any) => Promise<void> | void
  ) => {
    socket.on(event, async (data: any) => {
      try {
        if (schema) {
          const result = schema.safeParse(data);
          if (!result.success) {
            log.warn(`Invalid data for event "${event}"`, {
              errors: result.error.issues,
              data,
            });
            socket.emit("error", {
              message: `Invalid data for ${event}`,
              details: result.error.issues,
            });
            return;
          }
          data = result.data;
        }
        await handler(data);
      } catch (err: any) {
        log.error(`Error in event "${event}"`, {
          error: err.message,
          stack: err.stack,
        });
        socket.emit("error", { message: "Internal server error" });
      }
    });
  };

  io.on("connection", (socket: Socket) => {
    const deviceId = (socket.handshake.auth.deviceId as string) || `anon_${socket.id}`;

    log.info(`[CONNECT] User connected`, { socketId: socket.id, deviceId });

    // Create or retrieve session for this device
    const session = sessionManager.createSession(deviceId, socket.id);

    // Initialize audio session
    audioSessions.set(socket.id, {
      socketId: socket.id,
      audioBuffer: Buffer.alloc(0),
      audioQueueSize: 0,
      lastChunkTime: Date.now(),
      chunkCount: 0,
      silenceCounter: 0,
    });

    // Synchronize current system state to the new client
    socket.emit("system_state_update", systemStateManager.getState());

    // Send initial wake word service connectivity status
    socket.emit("service_status", {
      service: "wakeword",
      ok: session.wwService.connected,
    });

    // Track wake word service connectivity changes for this socket
    const onWWConnected = () =>
      socket.emit("service_status", { service: "wakeword", ok: true });
    const onWWDisconnected = () =>
      socket.emit("service_status", { service: "wakeword", ok: false });
    session.wwService.on("connected", onWWConnected);
    session.wwService.on("disconnected", onWWDisconnected);

    // ========== AUDIO CHUNK HANDLER (ROBUST) ==========
    socket.on("audio_chunk", (data: any, callback?: (ack: any) => void) => {
      const audioSession = audioSessions.get(socket.id);
      if (!audioSession) {
        log.warn(`Audio chunk received but session not found`, { socketId: socket.id });
        callback?.({ success: false, error: "Session not found" });
        return;
      }

      try {
        // Validate audio data
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);

        if (chunk.length === 0) {
          log.warn(`Empty audio chunk received`);
          callback?.({ success: false, error: "Empty chunk" });
          return;
        }

        if (chunk.length > 65536) {
          log.warn(`Audio chunk too large`, {
            size: chunk.length,
            maxAllowed: 65536,
          });
          callback?.({ success: false, error: "Chunk too large" });
          return;
        }

        // Check buffer size
        if (
          audioSession.audioBuffer.length + chunk.length >
          MAX_AUDIO_BUFFER_SIZE
        ) {
          log.error(`Audio buffer exceeded`, {
            currentSize: audioSession.audioBuffer.length,
            newChunkSize: chunk.length,
            maxSize: MAX_AUDIO_BUFFER_SIZE,
          });
          // Reset buffer
          audioSession.audioBuffer = Buffer.alloc(0);
          callback?.({ success: false, error: "Buffer overflow" });
          return;
        }

        // Append chunk to buffer
        audioSession.audioBuffer = Buffer.concat([
          audioSession.audioBuffer,
          chunk,
        ]);
        audioSession.audioQueueSize = audioSession.audioBuffer.length;
        audioSession.lastChunkTime = Date.now();
        audioSession.chunkCount++;

        // Log every 50 chunks
        if (audioSession.chunkCount % 50 === 0) {
          log.info(`Audio flowing`, {
            chunkCount: audioSession.chunkCount,
            bufferSize: audioSession.audioQueueSize,
          });
        }

        // Emit event for VAD/processing
        eventBus.emit(RockyEvents.AUDIO_INPUT_CHUNK, {
          sessionId: session.id,
          chunk,
          sequenceNumber: audioSession.chunkCount,
        });

        // Acknowledge to client
        callback?.({ success: true, chunkNumber: audioSession.chunkCount });
      } catch (err: any) {
        log.error(`Error processing audio chunk`, {
          error: err.message,
          stackTrace: err.stack,
        });
        callback?.({ success: false, error: err.message });
      }
    });

    // ========== AUDIO BLOB HANDLER (Fallback for MediaRecorder) ==========
    socket.on("audio_blob", (blob: Blob, callback?: (ack: any) => void) => {
      log.info(`Audio blob received`, { size: blob.size, type: blob.type });

      try {
        blob.arrayBuffer().then((arrayBuffer) => {
          const buffer = Buffer.from(arrayBuffer);
          // Process blob as if it's PCM
          eventBus.emit(RockyEvents.AUDIO_INPUT_CHUNK, {
            sessionId: session.id,
            chunk: buffer,
            isBlob: true,
          });
          callback?.({ success: true });
        });
      } catch (err: any) {
        log.error(`Error processing audio blob`, { error: err.message });
        callback?.({ success: false, error: err.message });
      }
    });

    // ========== MANUAL TRIGGER ==========
    socket.on("manual_trigger", () => {
      log.info(`[MANUAL_TRIGGER] Mic button clicked`, { sessionId: session.id });

      if (session.isCommandActive) {
        log.info(`Stopping active command`);
        eventBus.emit(RockyEvents.VAD_SPEECH_STOP, session.id);
      } else {
        log.info(`Starting command via manual trigger`);
        eventBus.emit(RockyEvents.WAKE_WORD_DETECTED, {
          sessionId: session.id,
          name: "manual",
        });
      }
    });

    // ========== HEARTBEAT RESPONSE ==========
    socket.on("ping", (data: any, callback?: (ack: any) => void) => {
      callback?.({ timestamp: Date.now() });
    });

    // Chat request (Text or Speech result)
    wrapHandler(socket, "chat_request", ChatRequestSchema, async (data) => {
      log.info(`Chat request from ${deviceId}`, { message: data.message });
      const devices = systemStateManager.getState().availableDevices;

      // Map history to the format expected by the LLM (OpenAI/NIM)
      const mappedHistory = (data.history || []).map((h: any) => ({
        role: h.role === "model" ? ("assistant" as const) : (h.role as "user"),
        content: h.text || h.content || "",
      }));

      await orchestratorService.handleChatRequest(
        session,
        data.message,
        mappedHistory,
        devices
      );
    });

    // Manual mode change
    wrapHandler(socket, "set_mode", SetModeSchema, (mode) => {
      systemStateManager.setMode(mode);
    });

    // Individual Device Control (from Dashboard)
    wrapHandler(socket, "control_device", ControlDeviceSchema, async (data) => {
      const currentState = systemStateManager.getState();
      const availableEntities = Object.keys(currentState.lights);

      if (!availableEntities.includes(data.device) && data.device !== "all") {
        log.warn(`Attempt to control unknown device: "${data.device}"`);
        return;
      }

      log.info(`Device control request: ${data.device} -> ${data.action}`, {
        params: data.params,
      });
      await systemStateManager.controlDevice(data.device, data.action, data.params);
    });

    // Routine execution
    wrapHandler(socket, "execute_routine", null, (routineId) => {
      systemStateManager.executeRoutine(routineId);
    });

    // Sync Home Assistant on demand
    wrapHandler(socket, "sync_ha", null, async () => {
      await systemStateManager.syncHA();
      socket.emit("system_state_update", systemStateManager.getState());
    });

    // Latency measurement
    socket.on("ping_latency", (sentAt: number) => {
      socket.emit("pong_latency", sentAt);
    });

    // Save protocol settings from the Dashboard Protocol editor
    wrapHandler(socket, "save_protocol", SaveProtocolSchema, async (data) => {
      await systemStateManager.saveProtocol(data);
    });

    wrapHandler(socket, "create_protocol", CreateProtocolSchema, async (data) => {
      await systemStateManager.createProtocol(data);
    });

    wrapHandler(socket, "delete_protocol", DeleteProtocolSchema, async (data) => {
      await systemStateManager.deleteProtocol(data.id);
    });

    // Client-side log entries (e.g. from protocol views)
    wrapHandler(socket, "add_log", null, (message: string) => {
      if (typeof message === "string" && message.trim()) {
        systemStateManager.addLog(message.trim());
      }
    });

    // Per-device voice sensitivity settings from Controls panel
    wrapHandler(socket, "set_sensitivity", SetSensitivitySchema, (data) => {
      session.silenceThreshold = data.silenceThreshold;
      session.silenceTimeout_ms = data.silenceTimeout;
    });

    // Handle manual disconnect
    socket.on("disconnect", () => {
      log.info(`[DISCONNECT] User disconnected`, { socketId: socket.id, deviceId });

      const audioSession = audioSessions.get(socket.id);
      if (audioSession) {
        log.info(`Cleaning up audio session`, {
          chunkCount: audioSession.chunkCount,
          bufferSize: audioSession.audioQueueSize,
        });
        audioSessions.delete(socket.id);
      }

      session.wwService.off("wake_word", onWakeWord);
      session.wwService.off("connected", onWWConnected);
      session.wwService.off("disconnected", onWWDisconnected);
      orchestratorService.off("silence_timeout", onSilenceTimeout);
      orchestratorService.cleanupSession(session.id);
      speechSynthesizer.cleanup(session.id);
      sessionManager.removeSocket(socket.id);
    });

    // Error handling
    socket.on("error", (err: any) => {
      log.error(`Socket error`, {
        socketId: socket.id,
        error: err.message || err,
      });
    });

    // Wake word triggered by backend engine
    const onWakeWord = (name: string) => {
      if (Date.now() < session.echoSuppressionUntil) {
        log.debug("Wake word ignored (suppression active)", { name });
        return;
      }
      session.echoSuppressionUntil = Date.now() + 3000; // 3s block
      eventBus.emit(RockyEvents.WAKE_WORD_DETECTED, { sessionId: session.id, name });
    };
    session.wwService.on("wake_word", onWakeWord);

    // Silence timeout from orchestrator or audio processor
    const onSilenceTimeout = (sessionId: string) => {
      if (sessionId === session.id) {
        // Trigger command processing in Orchestrator
        eventBus.emit(RockyEvents.VAD_SPEECH_STOP, sessionId);
      }
    };
    orchestratorService.on("silence_timeout", onSilenceTimeout);
  });

  // ========== CLEANUP STALE SESSIONS (every 30s) ==========
  setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;

    audioSessions.forEach((session, socketId) => {
      if (now - session.lastChunkTime > AUDIO_CHUNK_TIMEOUT) {
        log.warn(`Cleaning up stale audio session`, {
          socketId,
          inactiveFor: now - session.lastChunkTime,
        });
        audioSessions.delete(socketId);
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) {
      log.info(`Cleanup completed`, { sessionsRemoved: cleanedCount });
    }
  }, 30000);
}
