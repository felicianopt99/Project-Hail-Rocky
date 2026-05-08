import pytest
from unittest.mock import AsyncMock, MagicMock, patch


async def test_synthesize_yields_nothing_on_empty_text():
    from app.voice.tts import synthesize_chunks
    chunks = [c async for c in synthesize_chunks("", "neutral")]
    assert chunks == []


async def test_synthesize_yields_nothing_on_whitespace():
    from app.voice.tts import synthesize_chunks
    chunks = [c async for c in synthesize_chunks("   ", "neutral")]
    assert chunks == []


async def test_synthesize_yields_nothing_when_no_voice_engine():
    from app.voice.tts import synthesize_chunks
    with patch("app.voice.tts.settings") as s:
        s.voice_engine_url = ""
        chunks = [c async for c in synthesize_chunks("hello", "neutral")]
    assert chunks == []


async def test_synthesize_yields_audio_chunks():
    from app.voice.tts import synthesize_chunks

    async def mock_aiter_bytes(chunk_size):
        yield b'chunk1'
        yield b'chunk2'

    mock_resp = AsyncMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.aiter_bytes = mock_aiter_bytes

    mock_stream_cm = AsyncMock()
    mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_stream_cm.__aexit__ = AsyncMock(return_value=None)

    mock_client = MagicMock()
    mock_client.stream.return_value = mock_stream_cm

    with patch("app.voice.tts.settings") as s, \
         patch("app.voice.tts._get_client", return_value=mock_client):
        s.voice_engine_url = "http://voice:8881"
        chunks = [c async for c in synthesize_chunks("hello", "neutral")]

    assert chunks == [b'chunk1', b'chunk2']


async def test_synthesize_skips_empty_chunks():
    from app.voice.tts import synthesize_chunks

    async def mock_aiter_bytes(chunk_size):
        yield b'data'
        yield b''  # empty chunk should be skipped
        yield b'more'

    mock_resp = AsyncMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.aiter_bytes = mock_aiter_bytes

    mock_stream_cm = AsyncMock()
    mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_stream_cm.__aexit__ = AsyncMock(return_value=None)

    mock_client = MagicMock()
    mock_client.stream.return_value = mock_stream_cm

    with patch("app.voice.tts.settings") as s, \
         patch("app.voice.tts._get_client", return_value=mock_client):
        s.voice_engine_url = "http://voice:8881"
        chunks = [c async for c in synthesize_chunks("hello", "excited")]

    assert chunks == [b'data', b'more']


async def test_synthesize_handles_exception_gracefully():
    from app.voice.tts import synthesize_chunks

    mock_client = MagicMock()
    mock_client.stream.side_effect = Exception("connection refused")

    with patch("app.voice.tts.settings") as s, \
         patch("app.voice.tts._get_client", return_value=mock_client):
        s.voice_engine_url = "http://voice:8881"
        chunks = [c async for c in synthesize_chunks("hello", "neutral")]

    assert chunks == []


async def test_synthesize_passes_emotional_state():
    from app.voice.tts import synthesize_chunks

    async def mock_aiter_bytes(chunk_size):
        return
        yield  # make it an async generator

    mock_resp = AsyncMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.aiter_bytes = mock_aiter_bytes

    mock_stream_cm = AsyncMock()
    mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_stream_cm.__aexit__ = AsyncMock(return_value=None)

    mock_client = MagicMock()
    mock_client.stream.return_value = mock_stream_cm

    with patch("app.voice.tts.settings") as s, \
         patch("app.voice.tts._get_client", return_value=mock_client):
        s.voice_engine_url = "http://voice:8881"
        _ = [c async for c in synthesize_chunks("hello", "excited")]

    call_kwargs = mock_client.stream.call_args
    json_body = call_kwargs[1]["json"]
    assert json_body["emotional_state"] == "excited"
    assert json_body["text"] == "hello"
