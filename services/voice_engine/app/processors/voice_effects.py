"""Applies alien voice effects to TTS audio via Spotify Pedalboard."""
import numpy as np
import structlog
from pedalboard import Pedalboard, PitchShift, Reverb, Compressor

log = structlog.get_logger()

_BOARDS: dict[str, Pedalboard] = {
    # Raw voice is best for clarity and performance on low-end hardware.
    "neutral": Pedalboard([]), 
    "excited": Pedalboard([Reverb(room_size=0.1)]),
    "tired":   Pedalboard([]),
    "curious": Pedalboard([Reverb(room_size=0.05)]),
    "focused": Pedalboard([]),
}

SAMPLE_RATE = 24000


class VoiceEffectsProcessor:
    """Applies per-emotion pitch shift + reverb to Rocky's TTS PCM output."""

    def __init__(self, emotional_state: str = "neutral", sample_rate: int = SAMPLE_RATE):
        self._state = emotional_state
        self._sample_rate = sample_rate

    def apply(self, audio_bytes: bytes) -> bytes:
        try:
            arr = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
            processed = self.apply_to_float(arr)
            return (np.clip(processed, -1.0, 1.0) * 32768.0).astype(np.int16).tobytes()
        except Exception as e:
            log.warning("voice_effects_failed", error=str(e))
            return audio_bytes

    def apply_to_float(self, audio: np.ndarray) -> np.ndarray:
        """Process float32 numpy array directly."""
        try:
            board = _BOARDS.get(self._state, _BOARDS["neutral"])
            return board(audio, sample_rate=self._sample_rate)
        except Exception as e:
            log.warning("voice_effects_float_failed", error=str(e))
            return audio
