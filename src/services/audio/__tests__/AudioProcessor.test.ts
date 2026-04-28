import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventBus, RockyEvents } from "../../../lib/eventBus";
import { audioProcessor } from "../AudioProcessor";
import { vadService } from "../../vadService";
import { sessionManager } from "../../../managers/SessionManager";

vi.mock("../../vadService", () => ({
  vadService: {
    isSpeech: vi.fn(),
    reset: vi.fn()
  }
}));

describe("AudioProcessor", () => {
  const mockSession = {
    id: "test-device",
    isCommandActive: false,
    isProcessingCommand: false,
    commandBuffers: [],
    preRollBuffer: [],
    wwService: { sendAudio: vi.fn() },
    isSpeaking: false,
    isCapturing: false,
    silenceThreshold: 0.5,
    silenceFrames: 0
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(sessionManager, "getSessionByDevice").mockReturnValue(mockSession as any);
    vi.spyOn(sessionManager, "getPreRollMax").mockReturnValue(5);
    
    mockSession.isCommandActive = false;
    mockSession.isCapturing = false;
    mockSession.isProcessingCommand = false;
    mockSession.commandBuffers = [];
    mockSession.preRollBuffer = [];
    mockSession.silenceFrames = 0;
  });

  it("should buffer chunks into pre-roll when idle and forward to WW", async () => {
    (vadService.isSpeech as any).mockResolvedValue(0.1);
    const chunk = Buffer.from([1, 2, 3]);
    
    await audioProcessor.handleAudioChunk("test-device", chunk);
    
    expect(mockSession.preRollBuffer).toHaveLength(1);
    expect(mockSession.wwService.sendAudio).toHaveBeenCalledWith(chunk);
  });

  it("should buffer chunks into commandBuffers when active and detect silence", async () => {
    mockSession.isCommandActive = true;
    mockSession.isCapturing = true;
    (vadService.isSpeech as any).mockResolvedValue(0.1); // Silence
    const chunk = Buffer.from([1, 2, 3]);
    
    const commandReadySpy = vi.fn();
    eventBus.on(RockyEvents.COMMAND_READY, commandReadySpy);

    // Feed 31 silent chunks to trigger predictive silence (frames > 20 and buffer > 30)
    for (let i = 0; i < 31; i++) {
      await audioProcessor.handleAudioChunk("test-device", chunk);
    }
    
    expect(mockSession.commandBuffers).toHaveLength(0); // Should be cleared after emit
    expect(commandReadySpy).toHaveBeenCalled();
    expect(mockSession.isCommandActive).toBe(false);
  });

  it("should reset silence frames when speech is detected", async () => {
    mockSession.isCommandActive = true;
    mockSession.isCapturing = true;
    mockSession.silenceFrames = 10;
    (vadService.isSpeech as any).mockResolvedValue(0.9); // Speech
    
    await audioProcessor.handleAudioChunk("test-device", Buffer.from([1, 2]));
    
    expect(mockSession.silenceFrames).toBe(0);
  });
});
