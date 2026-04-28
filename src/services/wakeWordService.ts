import net from "net";
import { EventEmitter } from "events";
import { createTag } from "../lib/logger";

const log = createTag("WakeWord");

export class WakeWordService extends EventEmitter {
  private host: string;
  private port: number;
  private client: net.Socket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    host = process.env.WAKEWORD_HOST || "127.0.0.1", 
    port = parseInt(process.env.WAKEWORD_PORT || "10400")
  ) {
    super();
    this.host = host;
    this.port = port;
  }

  private getBackoffDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s
    return Math.min(1000 * Math.pow(2, attempt), 32000);
  }

  private attemptReconnect() {
    if (this.reconnectTimer) return; // already scheduled, prevent duplicate timers
    const delay = this.getBackoffDelay(Math.min(this.reconnectAttempts, 6));
    log.info(`Scheduling reconnect`, { delay, attempt: this.reconnectAttempts + 1 });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  get connected(): boolean {
    return this.isConnected;
  }

  connect() {
    if (this.isConnected) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.client = new net.Socket();
    
    this.client.connect(this.port, this.host, () => {
      log.info(`Connected to wake word engine`, { host: this.host, port: this.port });
      this.isConnected = true;
      this.reconnectAttempts = 0; // Reset on successful connection
      this.emit("connected");
      
      // Start Wyoming session
      this.client?.write(JSON.stringify({
        type: "audio-start",
        data: { rate: 16000, width: 2, channels: 1 },
      }) + "\n");
    });

    this.client.on("data", (data) => {
      const dataStr = data.toString();
      try {
        const lines = dataStr.split("\n").filter(l => l.trim());
        for (const line of lines) {
          const event = JSON.parse(line);
          if (event.type === "detection") {
            log.info(`Wake word detected`, { name: event.data.name, confidence: event.data.confidence });
            this.emit("wake_word", event.data?.name || "wake_word");
          }
        }
      } catch (e) {
        // Ignore potential partial JSON
      }
    });

    this.client.on("close", () => {
      log.warn("Connection closed. Reconnecting...");
      this.isConnected = false;
      this.emit("disconnected");
      this.attemptReconnect();
    });

    this.client.on("error", (err) => {
      log.error("Socket error", { error: err.message });
      this.isConnected = false;
      this.emit("disconnected");
      this.attemptReconnect();
    });
  }

  sendAudio(buffer: Buffer) {
    if (this.isConnected && this.client && this.client.writable) {
      try {
        // FIX #4: Remove duplicated header fields
        const event = {
          type: "audio-chunk",
          data: {
            rate: 16000,
            width: 2,
            channels: 1
          },
          payload_length: buffer.length
        };
        
        const headerText = JSON.stringify(event) + "\n";
        const header = Buffer.from(headerText);
        const combined = Buffer.concat([header, buffer]);
        this.client.write(combined);
      } catch (err: any) {
        log.error("Error sending audio", { error: err.message });
      }
    }
  }

  stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        if (this.client.writable) {
          this.client.write(JSON.stringify({
            type: "audio-stop",
            data: {},
          }) + "\n");
        }
      } catch {
        // Ignore write errors during teardown
      }
      this.client.removeAllListeners();
      this.client.destroy();
      this.client = null;
      this.isConnected = false;
    }
  }
}
