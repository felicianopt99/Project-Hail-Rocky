"""
Azure Speaker Recognition bridge.

Token-saving strategy:
  - Each Socket.io session (sid) is cached in Redis for 30 minutes.
  - Azure is called at most ONCE per session, not per utterance.
  - If the user is idle > 30 min the cache expires → identifies again on next utterance.

Audio format:
  - Azure requires WAV (PCM 16-bit mono). We build the header from raw PCM.
  - WebM blobs (MediaRecorder path) skip identification (no conversion library needed).

Storage:
  - Profile → name mapping: Redis key rocky:speaker:profiles (JSON dict)
  - Session cache: rocky:speaker:session:{sid} → speaker name (30 min TTL)
"""
import json
import struct
import structlog
import httpx

from ..config import settings
from ..core.redis_client import get_redis

log = structlog.get_logger()

_UTTERANCE_TTL = 45    # seconds — re-identify after 45s of silence
_MIN_AUDIO_BYTES = 32000  # ~1 second of 16kHz 16-bit mono — skip shorter clips


def _base_url() -> str:
    return f"https://{settings.azure_speaker_region}.api.cognitive.microsoft.com"


def _headers() -> dict:
    return {"Ocp-Apim-Subscription-Key": settings.azure_speaker_key}


def _pcm_to_wav(pcm: bytes, sample_rate: int = 16000) -> bytes:
    """Wrap raw PCM bytes in a minimal WAV header. Zero dependencies."""
    channels, bit_depth = 1, 16
    data_len = len(pcm)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + data_len, b"WAVE",
        b"fmt ", 16, 1, channels, sample_rate,
        sample_rate * channels * (bit_depth // 8),
        channels * (bit_depth // 8), bit_depth,
        b"data", data_len,
    )
    return header + pcm


# ── Profile registry (Redis) ──────────────────────────────────────────────

async def _load_profiles() -> dict[str, str]:
    """Return {azure_profile_id: display_name}."""
    redis = await get_redis()
    if not redis:
        return {}
    raw = await redis.get("rocky:speaker:profiles")
    return json.loads(raw) if raw else {}


async def _save_profiles(profiles: dict[str, str]) -> None:
    redis = await get_redis()
    if redis:
        await redis.set("rocky:speaker:profiles", json.dumps(profiles))


async def _profile_name(profile_id: str) -> str:
    profiles = await _load_profiles()
    return profiles.get(profile_id, "unknown")


# ── Session cache ──────────────────────────────────────────────────────────

async def _get_cached(sid: str) -> str | None:
    redis = await get_redis()
    if not redis:
        return None
    return await redis.get(f"rocky:speaker:session:{sid}")


async def _set_cached(sid: str, name: str) -> None:
    redis = await get_redis()
    if redis:
        await redis.setex(f"rocky:speaker:session:{sid}", _UTTERANCE_TTL, name)


async def clear_session(sid: str) -> None:
    redis = await get_redis()
    if redis:
        await redis.delete(f"rocky:speaker:session:{sid}")


# ── Azure API ─────────────────────────────────────────────────────────────

async def create_profile(name: str) -> str | None:
    """Create a new identification profile and store name mapping."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.post(
                f"{_base_url()}/speaker/identification/v2.0/text-independent/profiles",
                headers={**_headers(), "Content-Type": "application/json"},
                json={"locale": "pt-pt"},
            )
            r.raise_for_status()
            profile_id = r.json()["profileId"]
        profiles = await _load_profiles()
        profiles[profile_id] = name
        await _save_profiles(profiles)
        log.info("speaker_profile_created", profile_id=profile_id, name=name)
        return profile_id
    except Exception as e:
        log.error("speaker_create_failed", error=str(e))
        return None


async def enroll(profile_id: str, pcm_audio: bytes) -> dict:
    """
    Enroll PCM audio for a profile.
    Returns {'status': 'Enrolled'|'Enrolling', 'remaining_seconds': float}.
    Azure needs ~20 total seconds of speech across one or more enrollments.
    """
    wav = _pcm_to_wav(pcm_audio)
    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(
                f"{_base_url()}/speaker/identification/v2.0/text-independent/profiles/{profile_id}/enrollments",
                headers={**_headers(), "Content-Type": "audio/wav"},
                content=wav,
            )
            r.raise_for_status()
            data = r.json()
            return {
                "status": data.get("enrollmentStatus", "unknown"),
                "remaining_seconds": data.get("remainingEnrollmentsSpeechLength", 0),
            }
    except Exception as e:
        log.error("speaker_enroll_failed", error=str(e))
        return {"status": "error", "error": str(e)}


async def identify(pcm_audio: bytes, sid: str) -> dict | None:
    """
    Identify speaker from PCM audio.

    Returns:
      {"name": str, "changed": bool}  — speaker identified
      None                            — unknown / too short / no profiles

    Cache logic (45s TTL):
    - Cache hit → return immediately (0 Azure calls)
    - Cache miss OR cache expired → call Azure
    - If result differs from previous speaker → "changed": True
    """
    # 1. Cache hit — same person still talking
    cached = await _get_cached(sid)

    # 2. Audio too short to be reliable
    if len(pcm_audio) < _MIN_AUDIO_BYTES:
        if cached:
            return {"name": cached, "changed": False}
        return None

    # 3. No profiles or no key → nothing to do
    profiles = await _load_profiles()
    if not profiles or not settings.has_speaker_id():
        if cached:
            return {"name": cached, "changed": False}
        return None

    # 4. Call Azure
    profile_ids = ",".join(profiles.keys())
    wav = _pcm_to_wav(pcm_audio)

    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                f"{_base_url()}/speaker/identification/v2.0/text-independent/profiles/identify"
                f"?profileIds={profile_ids}",
                headers={**_headers(), "Content-Type": "audio/wav"},
                content=wav,
            )
            r.raise_for_status()
            data = r.json()

        identified = data.get("identifiedProfile", {})
        profile_id = identified.get("profileId")
        score = float(identified.get("score", 0))

        if not profile_id or score < 0.5:
            log.debug("speaker_unrecognised", score=score, cached=cached)
            # Low confidence — keep cached if exists, else unknown
            if cached:
                return {"name": cached, "changed": False}
            return None

        name = profiles.get(profile_id, "unknown")
        changed = cached is not None and cached != name
        await _set_cached(sid, name)
        log.info("speaker_identified", name=name, score=round(score, 2), changed=changed)
        return {"name": name, "changed": changed}

    except Exception as e:
        log.warning("speaker_identify_failed", error=str(e))
        if cached:
            return {"name": cached, "changed": False}
        return None


async def list_profiles() -> list[dict]:
    profiles = await _load_profiles()
    return [{"profile_id": pid, "name": name} for pid, name in profiles.items()]


async def delete_profile(profile_id: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.delete(
                f"{_base_url()}/speaker/identification/v2.0/text-independent/profiles/{profile_id}",
                headers=_headers(),
            )
            r.raise_for_status()
        profiles = await _load_profiles()
        profiles.pop(profile_id, None)
        await _save_profiles(profiles)
        return True
    except Exception as e:
        log.error("speaker_delete_failed", error=str(e))
        return False
