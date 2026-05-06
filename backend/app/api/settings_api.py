from fastapi import APIRouter

from ..config import settings
from ..bridges import letta_bridge
from ..core.redis_client import get_redis
import httpx

router = APIRouter()


@router.get("")
async def get_settings():
    """Return non-sensitive runtime config and service availability."""
    redis = await get_redis()
    redis_ok = False
    if redis is not None:
        try:
            redis_ok = await redis.ping()
        except Exception:
            redis_ok = False
    letta_ok = settings.has_letta and await letta_bridge.is_available()
    
    mcp_ok = False
    if settings.ha_mcp_url:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                r = await client.get(f"{settings.ha_mcp_url.rstrip('/')}/tools")
                mcp_ok = r.status_code == 200
        except Exception:
            mcp_ok = False

    return {
        "version": "0.1.0",
        "services": {
            "llm":     settings.has_llm(),
            "stt":     settings.has_stt(),
            "tts":     settings.has_tts(),
            "letta":   letta_ok,
            "speaker": settings.has_speaker_id(),
            "redis":   redis_ok,
            "mcp":     mcp_ok,
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
