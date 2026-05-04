import httpx
import structlog
from pipecat.frames.frames import Frame, TextFrame, TranscriptionFrame
from pipecat.processors.frame_processor import FrameProcessor

log = structlog.get_logger()

class RockyBrainProcessor(FrameProcessor):
    """
    Pipecat Processor that bridges to the Backend's brain (Letta + Tools).
    It receives a TranscriptionFrame (from STT) and emits TextFrames (to TTS).
    """

    def __init__(self, sid: str, backend_url: str = "http://127.0.0.1:8000"):
        super().__init__()
        self._sid = sid
        self._backend_url = backend_url
        self._client = httpx.AsyncClient(timeout=60.0)

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            log.info("brain_received_transcription", text=frame.text)
            
            try:
                # Call the backend chat endpoint
                async with self._client.stream(
                    "POST",
                    f"{self._backend_url}/api/brain/chat",
                    json={"sid": self._sid, "content": frame.text}
                ) as resp:
                    resp.raise_for_status()
                    async for chunk in resp.aiter_text():
                        if chunk:
                            await self.push_frame(TextFrame(text=chunk))
            except Exception as e:
                log.error("brain_error", error=str(e))
                await self.push_frame(TextFrame(text="Rocky brain hurt. Sorry."))
        else:
            await self.push_frame(frame)

    async def cleanup(self):
        await self._client.aclose()
