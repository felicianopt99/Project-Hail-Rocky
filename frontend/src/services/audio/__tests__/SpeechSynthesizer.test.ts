import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventBus, RockyEvents } from "../../../lib/eventBus";
import { speechSynthesizer } from "../SpeechSynthesizer";
import { kokoroService } from "../../kokoroService";
import { Readable } from "stream";

vi.mock("../../kokoroService", () => ({
  kokoroService: {
    synthesizeStream: vi.fn()
  }
}));

vi.mock("../../piperService", () => ({
  piperService: {
    synthesizeStream: vi.fn()
  }
}));

describe("SpeechSynthesizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speechSynthesizer.cleanup("test-session");
  });

  it("should respond to LLM_SENTENCE and emit TTS events", async () => {
    // Create a mock readable stream
    const mockStream = new Readable({
      read() {
        this.push(Buffer.from("fake pcm data"));
        this.push(null);
      }
    });
    
    (kokoroService.synthesizeStream as any).mockResolvedValue(mockStream);

    const ttsStartSpy = vi.fn();
    const ttsChunkSpy = vi.fn();
    const ttsEndSpy = vi.fn();

    eventBus.on(RockyEvents.TTS_START, ttsStartSpy);
    eventBus.on(RockyEvents.TTS_CHUNK, ttsChunkSpy);
    eventBus.on(RockyEvents.TTS_END, ttsEndSpy);

    // Emit event that should trigger speech
    eventBus.emit(RockyEvents.LLM_SENTENCE, { sessionId: "test-session", text: "Hello Rocky" });

    // Wait for the async queue to process
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(kokoroService.synthesizeStream).toHaveBeenCalledWith("Hello Rocky");
    expect(ttsStartSpy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "test-session" }));
    expect(ttsChunkSpy).toHaveBeenCalled();
    expect(ttsEndSpy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "test-session" }));
  });

  it("should handle interrupts", async () => {
    const mockStream = new Readable({
      read() {
        // Stay open until destroyed
      }
    });
    mockStream.destroy = vi.fn();
    
    (kokoroService.synthesizeStream as any).mockResolvedValue(mockStream);

    speechSynthesizer.speak("test-session", "Long sentence that will be interrupted");
    
    await new Promise(resolve => setTimeout(resolve, 20));
    
    speechSynthesizer.interrupt("test-session");
    
    expect(mockStream.destroy).toHaveBeenCalled();
  });
});
