import asyncio
import json
import time

import httpx
import structlog
from ..config import settings

log = structlog.get_logger()

BASE_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "set_timer",
            "description": (
                "Set a countdown timer that fires an alert when done. "
                "Use `preset` for common cooking times — overrides duration_seconds: "
                "pasta/spaghetti=10min, rice=18min, eggs=6min, ramen=3min, noodles=5min, "
                "oatmeal=5min, pizza=12min, cookies=12min, tea=5min, coffee=4min, "
                "steak=8min, potato=20min, bread=35min, cake=40min, chicken=25min."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "duration_seconds": {
                        "type": "integer",
                        "description": "Timer duration in seconds. Ignored if preset is provided.",
                    },
                    "label": {
                        "type": "string",
                        "description": "Short label for the timer (e.g. 'pasta', 'meeting').",
                    },
                    "preset": {
                        "type": "string",
                        "description": "Named cooking/food preset. Overrides duration_seconds.",
                        "enum": [
                            "pasta", "spaghetti", "rice", "eggs", "ramen", "noodles",
                            "oatmeal", "pizza", "cookies", "tea", "coffee", "steak",
                            "potato", "bread", "cake", "chicken",
                        ],
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_alarm",
            "description": (
                "Schedule an alarm for a specific date and time. "
                "Use for 'wake me at 7am', 'alarm for tomorrow at 8:30', etc. "
                "Convert natural language to ISO 8601 datetime in local time "
                "(YYYY-MM-DDTHH:MM:SS). Today is available via get_datetime."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "datetime_iso": {
                        "type": "string",
                        "description": "Target local datetime, ISO 8601 (e.g. '2026-05-08T07:00:00').",
                    },
                    "label": {
                        "type": "string",
                        "description": "Name for this alarm (e.g. 'wake up', 'dentist').",
                    },
                },
                "required": ["datetime_iso"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_reminder",
            "description": (
                "Schedule a reminder at a specific time with a custom message. "
                "Pass datetime_iso in ISO 8601 format (YYYY-MM-DDTHH:MM:SS) in local time."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "datetime_iso": {
                        "type": "string",
                        "description": "Target local datetime, ISO 8601.",
                    },
                    "message": {
                        "type": "string",
                        "description": "The reminder message (e.g. 'call doctor', 'buy milk').",
                    },
                    "label": {
                        "type": "string",
                        "description": "Short label for the reminder.",
                    },
                },
                "required": ["datetime_iso", "message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_alarms",
            "description": "List all pending alarms and reminders.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_alarm",
            "description": "Cancel a pending alarm or reminder by label.",
            "parameters": {
                "type": "object",
                "properties": {
                    "label": {
                        "type": "string",
                        "description": "Label of the alarm or reminder to cancel.",
                    },
                },
                "required": ["label"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather and today's forecast for any city.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "City name (e.g. 'Lisbon', 'Porto', 'London').",
                    },
                },
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_wikipedia",
            "description": "Get a brief summary of a topic from Wikipedia.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Topic or person to look up.",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_to_list",
            "description": (
                "Add an item to a named persistent list. "
                "Use list_name='shopping' for shopping lists, 'todo' for tasks, "
                "or any custom name. Items persist across sessions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "list_name": {
                        "type": "string",
                        "description": "List name (e.g. 'shopping', 'todo', 'groceries').",
                    },
                    "item": {
                        "type": "string",
                        "description": "Item to add.",
                    },
                },
                "required": ["list_name", "item"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_list",
            "description": "Get all items in a named list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "list_name": {
                        "type": "string",
                        "description": "List name (e.g. 'shopping', 'todo').",
                    },
                },
                "required": ["list_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_from_list",
            "description": "Remove an item from a named list.",
            "parameters": {
                "type": "object",
                "properties": {
                    "list_name": {
                        "type": "string",
                        "description": "List name.",
                    },
                    "item": {
                        "type": "string",
                        "description": "Item to remove (exact or partial match).",
                    },
                },
                "required": ["list_name", "item"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_python",
            "description": "Execute Python code for complex calculations, data analysis, or advanced logic. Returns the console output (STDOUT).",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "The complete Python code to execute.",
                    }
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_server_health",
            "description": "Get real-time hardware status of the Optiplex server (CPU temp, RAM usage, Disk space).",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
]

BASE_TOOL_NAMES: frozenset[str] = frozenset(t["function"]["name"] for t in BASE_TOOLS)

_tools_cache: list[dict] | None = None
_tools_cache_ts: float = 0.0
_TOOLS_CACHE_TTL = 60.0
_tools_lock = asyncio.Lock()


def invalidate_tools_cache() -> None:
    global _tools_cache, _tools_cache_ts
    _tools_cache = None
    _tools_cache_ts = 0.0


async def get_tools() -> list[dict]:
    """
    Dynamic Skill Discovery (MCP):
    Returns a union of hardcoded BASE_TOOLS and dynamic tools from MCP servers.
    Results are cached for 60 s to avoid an HTTP round-trip on every LLM request.
    """
    global _tools_cache, _tools_cache_ts

    async with _tools_lock:
        now = time.monotonic()
        if _tools_cache is not None and (now - _tools_cache_ts) < _TOOLS_CACHE_TTL:
            return list(_tools_cache)

        tools = list(BASE_TOOLS)

        if settings.ha_mcp_url:
            try:
                _mcp_headers = {"Accept": "application/json, text/event-stream"}
                async with httpx.AsyncClient(timeout=5.0) as client:
                    endpoint = f"{settings.ha_mcp_url.rstrip('/')}/mcp"

                    init_r = await client.post(endpoint, headers=_mcp_headers, json={
                        "jsonrpc": "2.0", "id": 0, "method": "initialize",
                        "params": {
                            "protocolVersion": "2025-03-26",
                            "capabilities": {},
                            "clientInfo": {"name": "rocky-discovery", "version": "1.0"},
                        },
                    })
                    session_id = init_r.headers.get("mcp-session-id", "") if init_r.status_code == 200 else ""
                    if not session_id:
                        log.warning("mcp_init_failed", status=init_r.status_code)
                    else:
                        session_headers = {**_mcp_headers, "Mcp-Session-Id": session_id}
                        await client.post(endpoint, headers=session_headers,
                                          json={"jsonrpc": "2.0", "method": "notifications/initialized"})

                        r = await client.post(endpoint, headers=session_headers,
                                              json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
                        if r.status_code == 200:
                            mcp_tools: list[dict] = []
                            for line in r.text.splitlines():
                                if line.startswith("data:"):
                                    try:
                                        mcp_tools = json.loads(line[5:].strip()).get("result", {}).get("tools", [])
                                    except Exception:
                                        pass
                                    break
                            for t in mcp_tools:
                                tools.append({
                                    "type": "function",
                                    "function": {
                                        "name": t["name"],
                                        "description": t.get("description", ""),
                                        "parameters": t.get("inputSchema", {"type": "object", "properties": {}}),
                                    }
                                })
                            log.info("mcp_discovery_ok", count=len(mcp_tools), url=endpoint)
            except Exception as e:
                log.warning("mcp_discovery_failed", url=settings.ha_mcp_url, error=str(e))

        _tools_cache = tools
        _tools_cache_ts = now
        return list(tools)
