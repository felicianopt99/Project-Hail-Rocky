"""
Bridge between Rocky backend and Letta memory server.

Uses Letta REST API directly (no SDK dependency).
Gracefully falls back to None when Letta is unavailable.
"""
import json
import time
import httpx
import structlog
from typing import Any, AsyncGenerator, Optional

from ..config import settings
from ..rocky.letta_config import (
    ROCKY_AGENT_NAME, INITIAL_HUMAN_BLOCK, ROCKY_PERSONA,
    LETTA_LLM_MODEL, LETTA_EMBEDDING_MODEL, AGENT_DESCRIPTION,
    HA_MCP_SERVER_NAME
)
from ..core.semantic_cache import semantic_cache
from ..core.trace import get_trace_id

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

async def close_client():
    """Close the shared Letta HTTP client."""
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        log.debug("letta_client_closed")



def _url(path: str) -> str:
    base = settings.letta_url.rstrip("/")
    return f"{base}{path}"


def _get_llm_config() -> dict:
    if settings.groq_api_key:
        return {
            "model": "llama-3.1-8b-instant",
            "model_endpoint_type": "openai",
            "model_endpoint": "https://api.groq.com/openai/v1",
            "context_window": 32000,
        }
    if settings.gemini_api_key:
        return {
            "model": "gemini-2.0-flash",
            "model_endpoint_type": "google_ai",
            "model_endpoint": "https://generativelanguage.googleapis.com",
            "context_window": 32000,
        }
    if settings.nvidia_api_key:
        return {
            "model": "meta/llama-3.1-70b-instruct",
            "model_endpoint_type": "openai",
            "model_endpoint": "https://integrate.api.nvidia.com/v1",
            "context_window": 32000,
        }
    return {
        "model": LETTA_LLM_MODEL,
        "model_endpoint_type": "openai",
        "model_endpoint": "https://api.groq.com/openai/v1",
        "context_window": 32000,
    }


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
        # Default Letta core tools (memory management)
        core_tools = [
            "core_memory_append",
            "core_memory_replace",
            "archival_memory_search",
            "archival_memory_insert"
        ]
        
        log.info("letta_agent_creating", tools_count=len(core_tools))

        payload = {
            "name": ROCKY_AGENT_NAME,
            "description": AGENT_DESCRIPTION,
            "system": ROCKY_PERSONA,
            "tools": core_tools,
            "memory": {
                "memory": {
                    "persona": {"value": ROCKY_PERSONA, "limit": 2000},
                    "human": {"value": INITIAL_HUMAN_BLOCK, "limit": 2000},
                }
            },
            "llm_config": _get_llm_config(),
            "embedding_config": {
                "embedding_model": "letta-free",
                "embedding_endpoint_type": "openai",
                "embedding_endpoint": "https://inference.letta.com/v1/",
                "embedding_dim": 1536,
            },
        }
        c = _get_letta_client()
        r = await c.post(_url("/v1/agents"), json=payload)
        r.raise_for_status()
        agent_id = r.json()["id"]
        log.info("letta_agent_created", agent_id=agent_id)
        return agent_id

    except Exception as e:
        if hasattr(e, "response") and e.response:
            log.error("letta_create_agent_failed", error=str(e), body=e.response.text)
        else:
            log.error("letta_create_agent_failed", error=str(e))
        return None


async def get_agent_id() -> str | None:
    """
    Get the agent ID, creating it if necessary.
    Letta is used as a memory backend; reasoning and tools are handled by LangGraph.
    """
    global _agent_id
    if not _agent_id:
        _agent_id = await _find_agent() or await _create_agent()
    return _agent_id


# ── Messaging (DEPRECATED) ──────────────────────────────────────────────────
# All messaging now routes through app/rocky/graph/workflow.py


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


async def update_core_memory(persona: str = None, human: str = None) -> bool:
    """
    Update Letta core memory blocks (persona and/or human).
    This centralizes personality and user profile management in Letta.
    """
    agent_id = await get_agent_id()
    if not agent_id:
        return False
    
    # Letta expects a dict with the block names to update
    payload = {}
    if persona:
        payload["persona"] = persona
    if human:
        payload["human"] = human
        
    if not payload:
        return True
        
    try:
        c = _get_letta_client()
        # PATCH /v1/agents/{agent_id}/core-memory updates the specified blocks
        r = await c.patch(_url(f"/v1/agents/{agent_id}/core-memory"), json=payload)
        r.raise_for_status()
        log.info("letta_core_memory_updated", persona_updated=bool(persona), human_updated=bool(human))
        return True
    except Exception as e:
        log.error("letta_update_core_memory_failed", error=str(e))
        return False


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
