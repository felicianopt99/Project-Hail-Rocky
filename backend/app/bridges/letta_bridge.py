"""
Bridge between Rocky backend and Letta memory server.

Uses Letta REST API directly (no SDK dependency).
Gracefully falls back to None when Letta is unavailable.
"""
import httpx
import structlog

from ..config import settings
from ..rocky.letta_config import (
    ROCKY_AGENT_NAME, INITIAL_HUMAN_BLOCK, ROCKY_PERSONA,
    LETTA_LLM_MODEL, LETTA_EMBEDDING_MODEL, AGENT_DESCRIPTION,
)

log = structlog.get_logger()

_agent_id: str | None = None  # cached after first init

# Singleton client — reuses connections across all Letta API calls
_client: httpx.AsyncClient | None = None


def _get_letta_client() -> httpx.AsyncClient:
    """Return (and lazily create) the shared Letta HTTP client."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=30.0, follow_redirects=True)
    return _client



def _url(path: str) -> str:
    base = settings.letta_url.rstrip("/")
    return f"{base}{path}"


# ── Availability check ────────────────────────────────────────────────────

async def is_available() -> bool:
    if not settings.letta_url:
        return False
    try:
        c = _get_letta_client()
        r = await c.get(_url("/v1/health"))
        return r.status_code == 200
    except Exception:
        return False


# ── Agent lifecycle ───────────────────────────────────────────────────────

async def _find_agent() -> str | None:
    if not settings.letta_url:
        return None
    try:
        c = _get_letta_client()
        r = await c.get(_url("/v1/agents"))
        r.raise_for_status()
        for agent in r.json():
            if agent.get("name") == ROCKY_AGENT_NAME:
                return agent["id"]
    except Exception as e:
        log.warning("letta_find_agent_failed", error=str(e))
    return None


async def _create_agent() -> str | None:
    if not settings.letta_url:
        return None
    try:
        payload = {
            "name": ROCKY_AGENT_NAME,
            "description": AGENT_DESCRIPTION,
            "system": ROCKY_PERSONA,
            "memory": {
                "memory": {
                    "persona": {"value": ROCKY_PERSONA, "limit": 2000},
                    "human": {"value": INITIAL_HUMAN_BLOCK, "limit": 2000},
                }
            },
            "llm_config": {
                "model": LETTA_LLM_MODEL,
                "model_endpoint_type": "openai",
                "model_endpoint": "https://api.groq.com/openai/v1",
                "context_window": 32000,
            },
            "embedding_config": {
                "embedding_model": LETTA_EMBEDDING_MODEL,
                "embedding_dim": 1024,
            },
        }
        c = _get_letta_client()
        r = await c.post(_url("/v1/agents"), json=payload)
        r.raise_for_status()
        agent_id = r.json()["id"]
        log.info("letta_agent_created", agent_id=agent_id)
        return agent_id

    except Exception as e:
        log.error("letta_create_agent_failed", error=str(e))
        return None


async def get_agent_id() -> str | None:
    global _agent_id
    if _agent_id:
        return _agent_id
    _agent_id = await _find_agent() or await _create_agent()
    return _agent_id


# ── Messaging ─────────────────────────────────────────────────────────────

async def send_message(text: str, role: str = "user") -> str | None:
    """Send a message to Rocky (Letta) and return the assistant reply."""
    agent_id = await get_agent_id()
    if not agent_id:
        return None

    try:
        payload = {"messages": [{"role": role, "content": text}], "stream": False}
        c = _get_letta_client()
        r = await c.post(_url(f"/v1/agents/{agent_id}/messages"), json=payload)
        r.raise_for_status()
        data = r.json()

        # Extract assistant response from messages list
        for msg in data.get("messages", []):
            if msg.get("message_type") == "assistant_message":
                return msg.get("content", "").strip()
            # Older Letta API format
            if msg.get("role") == "assistant" and msg.get("content"):
                return msg["content"].strip()

        log.warning("letta_no_assistant_message", data=str(data)[:200])
        return None

    except Exception as e:
        log.error("letta_send_failed", error=str(e), agent_id=agent_id)
        return None


# ── Memory inspection ─────────────────────────────────────────────────────

async def get_core_memory() -> dict | None:
    agent_id = await get_agent_id()
    if not agent_id:
        return None
    try:
        c = _get_letta_client()
        r = await c.get(_url(f"/v1/agents/{agent_id}/core-memory"))
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning("letta_get_core_memory_failed", error=str(e))
        return None


async def search_archival(query: str, limit: int = 10) -> list[dict]:
    agent_id = await get_agent_id()
    if not agent_id:
        return []
    try:
        c = _get_letta_client()
        r = await c.get(
            _url(f"/v1/agents/{agent_id}/archival-memory"),
            params={"query": query, "limit": limit},
        )
        r.raise_for_status()
        return r.json().get("memories", r.json() if isinstance(r.json(), list) else [])
    except Exception as e:
        log.warning("letta_search_failed", error=str(e))
        return []


async def get_recent_memories(limit: int = 20) -> list[dict]:
    agent_id = await get_agent_id()
    if not agent_id:
        return []
    try:
        c = _get_letta_client()
        r = await c.get(
            _url(f"/v1/agents/{agent_id}/archival-memory"),
            params={"limit": limit},
        )
        r.raise_for_status()
        raw = r.json()
        return raw.get("memories", raw) if isinstance(raw, dict) else raw
    except Exception as e:
        log.warning("letta_recent_failed", error=str(e))
        return []


async def forget_all() -> bool:
    """Delete and recreate Rocky agent — full memory reset."""
    global _agent_id
    agent_id = await get_agent_id()
    if not agent_id:
        return False
    try:
        c = _get_letta_client()
        r = await c.delete(_url(f"/v1/agents/{agent_id}"))
        r.raise_for_status()
        _agent_id = None
        log.info("letta_agent_deleted", agent_id=agent_id)
        # Recreate fresh
        _agent_id = await _create_agent()
        return True
    except Exception as e:
        log.error("letta_forget_all_failed", error=str(e))
        return False
