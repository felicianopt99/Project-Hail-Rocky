import axios from "axios";
import { Buffer } from "buffer";
import fs from "fs";
import { Readable } from "stream";
import { createTag } from "../lib/logger";

const log = createTag("NvidiaTTS");

export class NvidiaTtsService {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private speakerAudioCache: string | null = null;

  constructor() {
    this.apiKey = process.env.NVIDIA_API_KEY || "";
    this.baseUrl = process.env.NVIDIA_TTS_URL || "https://integrate.api.nvidia.com/v1";
    this.model = process.env.NVIDIA_TTS_MODEL || "nvidia/nemotron-tts-zeroshot";
  }

  /**
   * Synthesize text to speech using NVIDIA NIM.
   * Returns a Readable stream of audio data.
   */
  async synthesizeStream(text: string): Promise<Readable> {
    if (!this.apiKey) throw new Error("NVIDIA_API_KEY is not set");

    log.debug(`Streaming synthesis`, { text: text.substring(0, 50) + "..." });

    try {
      const payload: any = {
        input: text,
        model: this.model,
        voice: process.env.NVIDIA_TTS_VOICE || "Ryan",
        response_format: "pcm", // Use PCM for streaming
        sample_rate: 44100
      };

      const wavPath = process.env.NVIDIA_TTS_SPEAKER_WAV_PATH;
      if (wavPath && fs.existsSync(wavPath)) {
        if (!this.speakerAudioCache) {
          const audioRef = fs.readFileSync(wavPath);
          this.speakerAudioCache = audioRef.toString("base64");
        }
        payload.speaker_audio = this.speakerAudioCache;
      }

      const response = await axios.post(
        `${this.baseUrl}/audio/speech`,
        payload,
        {
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "Accept": "audio/pcm"
          },
          responseType: "stream"
        }
      );

      return response.data;
    } catch (err: any) {
      log.error("Streaming Error", { error: err.message });
      throw new Error(`NVIDIA TTS Streaming Failed: ${err.message}`);
    }
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.apiKey) throw new Error("NVIDIA_API_KEY is not set");
    
    const payload: any = {
      input: text,
      model: this.model,
      voice: process.env.NVIDIA_TTS_VOICE || "Ryan",
      response_format: "wav",
      sample_rate: 44100
    };

    const response = await axios.post(
      `${this.baseUrl}/audio/speech`,
      payload,
      {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        responseType: "arraybuffer"
      }
    );
    return Buffer.from(response.data);
  }
}

export const nvidiaTtsService = new NvidiaTtsService();
