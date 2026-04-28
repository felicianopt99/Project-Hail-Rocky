import net from "net";
import { healthMonitor } from "./serviceHealthMonitor";
import { createTag } from "../lib/logger";

const log = createTag("WhisperLocal");

const HOST = process.env.LOCAL_WHISPER_HOST || "127.0.0.1";
const PORT = parseInt(process.env.LOCAL_WHISPER_PORT || "10300");
const TIMEOUT_MS = parseInt(process.env.LOCAL_WHISPER_TIMEOUT_MS || "20000");
const CHUNK_SIZE = 4096;

/**
 * Wyoming ASR client for wyoming-faster-whisper (or any Wyoming-compatible STT server).
 * Protocol:
 *   C→S: { type: "transcribe", data: { language } }\n
 *   C→S: { type: "audio-start", data: { rate, width, channels } }\n
 *   C→S: { type: "audio-chunk", payload_length: N }\n + N bytes
 *   C→S: { type: "audio-stop" }\n
 *   S→C: { type: "transcript", data: { text } }\n
 */
export class WhisperLocalService {
  private host: string;
  private port: number;
  private timeoutMs: number;

  constructor(
    host = HOST,
    port = PORT,
    timeoutMs = TIMEOUT_MS
  ) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  get isEnabled(): boolean {
    return process.env.LOCAL_WHISPER_ENABLED === "true";
  }

  async transcribe(pcmBuffer: Buffer): Promise<string> {
    if (!this.isEnabled) {
      throw new Error("LOCAL_WHISPER_ENABLED not set — skipping local Whisper");
    }

    if (!healthMonitor.isAvailable("WHISPER_LOCAL")) {
      throw new Error("Local Whisper is currently degraded or offline");
    }

    log.info(`Transcribing ${pcmBuffer.length} bytes via local Whisper`, { host: this.host, port: this.port });

    // Strip WAV header if present (RIFF header is 44 bytes)
    // Wyoming protocol expects raw PCM (16kHz, 16-bit mono)
    let audioData = pcmBuffer;
    if (pcmBuffer.length > 44 && pcmBuffer.subarray(0, 4).toString() === "RIFF") {
      log.debug("Stripping WAV header for local Whisper (Wyoming expects raw PCM)");
      audioData = pcmBuffer.subarray(44);
    }

    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let transcript = "";
      let settled = false;
      let buffer = "";

      const cleanup = () => {
        client.removeAllListeners();
        client.destroy();
      };

      const done = (err?: Error, result?: string) => {
        if (settled) return;
        settled = true;
        cleanup();

        if (err) {
          healthMonitor.recordFailure("WHISPER_LOCAL");
          log.error("Transcription failed", { error: err.message });
          reject(err);
        } else {
          healthMonitor.recordSuccess("WHISPER_LOCAL");
          log.info("Transcript received", { text: result || "<empty>" });
          resolve(result || "");
        }
      };

      const timer = setTimeout(
        () => done(new Error(`Local Whisper timeout after ${this.timeoutMs}ms`)),
        this.timeoutMs
      );

      client.connect(this.port, this.host, () => {
        const language = process.env.GROQ_STT_LANGUAGE || undefined;

        // 1. Transcribe intent
        client.write(
          JSON.stringify({ type: "transcribe", data: { language: language ?? null } }) + "\n"
        );

        // 2. Audio start
        client.write(
          JSON.stringify({ type: "audio-start", data: { rate: 16000, width: 2, channels: 1 } }) + "\n"
        );

        // 3. Stream audio in chunks
        for (let offset = 0; offset < audioData.length; offset += CHUNK_SIZE) {
          const chunk = audioData.subarray(offset, offset + CHUNK_SIZE);
          const header = JSON.stringify({ type: "audio-chunk", payload_length: chunk.length }) + "\n";
          client.write(Buffer.concat([Buffer.from(header), chunk]));
        }

        // 4. Audio stop
        client.write(JSON.stringify({ type: "audio-stop" }) + "\n");
      });

      client.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);
            if (event.type === "transcript") {
              transcript = (event.data?.text ?? "").trim();
              clearTimeout(timer);
              done(undefined, transcript);
            } else if (event.type === "error") {
              clearTimeout(timer);
              done(new Error(event.data?.text || "Wyoming STT server error"));
            }
          } catch {
            // partial JSON — wait for more data
          }
        }
      });

      client.on("error", (err) => {
        clearTimeout(timer);
        done(err);
      });

      client.on("close", () => {
        if (!settled) {
          clearTimeout(timer);
          // If connection closed before transcript, use what we have
          done(
            transcript ? undefined : new Error("Connection closed before transcript"),
            transcript || undefined
          );
        }
      });
    });
  }

  async checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const client = new net.Socket();
      const timer = setTimeout(() => {
        client.destroy();
        resolve(false);
      }, 3000);

      client.connect(this.port, this.host, () => {
        clearTimeout(timer);
        client.destroy();
        resolve(true);
      });

      client.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }
}

export const whisperLocalService = new WhisperLocalService();
