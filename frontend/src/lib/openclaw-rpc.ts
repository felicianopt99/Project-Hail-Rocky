// Simplified OpenClaw RPC client that uses the Control UI proxy
// Instead of implementing the complex v3 signature handshake,
// we use HTTP REST calls which are simpler

const LOG_TAG = "[OpenClaw HTTP]";

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

class OpenClawRPC {
  private baseUrl: string;
  private token: string;
  private handlers: Record<string, ((data: any) => void)[]> = {};
  private isConnected = false;

  constructor() {
    this.baseUrl = import.meta.env.VITE_BACKEND_URL?.replace("ws://", "http://") || "http://127.0.0.1:18789";
    this.token = import.meta.env.VITE_OPENCLAW_TOKEN || "rocky-secret-token-2026";
    this.connect();
  }

  private connect() {
    log("info", "Connecting to OpenClaw via HTTP...");
    // Simulate connection with a health check
    this.healthCheck();
  }

  private async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/v1/health/ready`);
      if (response.ok) {
        log("info", "Connected to OpenClaw");
        this.isConnected = true;
        this.emitInternal("connected", {});
        this.emitInternal("connect", undefined);
        this.pollForUpdates();
      }
    } catch (err) {
      log("warn", "Health check failed, retrying...");
      setTimeout(() => this.healthCheck(), 3000);
    }
  }

  private pollForUpdates() {
    // Poll for chat updates every 2 seconds
    setInterval(() => {
      // This would be implemented with actual API calls
    }, 2000);
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
      // For now, just log - would call OpenClaw API
      log("info", "Chat request (HTTP mode)", { content: data.content?.substring?.(0, 50) });
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }

  get id(): string | undefined {
    return undefined;
  }
}

const instance = new OpenClawRPC();
export default instance;
