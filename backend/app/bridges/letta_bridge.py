"""
Bridge between Rocky backend and Letta memory server.

Uses Letta REST API directly (no SDK dependency).
Gracefully falls back to None when Letta is unavailable.
"""
import json
import httpx
import structlog
from typing import List, Dict, Any, Optional, AsyncGenerator

from ..config import settings
from ..rocky.letta_config import (
    ROCKY_AGENT_NAME, INITIAL_HUMAN_BLOCK, ROCKY_PERSONA,
    LETTA_LLM_MODEL, LETTA_EMBEDDING_MODEL, AGENT_DESCRIPTION,
    HA_MCP_SERVER_NAME
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
async def close_client():
    """Close the shared Letta HTTP client."""
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
        log.debug("letta_client_closed")



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


# ── MCP Integration ───────────────────────────────────────────────────────

async def _get_or_create_mcp_server() -> str | None:
    """Ensure the HA MCP server is registered in Letta."""
    if not settings.letta_url or not settings.ha_mcp_url:
        return None
    
    c = _get_letta_client()
    try:
        # 1. Check if exists
        r = await c.get(_url("/v1/mcp-servers"))
        r.raise_for_status()
        for srv in r.json():
            if srv.get("name") == HA_MCP_SERVER_NAME:
                return srv["id"]
        
        # 2. Create if not exists
        payload = {
            "name": HA_MCP_SERVER_NAME,
            "config": {
                "mcp_server_type": "streamable_http",
                "server_url": settings.ha_mcp_url,
            }
        }
        r = await c.post(_url("/v1/mcp-servers"), json=payload)
        r.raise_for_status()
        srv_id = r.json()["id"]
        log.info("letta_mcp_server_registered", srv_id=srv_id)
        return srv_id
    except Exception as e:
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
    if not _agent_id:
        _agent_id = await _find_agent() or await _create_agent()
    
    # Optional: Sync tools every time the bridge initializes if agent already exists
    if _agent_id:
        try:
            mcp_tools = await _get_mcp_tool_names()
            if mcp_tools:
                core_tools = [
                    "send_message", "core_memory_append", "core_memory_replace",
                    "archival_memory_search", "archival_memory_insert"
                ]
                all_tools = list(set(core_tools + mcp_tools))
                c = _get_letta_client()
                await c.patch(_url(f"/v1/agents/{_agent_id}"), json={"tools": all_tools})
                log.info("letta_agent_tools_synced", tools_count=len(all_tools))
        except Exception as e:
            log.warning("letta_tool_sync_failed", error=str(e))
            
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


async def send_message_stream(text: str, role: str = "user") -> AsyncGenerator[str, None]:
    """
    Send a message to Rocky (Letta) and yield assistant message tokens in real-time.
    Uses SSE-style streaming from the Letta API.
    """
    agent_id = await get_agent_id()
    if not agent_id:
        return

    c = _get_letta_client()
    url = _url(f"/v1/agents/{agent_id}/messages")
    payload = {"messages": [{"role": role, "content": text}], "stream": True}

    try:
        async with c.stream("POST", url, json=payload) as r:
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
                            yield content
                    elif mtype == "tool_call":
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
