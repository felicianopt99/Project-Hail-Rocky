import time
from datetime import datetime

import litellm
import structlog

from ...config import settings

log = structlog.get_logger()

STATES = ["neutral", "curious", "tired", "excited", "focused", "playful"]

# ── Keyword fallback sets (used when LLM is unavailable) ─────────────────────
_CURIOUS = {"why", "how", "what", "when", "where", "wonder",
            "porquê", "como", "quando", "onde", "curioso",
            "pourquoi", "comment", "quand", "où"}
_EXCITED = {"amazing", "wow", "great", "awesome", "fantastic", "perfect", "brilliant",
            "incrível", "fantástico", "perfeito", "ótimo", "excelente",
            "incroyable", "fantastique", "parfait", "super"}
_TECH = {"code", "python", "javascript", "typescript", "debug", "error", "function",
         "class", "bug", "api", "database", "server", "docker", "git", "bash",
         "código", "depurar", "erro", "função", "servidor",
         "déboguer", "erreur", "fonction", "serveur"}

# ── In-process LRU-style cache: {cache_key: (state, timestamp)} ──────────────
_CACHE_MAX = 50
_CACHE_TTL = 300  # 5 minutes in seconds
_cache: dict[tuple[str, str], tuple[str, float]] = {}


def _cache_get(key: tuple[str, str]) -> str | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    state, ts = entry
    if time.monotonic() - ts > _CACHE_TTL:
        _cache.pop(key, None)
        return None
    return state


def _cache_set(key: tuple[str, str], state: str) -> None:
    # Evict oldest entry when at capacity
    if len(_cache) >= _CACHE_MAX and key not in _cache:
        oldest_key = min(_cache, key=lambda k: _cache[k][1])
        _cache.pop(oldest_key, None)
    _cache[key] = (state, time.monotonic())


# ── Keyword-based fallback ────────────────────────────────────────────────────
def _keyword_detect(message: str, current: str = "neutral") -> str:
    lower = message.lower()
    words = set(lower.split())
    if words & _TECH:
        return "focused"
    if words & _EXCITED:
        return "excited"
    if words & _CURIOUS or message.count("?") >= 1:
        return "curious"
    return current


# ── Primary async detect via LLM ─────────────────────────────────────────────
_SYSTEM_PROMPT = (
    "You detect the emotional tone of a message and pick the single best-fit state "
    "from this list: neutral, curious, tired, excited, focused, playful.\n"
    "Rules:\n"
    "- Reply with EXACTLY one word from the list above — no punctuation, no explanation.\n"
    "- Choose 'curious' for questions or wondering statements.\n"
    "- Choose 'excited' for enthusiastic, positive, or celebratory messages.\n"
    "- Choose 'focused' for technical, analytical, or task-oriented messages.\n"
    "- Choose 'playful' for jokes, teasing, or light-hearted banter.\n"
    "- Choose 'tired' only if explicitly expressed fatigue or exhaustion is present.\n"
    "- Default to 'neutral' when the tone is unclear."
)


async def detect(message: str, current: str = "neutral") -> str:
    # Time-of-day gate: always tired late at night / early morning
    hour = datetime.now().hour
    if hour >= 22 or hour < 6:
        return "tired"

    cache_key = (message[:100], current)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    model = settings.get_llm_model() or "groq/llama-3.1-8b-instant"

    try:
        response = await litellm.acompletion(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": message[:500]},
            ],
            max_tokens=5,
            temperature=0.0,
        )
        raw = response.choices[0].message.content or ""
        state = raw.strip().lower().split()[0] if raw.strip() else ""
        if state not in STATES:
            log.warning("emotional_state_llm_invalid", raw=raw, fallback="keyword")
            state = _keyword_detect(message, current)
    except Exception as exc:
        log.warning("emotional_state_llm_error", error=str(exc), fallback="keyword")
        state = _keyword_detect(message, current)

    _cache_set(cache_key, state)
    return state


# ── Redis persistence helpers (unchanged) ────────────────────────────────────
async def load(sid: str, redis=None) -> str:
    if redis is None:
        return "neutral"
    try:
        val = await redis.get(f"rocky:state:{sid}")
        return val if val in STATES else "neutral"
    except Exception:
        return "neutral"


async def save(sid: str, state: str, redis=None, ttl: int = 1800) -> None:
    if redis is None or state not in STATES:
        return
    try:
        await redis.setex(f"rocky:state:{sid}", ttl, state)
    except Exception:
        pass
