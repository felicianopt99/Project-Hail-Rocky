const LOG_TAG = "[Rocky OpenClaw]";

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

interface RpcRequest {
  type: "req";
  id: string;
  method: string;
  params: any;
}

interface RpcResponse {
  type: "res";
  id: string;
  ok: boolean;
  payload?: any;
  error?: { code: number; message: string };
}

interface RpcEvent {
  type: "event";
  event: string;
  payload: any;
  seq?: number;
  stateVersion?: number;
}

type RpcFrame = RpcRequest | RpcResponse | RpcEvent;

class OpenClawSocket {
  private ws: WebSocket | null = null;
  private handlers: Record<string, ((data: any) => void)[]> = {};
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private messageId = 0;
  private baseUrl: string;
  private token: string;
  private deviceToken: string | null = null;
  private pendingRequests: Record<string, (response: RpcResponse) => void> = {};

  constructor() {
    this.baseUrl = import.meta.env.VITE_BACKEND_URL || "ws://127.0.0.1:18789";
    this.token = import.meta.env.VITE_OPENCLAW_TOKEN || "rocky-secret-token-2026";
    this.connect();
  }

  private connect() {
    try {
      log("info", "Connecting to OpenClaw", { url: this.baseUrl });
      this.ws = new WebSocket(this.baseUrl);

      this.ws.onopen = () => {
        log("info", "WebSocket connected, waiting for challenge...");
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const frame: RpcFrame = JSON.parse(event.data);
          this.handleFrame(frame);
        } catch (err) {
          log("error", "Failed to parse frame", { data: event.data, error: err });
        }
      };

      this.ws.onerror = (err) => {
        log("error", "WebSocket error", err);
        this.emitInternal("connect_error", err);
      };

      this.ws.onclose = () => {
        log("warn", "WebSocket closed");
        this.isConnected = false;
        this.emitInternal("disconnect", undefined);
        this.reconnect();
      };
    } catch (err) {
      log("error", "Failed to create WebSocket", err);
      this.reconnect();
    }
  }

  private handleFrame(frame: RpcFrame) {
    if (frame.type === "event") {
      this.handleEvent(frame);
    } else if (frame.type === "res") {
      this.handleResponse(frame);
    }
  }

  private handleEvent(frame: RpcEvent) {
    log("info", "Event:", { event: frame.event, payload: typeof frame.payload === "string" ? frame.payload.substring(0, 50) : frame.payload });

    // Special handling for connect.challenge
    if (frame.event === "connect.challenge") {
      this.handleConnectChallenge(frame.payload);
      return;
    }

    if (frame.event === "hello-ok") {
      this.handleHelloOk(frame.payload);
      return;
    }

    // Forward other events to handlers
    this.emitInternal(frame.event, frame.payload);
  }

  private handleConnectChallenge(challenge: any) {
    log("info", "Received connect challenge", { nonce: challenge.nonce?.substring(0, 20) });

    // Send connect request with proper OpenClaw v3 format
    const connectRequest: RpcRequest = {
      type: "req",
      id: this.nextMessageId(),
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "webchat",
          version: "1.0.0",
          platform: "web",
          mode: "webchat"
        },
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        auth: {
          token: this.token
        }
      }
    };

    this.sendFrame(connectRequest);
  }

  private handleHelloOk(payload: any) {
    log("info", "Connected to OpenClaw", { deviceToken: payload.auth?.deviceToken?.substring?.(0, 20) });

    if (payload.auth?.deviceToken) {
      this.deviceToken = payload.auth.deviceToken;
    }

    this.isConnected = true;
    this.emitInternal("connect", undefined);
  }

  private handleResponse(frame: RpcResponse) {
    const callback = this.pendingRequests[frame.id];
    if (callback) {
      callback(frame);
      delete this.pendingRequests[frame.id];
    } else {
      log("warn", "Received response for unknown request", { id: frame.id });
    }
  }

  private sendFrame(frame: RpcFrame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log("warn", "WebSocket not open, cannot send frame", { type: frame.type });
      return;
    }

    try {
      const message = JSON.stringify(frame);
      this.ws.send(message);
      log("info", "Sent frame", { type: frame.type, id: (frame as any).id });
    } catch (err) {
      log("error", "Failed to send frame", { type: frame.type, error: err });
    }
  }

  private nextMessageId(): string {
    return `msg-${++this.messageId}`;
  }

  private reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
      log("warn", `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    } else {
      log("error", "Max reconnection attempts reached");
    }
  }

  private emitInternal(event: string, data?: any) {
    if (this.handlers[event]) {
      this.handlers[event].forEach((handler) => {
        try {
          handler(data);
        } catch (err) {
          log("error", `Handler error for ${event}`, err);
        }
      });
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
  }

  async emit(event: string, data: any) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log("warn", "Not connected, cannot emit", { event });
      this.emitInternal("connect_error", { message: "Not connected" });
      return;
    }

    try {
      let method = event;
      let params = data;

      // Map Rocky events to OpenClaw RPC methods
      if (event === "chat_request") {
        method = "chat.send";
        params = { message: data.content }; // OpenClaw expects 'message', not 'content'
      }

      const request: RpcRequest = {
        type: "req",
        id: this.nextMessageId(),
        method,
        params
      };

      log("info", "Sending RPC request", { method, id: request.id });
      this.sendFrame(request);
    } catch (err) {
      log("error", "Failed to emit event", { event, error: err });
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }

  get id(): string | undefined {
    return this.deviceToken || undefined;
  }
}

// Create instance with fallback
let socketInstance: OpenClawSocket | MockSocket;

class MockSocket {
  private handlers: Record<string, ((data: any) => void)[]> = {};
  private isConnected = false;

  constructor() {
    setTimeout(() => {
      this.isConnected = true;
      log("info", "MockSocket ready (development mode)");
      this.emitInternal("connect", undefined);
    }, 500);
  }

  private emitInternal(event: string, data?: any) {
    if (this.handlers[event]) {
      this.handlers[event].forEach((handler) => {
        try {
          handler(data);
        } catch (err) {
          log("error", `Handler error for ${event}`, err);
        }
      });
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
  }

  async emit(event: string, data: any) {
    if (event === "chat_request") {
      log("info", "MockSocket chat_request:", { content: data.content?.substring?.(0, 50) });
      setTimeout(() => {
        this.emitInternal("chat_response", {
          text: `Rocky (mock): You said "${data.content}". OpenClaw integration in progress!`
        });
      }, 1000);
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }

  get id(): string | undefined {
    return undefined;
  }
}

// Try real connection, fallback to mock if env not configured
const useRealConnection = import.meta.env.VITE_BACKEND_URL && import.meta.env.VITE_OPENCLAW_TOKEN;

if (useRealConnection) {
  log("info", "Using real OpenClaw connection");
  socketInstance = new OpenClawSocket();
} else {
  log("warn", "Environment variables not configured, using MockSocket");
  socketInstance = new MockSocket();
}

export default socketInstance;
