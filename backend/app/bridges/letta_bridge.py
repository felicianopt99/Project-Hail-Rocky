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

# Tool list cache: avoid re-fetching MCP tool names on every send_message
_tool_names_cache: list[str] | None = None
_tool_names_cache_ts: float = 0.0
_TOOL_CACHE_TTL = 300.0  # 5 minutes

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


# ── MCP Integration ───────────────────────────────────────────────────────

async def _get_or_create_mcp_server() -> str | None:
    """Ensure the HA MCP server is registered in Letta."""
    if not settings.letta_url or not settings.ha_mcp_url:
        return None
    
    c = _get_letta_client()
    try:
        # 1. Check if already registered (Letta uses "server_name" as the key)
        r = await c.get(_url("/v1/mcp-servers"))
        r.raise_for_status()
        for srv in r.json():
            if srv.get("server_name") == HA_MCP_SERVER_NAME:
                return srv["id"]

        # 2. Create if not found
        payload = {
            "server_name": HA_MCP_SERVER_NAME,
            "config": {
                "mcp_server_type": "streamable_http",
                "server_url": f"{settings.ha_mcp_url.rstrip('/')}/mcp",
            }
        }
        r = await c.post(_url("/v1/mcp-servers"), json=payload)
        if r.status_code == 409:
            # Already exists (race or leftover) — fetch the ID again
            r2 = await c.get(_url("/v1/mcp-servers"))
            r2.raise_for_status()
            for srv in r2.json():
                if srv.get("server_name") == HA_MCP_SERVER_NAME:
                    return srv["id"]
            return None
        r.raise_for_status()
        srv_id = r.json()["id"]
        log.info("letta_mcp_server_registered", srv_id=srv_id)
        return srv_id
    except Exception as e:
        if hasattr(e, "response") and e.response:
            log.warning("letta_mcp_registration_failed", error=str(e), body=e.response.text)
        else:
            log.warning("letta_mcp_registration_failed", error=str(e))
        return None


async def _get_mcp_tool_names() -> list[str]:
    """Fetch all tool names from the registered MCP server."""
    srv_id = await _get_or_create_mcp_server()
    if not srv_id:
        return []
    
    c = _get_letta_client()
    try:
        # Refresh first to ensure we have latest tools
        await c.patch(_url(f"/v1/mcp-servers/{srv_id}/refresh"))
        
        # Get tools
        r = await c.get(_url(f"/v1/mcp-servers/{srv_id}/tools"))
        r.raise_for_status()
        tools = r.json()
        # tools is usually a list of tool objects with a 'name' field
        return [t["name"] for t in tools if "name" in t]
    except Exception as e:
        log.warning("letta_mcp_tool_fetch_failed", error=str(e))
        return []


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
        # Fetch dynamic tools from MCP
        mcp_tools = await _get_mcp_tool_names()
        
        # Default Letta core tools (memory management)
        core_tools = [
            "send_message",
            "core_memory_append",
            "core_memory_replace",
            "archival_memory_search",
            "archival_memory_insert"
        ]
        
        all_tools = list(set(core_tools + mcp_tools))
        log.info("letta_agent_creating", tools_count=len(all_tools), mcp_tools=mcp_tools)

        payload = {
            "name": ROCKY_AGENT_NAME,
            "description": AGENT_DESCRIPTION,
            "system": ROCKY_PERSONA,
            "tools": all_tools,
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
    On every initialization (startup), it syncs tools from the MCP server
    to ensure Rocky has the latest skills without code changes.
    """
    global _agent_id
    if not _agent_id:
        _agent_id = await _find_agent() or await _create_agent()
    
    if _agent_id:
        global _tool_names_cache, _tool_names_cache_ts
        now = time.monotonic()
        if _tool_names_cache is None or (now - _tool_names_cache_ts) > _TOOL_CACHE_TTL:
            try:
                # Dynamic Discovery: Fetch latest tools from MCP and update agent
                mcp_tools = await _get_mcp_tool_names()
                core_tools = [
                    "send_message", "core_memory_append", "core_memory_replace",
                    "archival_memory_search", "archival_memory_insert"
                ]
                all_tools = list(set(core_tools + mcp_tools))
                _tool_names_cache = all_tools
                _tool_names_cache_ts = now

                c = _get_letta_client()
                # Register the tools with the agent in Letta
                await c.patch(_url(f"/v1/agents/{_agent_id}"), json={"tools": all_tools})
                log.info("letta_dynamic_discovery_ok", tools_count=len(all_tools), mcp_count=len(mcp_tools))
            except Exception as e:
                log.warning("letta_dynamic_discovery_failed", error=str(e))
            
    return _agent_id


# ── Messaging ─────────────────────────────────────────────────────────────

async def send_message(text: str, role: str = "user") -> str | None:
    """Send a message to Rocky (Letta) and return the assistant reply."""
    # 1. Semantic Cache check
    if role == "user":
        cached = await semantic_cache.check(text)
        if cached:
            return cached["response"]

    agent_id = await get_agent_id()
    if not agent_id:
        return None

    data = None
    result = None
    tool_used = False
    try:
        trace_id = get_trace_id()
        payload = {
            "messages": [{"role": role, "content": text}],
            "stream": False,
            "metadata": {"trace_id": trace_id} if trace_id else {},
            "tags": [f"trace_id:{trace_id}"] if trace_id else []
        }
        headers = {"X-Trace-Id": trace_id} if trace_id else {}
        c = _get_letta_client()
        r = await c.post(_url(f"/v1/agents/{agent_id}/messages"), json=payload, headers=headers)
        r.raise_for_status()
        data = r.json()

        # Single pass: capture first assistant reply and whether any tool was called
        for msg in data.get("messages", []):
            if msg.get("message_type") == "tool_call":
                tool_used = True
            elif msg.get("message_type") == "assistant_message" and result is None:
                result = msg.get("content", "").strip() or None
            elif msg.get("role") == "assistant" and msg.get("content") and result is None:
                # Older Letta API format
                result = msg["content"].strip()

        if result is None:
            log.warning("letta_no_assistant_message", data=str(data)[:200])
        return result

    except Exception as e:
        log.error("letta_send_failed", error=str(e), agent_id=agent_id)
        return None

    finally:
        if role == "user" and data and result and not tool_used:
            await semantic_cache.store(text, result)


async def send_message_stream(text: str, role: str = "user") -> AsyncGenerator[str, None]:
    """
    Send a message to Rocky (Letta) and yield assistant message tokens in real-time.
    Uses SSE-style streaming from the Letta API.
    """
    # 1. Semantic Cache check
    if role == "user":
        cached = await semantic_cache.check(text)
        if cached:
            yield cached["response"]
            return

    agent_id = await get_agent_id()
    if not agent_id:
        return

    c = _get_letta_client()
    url = _url(f"/v1/agents/{agent_id}/messages")
    trace_id = get_trace_id()
    payload = {
        "messages": [{"role": role, "content": text}], 
        "stream": True,
        "metadata": {"trace_id": trace_id} if trace_id else {},
        "tags": [f"trace_id:{trace_id}"] if trace_id else []
    }
    headers = {"X-Trace-Id": trace_id} if trace_id else {}
    full_response = []
    tool_used = False

    try:
        async with c.stream("POST", url, json=payload, headers=headers) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line or not line.strip():
                    continue
                
                # Letta streams can be SSE (data: ...) or raw JSON chunks
                if line.startswith("data:"):
                    line = line[5:].strip()
                
                if line == "[DONE]":
                    break
                
                try:
                    data = json.loads(line)
                    mtype = data.get("message_type")
                    
                    if mtype == "assistant_message":
                        content = data.get("content", "")
                        if content:
                            full_response.append(content)
                            yield content
                    elif mtype == "tool_call":
                        tool_used = True
                        call = data.get("tool_call", {})
                        fname = call.get("name")
                        yield f"\n[Tool Call: {fname}] "
                    elif mtype == "thought":
                        thought = data.get("thought", "")
                        if thought and settings.voice_debug_events:
                            yield f"\n[Thought: {thought}] "
                            
                except json.JSONDecodeError:
                    continue

    except Exception as e:
        log.error("letta_stream_failed", error=str(e))
        yield ""
    
    finally:
        # Store in cache if we accumulated a response and no tools were used
        if role == "user" and full_response and not tool_used:
            await semantic_cache.store(text, "".join(full_response))


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
