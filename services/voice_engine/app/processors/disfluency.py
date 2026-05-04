import random
import structlog
from pipecat.frames.frames import TextFrame, Frame
from pipecat.processors.frame_processor import FrameProcessor

log = structlog.get_logger()

_DISFLUENCIES = ["Hmm. ", "Rocky think. ", "Interesting. ", "Let Rocky consider. "]


class DisfluencyInjector(FrameProcessor):
    """Occasionally prepends a disfluency to longer responses."""

    def __init__(self, probability: float = 0.25, min_length: int = 80):
        super().__init__()
        self._prob = probability
        self._min_len = min_length

    async def process_frame(self, frame: Frame, direction):
        await super().process_frame(frame, direction)

        if isinstance(frame, TextFrame):
            text = frame.text
            if len(text) >= self._min_len and random.random() < self._prob:
                text = random.choice(_DISFLUENCIES) + text
            await self.push_frame(TextFrame(text=text))
        else:
            await self.push_frame(frame)
