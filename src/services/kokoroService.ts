import axios from "axios";
import { Readable } from "stream";
import { createTag } from "../lib/logger";

const log = createTag("Kokoro");

const KOKORO_TIMEOUT_MS = 8000;   // 8s to receive first bytes
const KOKORO_MAX_RETRIES = 2;     // Retry once on transient failures

export class KokoroService {
  private baseUrl: string;
  private defaultVoice: string;

  constructor() {
    this.baseUrl = process.env.KOKORO_URL || "http://127.0.0.1:8880";
    this.defaultVoice = process.env.KOKORO_VOICE || "af_heart";
  }

  /**
   * Synthesize text to speech using Kokoro.
   * Returns a Readable stream of raw PCM audio at 24000Hz.
   */
  async synthesizeStream(text: string): Promise<Readable> {
    log.debug(`Streaming synthesis`, { text: text.substring(0, 50) + "..." });

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= KOKORO_MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          `${this.baseUrl}/v1/audio/speech`,
          {
            model: "kokoro",
            input: text,
            voice: this.defaultVoice,
            response_format: "pcm", // Raw PCM for streaming — 24000Hz, 16-bit mono
            speed: 1.0
          },
          {
            responseType: "stream",
            timeout: KOKORO_TIMEOUT_MS,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );

        return response.data;
      } catch (err: any) {
        lastError = err;
        const isTransient = err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.response?.status >= 500;
        if (isTransient && attempt < KOKORO_MAX_RETRIES) {
          log.warn(`Attempt ${attempt} failed, retrying...`, { error: err.code || err.message });
          await new Promise(resolve => setTimeout(resolve, 200 * attempt));
          continue;
        }
        break;
      }
    }

    log.error("All attempts failed", { error: lastError?.message });
    throw new Error(`Kokoro TTS Failed: ${lastError?.message}`);
  }

  async warmup(): Promise<void> {
    log.info("Warming up model...");
    try {
      const stream = await this.synthesizeStream("Rocky online.");
      stream.resume(); // drain and discard
      await new Promise<void>((resolve) => { stream.on("end", resolve); stream.on("error", resolve); });
      log.info("Warmup complete");
    } catch {
      log.warn("Warmup failed — Kokoro may not be running yet");
    }
  }

  // Keep the old synthesize for compatibility if needed
  async synthesize(text: string): Promise<Buffer> {
    const response = await axios.post(
      `${this.baseUrl}/v1/audio/speech`,
      {
        model: "kokoro",
        input: text,
        voice: this.defaultVoice,
        response_format: "wav"
      },
      {
        responseType: "arraybuffer",
        timeout: KOKORO_TIMEOUT_MS * 2,
      }
    );
    return Buffer.from(response.data);
  }
}

export const kokoroService = new KokoroService();
