import OpenAI, { toFile } from "openai";
import { Buffer } from "buffer";
import { healthMonitor } from "./serviceHealthMonitor";
import { createTag } from "../lib/logger";

const log = createTag("GroqSTT");

export class GroqSttService {
  private client: OpenAI | null = null;
  private model: string;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    this.model = process.env.GROQ_STT_MODEL || "whisper-large-v3";

    if (apiKey) {
      this.client = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://api.groq.com/openai/v1",
      });
    }
  }

  async transcribe(audioBuffer: Buffer): Promise<string> {
    if (!this.client) {
      throw new Error("GROQ_API_KEY not configured — voice transcription unavailable");
    }

    if (!healthMonitor.isAvailable("GROQ_STT")) {
      throw new Error("Groq STT service is currently degraded or offline");
    }

    log.info(`Transcribing ${audioBuffer.length} bytes`, { model: this.model });

    const MAX_ATTEMPTS = 3;
    let lastErr: any;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const file = await toFile(audioBuffer, "audio.wav", { type: "audio/wav" });
        const language = process.env.GROQ_STT_LANGUAGE || undefined;

        const transcription = await this.client.audio.transcriptions.create({
          file,
          model: this.model,
          ...(language ? { language } : {}),
          response_format: "text",
        }, { timeout: 20000 });

        healthMonitor.recordSuccess("GROQ_STT");
        return (transcription as unknown as string).trim() || "";
      } catch (err: any) {
        lastErr = err;
        const status = err.status || err.statusCode;
        const isTransient = status === 429 || status >= 500;
        if (!isTransient || attempt === MAX_ATTEMPTS - 1) break;
        const delay = 1000 * Math.pow(2, attempt); // 1s, 2s
        log.warn(`Transient error ${status}, retrying`, { attempt: attempt + 1, delay });
        await new Promise(r => setTimeout(r, delay));
      }
    }

    healthMonitor.recordFailure("GROQ_STT");
    log.error("Transcription failed after retries", { error: lastErr?.message });
    throw lastErr;
  }
}

export const groqSttService = new GroqSttService();
