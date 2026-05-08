import pytest
import httpx
from unittest.mock import AsyncMock, patch
from app.main import app as fastapi_app


class TestGetSettings:
    async def test_returns_version(self):
        with patch("app.api.settings_api.get_redis", new_callable=AsyncMock, return_value=None), \
             patch("app.api.settings_api.letta_bridge.is_available", new_callable=AsyncMock, return_value=False), \
             patch("app.api.settings_api.settings") as s:
            s.has_letta = False
            s.ha_mcp_url = ""
            s.has_llm.return_value = True
            s.has_stt.return_value = False
            s.has_tts.return_value = False
            s.has_speaker_id.return_value = False
            s.get_llm_model.return_value = "groq/llama3"
            s.groq_api_key = "sk-test"
            s.gemini_api_key = ""
            s.nvidia_api_key = ""
            s.letta_url = ""
            s.groq_stt_model = "whisper-large-v3"
            s.groq_stt_language = "en"
            s.voice_engine_url = ""

            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/settings")

        assert resp.status_code == 200
        assert resp.json()["version"] == "0.1.0"

    async def test_returns_services_dict(self):
        with patch("app.api.settings_api.get_redis", new_callable=AsyncMock, return_value=None), \
             patch("app.api.settings_api.letta_bridge.is_available", new_callable=AsyncMock, return_value=False), \
             patch("app.api.settings_api.settings") as s:
            s.has_letta = False
            s.ha_mcp_url = ""
            s.has_llm.return_value = True
            s.has_stt.return_value = True
            s.has_tts.return_value = False
            s.has_speaker_id.return_value = False
            s.get_llm_model.return_value = "groq/llama3"
            s.groq_api_key = "sk-test"
            s.gemini_api_key = ""
            s.nvidia_api_key = ""
            s.letta_url = ""
            s.groq_stt_model = "whisper-large-v3"
            s.groq_stt_language = "auto"
            s.voice_engine_url = ""

            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/settings")

        body = resp.json()
        services = body["services"]
        assert "llm" in services
        assert "stt" in services
        assert "tts" in services
        assert "letta" in services
        assert "speaker" in services
        assert "redis" in services
        assert "mcp" in services

    async def test_redis_ok_when_ping_succeeds(self):
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock(return_value=True)

        with patch("app.api.settings_api.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.api.settings_api.letta_bridge.is_available", new_callable=AsyncMock, return_value=False), \
             patch("app.api.settings_api.settings") as s:
            s.has_letta = False
            s.ha_mcp_url = ""
            s.has_llm.return_value = True
            s.has_stt.return_value = False
            s.has_tts.return_value = False
            s.has_speaker_id.return_value = False
            s.get_llm_model.return_value = "groq/llama3"
            s.groq_api_key = "sk-test"
            s.gemini_api_key = ""
            s.nvidia_api_key = ""
            s.letta_url = ""
            s.groq_stt_model = "whisper-large-v3"
            s.groq_stt_language = "en"
            s.voice_engine_url = ""

            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/settings")

        assert resp.json()["services"]["redis"] is True

    async def test_redis_not_ok_when_ping_fails(self):
        mock_redis = AsyncMock()
        mock_redis.ping = AsyncMock(side_effect=Exception("connection refused"))

        with patch("app.api.settings_api.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.api.settings_api.letta_bridge.is_available", new_callable=AsyncMock, return_value=False), \
             patch("app.api.settings_api.settings") as s:
            s.has_letta = False
            s.ha_mcp_url = ""
            s.has_llm.return_value = False
            s.has_stt.return_value = False
            s.has_tts.return_value = False
            s.has_speaker_id.return_value = False
            s.get_llm_model.return_value = None
            s.groq_api_key = ""
            s.gemini_api_key = ""
            s.nvidia_api_key = ""
            s.letta_url = ""
            s.groq_stt_model = "whisper-large-v3"
            s.groq_stt_language = "en"
            s.voice_engine_url = ""

            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/settings")

        assert resp.json()["services"]["redis"] is False

    async def test_letta_ok_when_available(self):
        with patch("app.api.settings_api.get_redis", new_callable=AsyncMock, return_value=None), \
             patch("app.api.settings_api.letta_bridge.is_available",
                   new_callable=AsyncMock, return_value=True), \
             patch("app.api.settings_api.settings") as s:
            s.has_letta = True
            s.ha_mcp_url = ""
            s.has_llm.return_value = True
            s.has_stt.return_value = False
            s.has_tts.return_value = False
            s.has_speaker_id.return_value = False
            s.get_llm_model.return_value = "groq/llama3"
            s.groq_api_key = "sk-test"
            s.gemini_api_key = ""
            s.nvidia_api_key = ""
            s.letta_url = "http://letta:8283"
            s.groq_stt_model = "whisper-large-v3"
            s.groq_stt_language = "en"
            s.voice_engine_url = ""

            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/settings")

        assert resp.json()["services"]["letta"] is True

    async def test_returns_llm_model_info(self):
        with patch("app.api.settings_api.get_redis", new_callable=AsyncMock, return_value=None), \
             patch("app.api.settings_api.letta_bridge.is_available", new_callable=AsyncMock, return_value=False), \
             patch("app.api.settings_api.settings") as s:
            s.has_letta = False
            s.ha_mcp_url = ""
            s.has_llm.return_value = True
            s.has_stt.return_value = False
            s.has_tts.return_value = False
            s.has_speaker_id.return_value = False
            s.get_llm_model.return_value = "groq/llama-3.3-70b-versatile"
            s.groq_api_key = "sk-test"
            s.gemini_api_key = ""
            s.nvidia_api_key = ""
            s.letta_url = ""
            s.groq_stt_model = "whisper-large-v3"
            s.groq_stt_language = "en"
            s.voice_engine_url = ""

            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/settings")

        body = resp.json()
        assert body["llm"]["active_model"] == "groq/llama-3.3-70b-versatile"
        assert body["llm"]["providers"]["groq"] is True

    async def test_returns_voice_config(self):
        with patch("app.api.settings_api.get_redis", new_callable=AsyncMock, return_value=None), \
             patch("app.api.settings_api.letta_bridge.is_available", new_callable=AsyncMock, return_value=False), \
             patch("app.api.settings_api.settings") as s:
            s.has_letta = False
            s.ha_mcp_url = ""
            s.has_llm.return_value = False
            s.has_stt.return_value = False
            s.has_tts.return_value = True
            s.has_speaker_id.return_value = False
            s.get_llm_model.return_value = None
            s.groq_api_key = ""
            s.gemini_api_key = ""
            s.nvidia_api_key = ""
            s.letta_url = ""
            s.groq_stt_model = "whisper-large-v3"
            s.groq_stt_language = "pt"
            s.voice_engine_url = "http://voice:8881"

            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/settings")

        voice = resp.json()["voice"]
        assert voice["stt_model"] == "whisper-large-v3"
        assert voice["stt_language"] == "pt"
        assert voice["tts_url"] == "http://voice:8881"
