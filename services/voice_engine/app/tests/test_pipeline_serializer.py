"""
Tests for RawAudioSerializer — the fix for pipecat 1.1.0 requiring an explicit
serializer. Without this serializer, _receive_messages() skips ALL messages
(including audio) with a bare `continue`, so zero audio ever enters the pipeline.
"""
import pytest
import numpy as np
from pipecat.frames.frames import (
    CancelFrame,
    InputAudioRawFrame,
    InputTransportMessageFrame,
    UserStoppedSpeakingFrame,
)

from app.processors.raw_audio_serializer import RawAudioSerializer, SAMPLE_RATE


@pytest.fixture
def serializer():
    return RawAudioSerializer()


# ── deserialize: binary audio ─────────────────────────────────────────────────

class TestDeserializeAudio:
    @pytest.mark.asyncio
    async def test_bytes_become_input_audio_frame(self, serializer):
        pcm = np.zeros(320, dtype=np.int16).tobytes()  # 20ms at 16kHz
        frame = await serializer.deserialize(pcm)
        assert isinstance(frame, InputAudioRawFrame)

    @pytest.mark.asyncio
    async def test_sample_rate_is_16k(self, serializer):
        pcm = np.zeros(320, dtype=np.int16).tobytes()
        frame = await serializer.deserialize(pcm)
        assert frame.sample_rate == SAMPLE_RATE

    @pytest.mark.asyncio
    async def test_num_channels_is_mono(self, serializer):
        pcm = np.zeros(320, dtype=np.int16).tobytes()
        frame = await serializer.deserialize(pcm)
        assert frame.num_channels == 1

    @pytest.mark.asyncio
    async def test_num_frames_computed_from_audio_length(self, serializer):
        """num_frames is auto-computed by pipecat: bytes // 2 (int16)."""
        samples = 480
        pcm = np.zeros(samples, dtype=np.int16).tobytes()
        frame = await serializer.deserialize(pcm)
        assert frame.num_frames == samples

    @pytest.mark.asyncio
    async def test_audio_payload_preserved(self, serializer):
        pcm = np.arange(160, dtype=np.int16).tobytes()
        frame = await serializer.deserialize(pcm)
        assert frame.audio == pcm

    @pytest.mark.asyncio
    async def test_empty_bytes_returns_none(self, serializer):
        frame = await serializer.deserialize(b"")
        assert frame is None


# ── deserialize: JSON control messages ───────────────────────────────────────

class TestDeserializeControl:
    @pytest.mark.asyncio
    async def test_cancel_json_becomes_cancel_frame(self, serializer):
        frame = await serializer.deserialize('{"type": "cancel"}')
        assert isinstance(frame, CancelFrame)

    @pytest.mark.asyncio
    async def test_eot_json_becomes_user_stopped_speaking(self, serializer):
        frame = await serializer.deserialize('{"type": "end_of_turn"}')
        assert isinstance(frame, UserStoppedSpeakingFrame)

    @pytest.mark.asyncio
    async def test_unknown_json_becomes_transport_message(self, serializer):
        frame = await serializer.deserialize('{"type": "ping", "data": 42}')
        assert isinstance(frame, InputTransportMessageFrame)

    @pytest.mark.asyncio
    async def test_invalid_json_returns_none(self, serializer):
        frame = await serializer.deserialize("not json {{")
        assert frame is None

    @pytest.mark.asyncio
    async def test_empty_string_returns_none(self, serializer):
        frame = await serializer.deserialize("")
        assert frame is None


# ── serialize: outbound audio ─────────────────────────────────────────────────

class TestSerialize:
    @pytest.mark.asyncio
    async def test_audio_raw_frame_serialized_to_bytes(self, serializer):
        from pipecat.frames.frames import AudioRawFrame
        pcm = b"\x01\x02" * 160
        frame = AudioRawFrame(audio=pcm, sample_rate=SAMPLE_RATE, num_channels=1)
        result = await serializer.serialize(frame)
        assert result == pcm

    @pytest.mark.asyncio
    async def test_non_audio_frame_returns_none(self, serializer):
        from pipecat.frames.frames import TextFrame
        result = await serializer.serialize(TextFrame(text="hello"))
        assert result is None
