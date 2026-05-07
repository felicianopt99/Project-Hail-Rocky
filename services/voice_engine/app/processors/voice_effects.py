"""Applies alien voice effects to TTS audio via Spotify Pedalboard."""
import numpy as np
import structlog
from pedalboard import Chorus, Compressor, Pedalboard, PitchShift, Reverb

log = structlog.get_logger()

# Boards are created per-session to maintain state (Reverb tails, Chorus LFO phase, etc.)
def get_pedalboard(state: str) -> Pedalboard:
    """Return a Pedalboard tuned for Rocky's Eridanian voice in the given emotional state.

    Design notes:
    - PitchShift always comes first so downstream effects work on the shifted timbre.
    - reset=False is used at call-time (not here) to preserve tail state across frames.
    - All room_size / wet_level values are kept subtle so the voice stays intelligible.
    """
    if state == "neutral":
        # Alien baseline: barely perceptible pitch lift + whisper of space
        return Pedalboard([
            PitchShift(semitones=1.5),
            Reverb(room_size=0.15, wet_level=0.12, dry_level=0.88),
        ])
    if state == "curious":
        # Higher pitch, a touch more room — Rocky tilts its head
        return Pedalboard([
            PitchShift(semitones=2.5),
            Reverb(room_size=0.25, wet_level=0.18, dry_level=0.82),
        ])
    if state == "excited":
        # Bright and energetic: biggest pitch lift, open reverb, light compression
        return Pedalboard([
            PitchShift(semitones=3.5),
            Reverb(room_size=0.3, wet_level=0.2, dry_level=0.8),
            Compressor(threshold_db=-18, ratio=3.0, attack_ms=5.0, release_ms=80.0),
        ])
    if state == "tired":
        # Low, slow, heavy — pitch dropped into weary register
        return Pedalboard([
            PitchShift(semitones=-1.5),
            Reverb(room_size=0.5, damping=0.6, wet_level=0.25, dry_level=0.75),
        ])
    if state == "focused":
        # Sharp and punchy: modest pitch lift, strong compression, no reverb blur
        return Pedalboard([
            PitchShift(semitones=1.0),
            Compressor(threshold_db=-20, ratio=4.0, attack_ms=3.0, release_ms=60.0),
        ])
    if state == "playful":
        # Musical shimmer: medium pitch + warm room + gentle chorus flutter
        return Pedalboard([
            PitchShift(semitones=2.0),
            Reverb(room_size=0.2, wet_level=0.15, dry_level=0.85),
            Chorus(rate_hz=0.5, depth=0.1, mix=0.3),
        ])
    # Fallback for any unknown state — same as neutral
    log.warning("voice_effects_unknown_state", state=state, fallback="neutral")
    return Pedalboard([
        PitchShift(semitones=1.5),
        Reverb(room_size=0.15, wet_level=0.12, dry_level=0.88),
    ])

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
            result = self._board.process(audio, sample_rate=self._sample_rate, reset=False)
            return np.clip(result, -1.0, 1.0)
        except Exception as e:
            log.warning("voice_effects_float_failed", error=str(e))
            return audio
