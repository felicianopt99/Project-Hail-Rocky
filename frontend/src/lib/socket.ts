import { io, Socket } from "socket.io-client";

const LOG_TAG = "[OpenClaw]";

function log(level: "info" | "warn" | "error", msg: string, data?: any) {
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} ${LOG_TAG} [${level.toUpperCase()}]`;
  if (level === "error") {
    console.error(`${prefix} ${msg}`, data || "");
  } else if (level === "warn") {
    console.warn(`${prefix} ${msg}`, data || "");
  } else {
    console.log(`${prefix} ${msg}`, data || "");
  }
}

class OpenClawSocket {
  public socket: Socket | null = null;
  private url: string;
  private token: string;
  private handlers: Record<string, ((data: any) => void)[]> = {};

  constructor() {
    this.url = import.meta.env.VITE_BACKEND_URL || "ws://127.0.0.1:18789";
    // Convert ws:// to http:// for socket.io-client
    const httpUrl = this.url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
    this.token = import.meta.env.VITE_OPENCLAW_TOKEN || "";
    
    log("info", "Initializing Socket.io connection...", { url: httpUrl });
    
    this.socket = io(httpUrl, {
      auth: {
        token: this.token
      },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    this.setupListeners();
  }

  private setupListeners() {
    if (!this.socket) return;

    // Listen to all events and bridge them to internal handlers
    // This captures connect, disconnect, connect_error, and all other events
    this.socket.onAny((event, ...args) => {
      this.emitInternal(event, args[0]);
    });
  }

  private emitInternal(event: string, data?: any) {
    if (this.handlers[event]) {
      this.handlers[event].forEach((handler) => handler(data));
    }
  }

  on(event: string, handler: (data: any) => void) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  off(event: string, handler: (data: any) => void) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter((h) => h !== handler);
    }
    this.socket?.off(event, handler);
  }

  emit(event: string, data: any, callback?: any) {
    if (this.socket && this.socket.connected) {
      // Map Rocky events to OpenClaw protocol if needed
      let type = event;
      let payload = data;
      
      if (event === "audio_chunk") {
        type = "audio";
        payload = { pcm16: data };
      } else if (event === "chat_request") {
        type = "text";
        payload = { text: data.content };
      }
      
      this.socket.emit(type, payload, callback);
    } else {
      log("warn", "Attempted to emit while disconnected", { event });
    }
  }

  get connected() {
    return this.socket?.connected || false;
  }

  get id() {
    return this.socket?.id;
  }
}

const socketInstance = new OpenClawSocket();
export default socketInstance;
