import pytest
import numpy as np
from unittest.mock import AsyncMock, MagicMock, patch
from app.voice.stt import _is_encoded_audio, transcribe


class TestIsEncodedAudio:
    def test_webm_detected(self):
        data = b'\x1a\x45\xdf\xa3' + b'\x00' * 100
        ok, mime = _is_encoded_audio(data)
        assert ok is True
        assert mime == "audio/webm"

    def test_ogg_detected(self):
        data = b'OggS' + b'\x00' * 100
        ok, mime = _is_encoded_audio(data)
        assert ok is True
        assert mime == "audio/ogg"

    def test_mp4_detected(self):
        data = b'\x00\x00\x00\x00ftyp' + b'\x00' * 100
        ok, mime = _is_encoded_audio(data)
        assert ok is True
        assert mime == "audio/mp4"

    def test_raw_pcm_not_detected(self):
        data = b'\x00\x01\x02\x03' * 100
        ok, mime = _is_encoded_audio(data)
        assert ok is False
        assert mime == ""

    def test_short_data_does_not_crash(self):
        ok, mime = _is_encoded_audio(b'\x00\x01')
        assert isinstance(ok, bool)


class TestTranscribe:
    async def test_raises_when_no_groq_key(self):
        with patch("app.voice.stt.settings") as s:
            s.groq_api_key = ""
            with pytest.raises(RuntimeError, match="GROQ_API_KEY"):
                await transcribe(b'\x00' * 1000)

    async def test_returns_empty_on_silence_pcm(self):
        silence = np.zeros(16000, dtype=np.int16).tobytes()
        with patch("app.voice.stt.settings") as s:
            s.groq_api_key = "sk-test"
            s.groq_stt_language = "en"
            result = await transcribe(silence)
        assert result == ""

    async def test_sends_encoded_audio_directly(self):
        webm_data = b'\x1a\x45\xdf\xa3' + b'\x00' * 500
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"text": "hello rocky"}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)

        with patch("app.voice.stt.settings") as s, \
             patch("app.voice.stt._get_client", return_value=mock_client):
            s.groq_api_key = "sk-test"
            s.groq_stt_language = "en"
            result = await transcribe(webm_data)
        assert result == "hello rocky"

    async def test_filters_known_hallucinations(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"text": "thank you."}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)

        pcm = (np.ones(16000, dtype=np.int16) * 1000).tobytes()
        with patch("app.voice.stt.settings") as s, \
             patch("app.voice.stt._get_client", return_value=mock_client):
            s.groq_api_key = "sk-test"
            s.groq_stt_language = "en"
            result = await transcribe(pcm)
        assert result == ""

    async def test_filters_very_short_transcription(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"text": "h"}  # 1 char
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)

        pcm = (np.ones(16000, dtype=np.int16) * 1000).tobytes()
        with patch("app.voice.stt.settings") as s, \
             patch("app.voice.stt._get_client", return_value=mock_client):
            s.groq_api_key = "sk-test"
            s.groq_stt_language = "en"
            result = await transcribe(pcm)
        assert result == ""

    async def test_returns_empty_on_api_error(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = "Internal Server Error"
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)

        pcm = (np.ones(16000, dtype=np.int16) * 1000).tobytes()
        with patch("app.voice.stt.settings") as s, \
             patch("app.voice.stt._get_client", return_value=mock_client):
            s.groq_api_key = "sk-test"
            s.groq_stt_language = "en"
            result = await transcribe(pcm)
        assert result == ""

    async def test_auto_language_omits_language_param(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"text": "hello"}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)

        pcm = (np.ones(16000, dtype=np.int16) * 1000).tobytes()
        with patch("app.voice.stt.settings") as s, \
             patch("app.voice.stt._get_client", return_value=mock_client):
            s.groq_api_key = "sk-test"
            s.groq_stt_language = "auto"
            await transcribe(pcm)

        data_sent = mock_client.post.call_args[1]["data"]
        assert "language" not in data_sent

    async def test_explicit_language_override(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"text": "olá"}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)

        pcm = (np.ones(16000, dtype=np.int16) * 1000).tobytes()
        with patch("app.voice.stt.settings") as s, \
             patch("app.voice.stt._get_client", return_value=mock_client):
            s.groq_api_key = "sk-test"
            s.groq_stt_language = "en"
            result = await transcribe(pcm, language="pt")

        data_sent = mock_client.post.call_args[1]["data"]
        assert data_sent["language"] == "pt"
        assert result == "olá"
