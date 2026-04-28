import net from "net";
import { Readable, PassThrough } from "stream";
import { createTag } from "../lib/logger";

const log = createTag("Piper");

const PIPER_SOCKET_TIMEOUT_MS = 5000; // 5s max — if Piper hangs, give up
const PIPER_MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB overflow guard

export class PiperService {
  private host: string;
  private port: number;
  private voice: string;

  constructor() {
    this.host = process.env.PIPER_HOST || "rocky-piper";
    this.port = parseInt(process.env.PIPER_PORT || "10200");
    this.voice = process.env.PIPER_VOICE || "en_US-lessac-medium";
  }

  /**
   * Synthesize text to speech using Piper (Wyoming Protocol).
   * Returns a Readable stream of raw 16-bit PCM audio at 22050Hz.
   */
  async synthesizeStream(text: string): Promise<Readable> {
    log.debug(`Streaming synthesis`, { text: text.substring(0, 50) + "..." });
    
    const outputStream = new PassThrough();
    const client = new net.Socket();

    // ── Timeout guard: destroy socket if Piper takes too long ─────────────────
    client.setTimeout(PIPER_SOCKET_TIMEOUT_MS);
    client.on("timeout", () => {
      log.error(`Socket timeout, aborting`, { timeout: PIPER_SOCKET_TIMEOUT_MS });
      client.destroy();
      if (!outputStream.destroyed) {
        outputStream.destroy(new Error("Piper synthesis timeout"));
      }
    });

    client.connect(this.port, this.host, () => {
      // Reset timeout to cover synthesis duration — without this, a hung synthesis waits forever
      client.setTimeout(PIPER_SOCKET_TIMEOUT_MS);

      // 1. Send Synthesize event
      const event = {
        type: "synthesize",
        data: {
          text: text,
          voice: { name: this.voice }
        }
      };
      client.write(JSON.stringify(event) + "\n");
    });

    let buffer = Buffer.alloc(0);

    client.on("data", (chunk) => {
      client.setTimeout(PIPER_SOCKET_TIMEOUT_MS); // Reset timeout on each received chunk
      buffer = Buffer.concat([buffer, chunk]);

      // ── Overflow guard ─────────────────────────────────────────────────────
      if (buffer.length > PIPER_MAX_BUFFER_BYTES) {
        log.error("Buffer overflow — destroying connection");
        client.destroy();
        outputStream.destroy(new Error("Piper buffer overflow"));
        return;
      }
      
      while (buffer.length > 0) {
        // We always look for a JSON header first
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) break; // Wait for full JSON header line

        let event: any;
        try {
          const line = buffer.slice(0, newlineIndex).toString();
          event = JSON.parse(line);
        } catch (e) {
          // If not JSON, we might be mid-stream or misaligned
          buffer = buffer.slice(newlineIndex + 1);
          continue;
        }

        const headerLength = newlineIndex + 1;
        const payloadLength = event.payload_length || 0;

        if (buffer.length < headerLength + payloadLength) {
          // Wait for full payload to arrive
          break;
        }

        // We have the full event + payload
        if (event.type === "audio-chunk") {
          const audioData = buffer.slice(headerLength, headerLength + payloadLength);
          outputStream.write(audioData);
        } else if (event.type === "audio-stop") {
          client.end();
        }

        // Advance buffer past header and payload
        buffer = buffer.slice(headerLength + payloadLength);
      }
    });

    client.on("end", () => {
      outputStream.end();
    });

    client.on("error", (err) => {
      log.error("Socket Error", { error: err.message });
      if (!outputStream.destroyed) outputStream.destroy(err);
    });

    return outputStream;
  }
}

export const piperService = new PiperService();
