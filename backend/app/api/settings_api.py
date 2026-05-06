from fastapi import APIRouter

from ..config import settings
from ..bridges import letta_bridge
from ..core.redis_client import get_redis

router = APIRouter()


@router.get("")
async def get_settings():
    """Return non-sensitive runtime config and service availability."""
    redis = await get_redis()
    redis_ok = redis is not None
    letta_ok = settings.has_letta and await letta_bridge.is_available()

    return {
        "version": "0.1.0",
        "services": {
            "llm":     settings.has_llm(),
            "stt":     settings.has_stt(),
            "tts":     settings.has_tts(),
            "letta":   letta_ok,
            "speaker": settings.has_speaker_id(),
            "redis":   redis_ok,
        },
        "llm": {
            "active_model": settings.get_llm_model() or None,
            "providers": {
                "groq":   bool(settings.groq_api_key),
                "gemini": bool(settings.gemini_api_key),
                "nvidia": bool(settings.nvidia_api_key),
            },
            "letta_url": settings.letta_url or None,
        },
        "voice": {
            "stt_model":    settings.groq_stt_model,
            "stt_language": settings.groq_stt_language or "auto",
            "tts_url":      settings.voice_engine_url or None,
        },
    }
