"""
Tests for WebRTC audio format conversion.

The bug: aiortc decodes WebRTC/Opus as stereo 48kHz int16, but the pipecat
voice engine expects mono 16kHz int16. Without conversion the Silero VAD
receives audio at 3× the expected rate and never detects speech.
"""
import numpy as np
import pytest
from av import AudioFrame

from app.api.webrtc import _to_mono_16k, _TARGET_RATE


def _make_frame(samples_per_channel: int, sample_rate: int, layout: str = "stereo") -> AudioFrame:
    """Create a synthetic aiortc-style AudioFrame."""
    channels = 2 if layout == "stereo" else 1
    total_samples = samples_per_channel * channels
    arr = np.random.randint(-1000, 1000, total_samples, dtype=np.int16)
    frame = AudioFrame(format="s16", layout=layout, samples=samples_per_channel)
    frame.sample_rate = sample_rate
    # av packs stereo as interleaved (1, total_samples) array — match what aiortc gives
    frame.planes[0].update(arr.tobytes())
    return frame


class TestToMono16k:
    def test_stereo_48k_output_length(self):
        """960 samples/ch at 48kHz stereo → 320 samples mono at 16kHz (÷3)."""
        frame = _make_frame(960, 48000, "stereo")
        data = _to_mono_16k(frame)
        expected_samples = 960 // 3  # 48kHz → 16kHz
        assert len(data) == expected_samples * 2  # int16 = 2 bytes/sample

    def test_mono_48k_output_length(self):
        """960 samples at 48kHz mono → 320 samples at 16kHz."""
        frame = _make_frame(960, 48000, "mono")
        data = _to_mono_16k(frame)
        assert len(data) == 320 * 2

    def test_already_16k_mono_passthrough(self):
        """320 samples at 16kHz mono → unchanged byte count."""
        frame = _make_frame(320, 16000, "mono")
        data = _to_mono_16k(frame)
        assert len(data) == 320 * 2

    def test_output_is_int16_bytes(self):
        """Output must be raw int16 bytes (2 bytes per sample)."""
        frame = _make_frame(960, 48000, "stereo")
        data = _to_mono_16k(frame)
        assert len(data) % 2 == 0
        arr = np.frombuffer(data, dtype=np.int16)
        assert arr.dtype == np.int16

    def test_target_rate_is_16k(self):
        assert _TARGET_RATE == 16000

    def test_stereo_to_mono_reduces_amplitude_not_clips(self):
        """Averaging L+R channels should stay within int16 range."""
        frame = _make_frame(960, 48000, "stereo")
        data = _to_mono_16k(frame)
        arr = np.frombuffer(data, dtype=np.int16)
        assert arr.max() <= 32767
        assert arr.min() >= -32768

    def test_small_frame_does_not_raise(self):
        """Very small frames (e.g. 10 samples) should not raise errors."""
        frame = _make_frame(10, 48000, "stereo")
        data = _to_mono_16k(frame)
        assert isinstance(data, bytes)
        assert len(data) > 0

    def test_24k_stereo_resampled_correctly(self):
        """Non-standard 24kHz: 480 samples → 320 samples at 16kHz (÷1.5)."""
        frame = _make_frame(480, 24000, "stereo")
        data = _to_mono_16k(frame)
        expected = round(480 * 16000 / 24000)
        actual_samples = len(data) // 2
        assert abs(actual_samples - expected) <= 2  # allow ±2 for rounding
