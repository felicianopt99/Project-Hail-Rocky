"""TTS synthesis — routes through the consolidated Voice Engine."""
from typing import AsyncGenerator
import httpx
import structlog

from ..config import settings

log = structlog.get_logger()

SAMPLE_RATE = 24000  # voice engine output rate

# Singleton client — reused across requests to avoid connection overhead
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


async def synthesize_chunks(text: str, emotional_state: str = "neutral") -> AsyncGenerator[bytes, None]:
    if not text.strip() or not settings.voice_engine_url:
        return

    client = _get_client()

    try:
        # Voice Engine path: handles synthesis + effects in one call
        async with client.stream(
            "POST",
            f"{settings.voice_engine_url}/synthesize",
            json={"text": text, "emotional_state": emotional_state},
        ) as resp:
            resp.raise_for_status()
            async for chunk in resp.aiter_bytes(chunk_size=4096):
                if chunk:
                    yield chunk
    except Exception as e:
        log.error("tts_error", error=str(e), text=text[:50], via="voice_engine")
