"""Applies alien voice effects to TTS audio via Spotify Pedalboard."""
import numpy as np
import structlog
from pedalboard import Pedalboard, PitchShift, Reverb, Compressor

log = structlog.get_logger()

# Boards are now created per-session to maintain state (Reverb tails, etc.)
def get_pedalboard(state: str) -> Pedalboard:
    if state == "excited":
        return Pedalboard([Reverb(room_size=0.1)])
    if state == "curious":
        return Pedalboard([Reverb(room_size=0.05)])
    return Pedalboard([])

SAMPLE_RATE = 24000


class VoiceEffectsProcessor:
    """Applies per-emotion pitch shift + reverb to Rocky's TTS PCM output."""

    def __init__(self, emotional_state: str = "neutral", sample_rate: int = SAMPLE_RATE):
        self._state = emotional_state
        self._sample_rate = sample_rate
        # We MUST keep a persistent board instance to maintain state (reset=False)
        self._board = get_pedalboard(emotional_state)

    def apply(self, audio_bytes: bytes) -> bytes:
        try:
            arr = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            processed = self.apply_to_float(arr)
            return (np.clip(processed, -1.0, 1.0) * 32768.0).astype(np.int16).tobytes()
        except Exception as e:
            log.warning("voice_effects_failed", error=str(e))
            return audio_bytes

    def apply_to_float(self, audio: np.ndarray) -> np.ndarray:
        """Process float32 numpy array directly, maintaining state."""
        try:
            # reset=False is critical for streaming audio to avoid "pulses" or clips at frame boundaries
            return self._board.process(audio, sample_rate=self._sample_rate, reset=False)
        except Exception as e:
            log.warning("voice_effects_float_failed", error=str(e))
            return audio
