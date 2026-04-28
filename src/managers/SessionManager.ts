import { WakeWordService } from "../services/wakeWordService";
import { VadState, vadService } from "../services/vadService";
import { createTag } from "../lib/logger";
import { EnvironmentalState } from "../services/noiseMonitorService";

const log = createTag("SessionManager");

export interface Session {
  id: string;
  socketId: string;
  isCommandActive: boolean;
  isCapturing: boolean;
  isProcessingCommand: boolean; // Mutex: prevents concurrent processCommand invocations
  commandBuffers: Buffer[];
  preRollBuffer: Buffer[];
  silenceTimeout: NodeJS.Timeout | null;
  wwService: WakeWordService;
  history: any[];
  lastActivity: number;
  silenceFrames?: number;
  silenceThreshold?: number; // Per-device VAD start threshold (default 0.50)
  speechStopThreshold?: number; // Per-device VAD stop threshold (default 0.25)
  silenceTimeout_ms?: number;
  cloudFailed?: boolean;
  isSpeaking: boolean;
  vadState: VadState;
  abortController: AbortController | null;
  conversationMode: boolean;
  hotMicActive: boolean;
  conversationExpiryTimeout: NodeJS.Timeout | null;
  hotMicSpeechFrames: number;       // frames consecutivos de fala no hot mic
  speechFramesInCommand: number;    // frames de fala durante a captura atual
  echoSuppressionUntil: number;     // timestamp até ao qual hot mic fica bloqueado
  environmentalState: EnvironmentalState; // Added for noise/context awareness
  interactionStats?: {
    turnsInWindow: number;
    windowStart: number;
  };
}

class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private socketToDevice: Map<string, string> = new Map();
  private readonly MAX_PRE_ROLL_CHUNKS = 6;
  private cleanupInterval: NodeJS.Timeout | null = null;

  createSession(deviceId: string, socketId: string): Session {
    log.info(`Mapping device to socket`, { deviceId, socketId });

    let session = this.sessions.get(deviceId);

    if (session) {
      log.info(`Reusing session for device`, { deviceId });
      // Remove stale socket mapping before updating
      if (session.socketId !== socketId) {
        this.socketToDevice.delete(session.socketId);
      }
      session.socketId = socketId;
      session.lastActivity = Date.now();

      // Ensure Wake Word service is active upon reconnection
      if (!session.wwService.connected) {
        session.wwService.connect();
      }
    } else {
      log.info(`Creating new session for device`, { deviceId });
      const wwService = new WakeWordService();
      wwService.connect();

      session = {
        id: deviceId,
        socketId,
        isCommandActive: false,
        isCapturing: false,
        isProcessingCommand: false,
        commandBuffers: [],
        preRollBuffer: [],
        silenceTimeout: null,
        wwService,
        history: [],
        lastActivity: Date.now(),
        silenceFrames: 0,
        cloudFailed: false,
        isSpeaking: false,
        vadState: vadService.createState(),
        abortController: null,
        conversationMode: false,
        hotMicActive: false,
        conversationExpiryTimeout: null,
        hotMicSpeechFrames: 0,
        speechFramesInCommand: 0,
        echoSuppressionUntil: 0,
        environmentalState: { noiseFloor: 0.005, isNoisy: false, detectedTypes: [], confidence: 0 },
      };
      this.sessions.set(deviceId, session);
    }

    this.socketToDevice.set(socketId, deviceId);
    return session;
  }

  getSessionBySocket(socketId: string): Session | undefined {
    const deviceId = this.socketToDevice.get(socketId);
    if (!deviceId) return undefined;
    
    const session = this.sessions.get(deviceId);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  getSessionByDevice(deviceId: string): Session | undefined {
    return this.sessions.get(deviceId);
  }

  removeSocket(socketId: string) {
    const deviceId = this.socketToDevice.get(socketId);
    if (deviceId) {
      this.socketToDevice.delete(socketId);
      const session = this.sessions.get(deviceId);

      if (session && session.socketId === socketId) {
        log.info(`Cleaning up active resources for socket`, { socketId, deviceId });
        
        // 1. Stop timers
        if (session.silenceTimeout) {
          clearTimeout(session.silenceTimeout);
          session.silenceTimeout = null;
        }
        if (session.conversationExpiryTimeout) {
          clearTimeout(session.conversationExpiryTimeout);
          session.conversationExpiryTimeout = null;
        }
        session.conversationMode = false;
        session.hotMicActive = false;

        // 2. Abort ongoing LLM requests
        if (session.abortController) {
          session.abortController.abort();
          session.abortController = null;
        }

        // 3. Stop external engine connections
        session.wwService.stop();

        // 4. Reset transient state
        session.isCommandActive = false;
        session.isCapturing = false;
        session.isProcessingCommand = false;
      }
    }
  }

  deleteSession(deviceId: string) {
    const session = this.sessions.get(deviceId);
    if (session) {
      session.wwService.stop();
      if (session.silenceTimeout) clearTimeout(session.silenceTimeout);
      if (session.conversationExpiryTimeout) clearTimeout(session.conversationExpiryTimeout);
      if (session.abortController) session.abortController.abort();
      this.socketToDevice.delete(session.socketId);
      this.sessions.delete(deviceId);
    }
  }

  cleanupInactiveSessions() {
    const now = Date.now();
    const timeout = 60 * 60 * 1000;
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivity > timeout) {
        log.info(`Cleaning up inactive session`, { deviceId: id });
        this.deleteSession(id);
      }
    }
  }

  start() {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => this.cleanupInactiveSessions(), 60_000);
    this.cleanupInterval.unref();
  }

  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  getPreRollMax() {
    return this.MAX_PRE_ROLL_CHUNKS;
  }
}

export const sessionManager = new SessionManager();
sessionManager.start();
