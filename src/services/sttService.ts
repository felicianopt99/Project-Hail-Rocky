import { whisperLocalService } from "./whisperLocalService";
import { groqSttService } from "./groqSttService";
import { createTag } from "../lib/logger";

const log = createTag("STT");

/**
 * STT facade: tries local Whisper first (if enabled), falls back to Groq.
 * This keeps all STT routing in one place and out of the orchestrator.
 */
export async function transcribeAudio(wavBuffer: Buffer): Promise<{ text: string; source: "local" | "groq" }> {
  if (whisperLocalService.isEnabled) {
    try {
      const text = await whisperLocalService.transcribe(wavBuffer);
      return { text, source: "local" };
    } catch (localErr: any) {
      log.warn("Local Whisper failed, falling back to Groq", { error: localErr.message });
    }
  }

  const text = await groqSttService.transcribe(wavBuffer);
  return { text, source: "groq" };
}
