"""Skills API — lists available tools exposed to the LLM via function calling."""
import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..config import settings
from ..core.redis_client import get_redis
from ..tools.definitions import get_tools, BASE_TOOL_NAMES, invalidate_tools_cache
from .auth import get_current_user

router = APIRouter()

# ── Helpers ───────────────────────────────────────────────────────────────

_TOOL_META: dict[str, dict] = {
    "get_datetime":       {"category": "utility",      "description": "Current date and time."},
    "set_timer":          {"category": "productivity", "description": "Countdown timer with cooking presets."},
    "set_alarm":          {"category": "productivity", "description": "Schedule an alarm at a specific time."},
    "set_reminder":       {"category": "productivity", "description": "Schedule a reminder with a message."},
    "list_alarms":        {"category": "productivity", "description": "Show pending alarms and reminders."},
    "cancel_alarm":       {"category": "productivity", "description": "Cancel a scheduled alarm or reminder."},
    "add_to_list":        {"category": "productivity", "description": "Add item to a persistent list (shopping, todo...)."},
    "get_list":           {"category": "productivity", "description": "Read all items in a named list."},
    "remove_from_list":   {"category": "productivity", "description": "Remove an item from a named list."},
    "get_weather":        {"category": "information",  "description": "Weather and forecast."},
    "search_wikipedia":   {"category": "knowledge",    "description": "Wikipedia summaries."},
    "execute_python":     {"category": "productivity", "description": "Run Python code for analysis/math."},
    "check_server_health": {"category": "system",      "description": "Monitor Optiplex hardware health."},
    # Aggregate entry — not a real tool, represents the full HA MCP integration
    "home_assistant":     {"category": "home",         "description": "Control Home Assistant devices and automations via MCP."},
}

_REDIS_KEY = "rocky:skills:override:{}"

# Only these HA MCP tools are sent to the LLM for tool calling.
# The full 83-tool list from HA MCP is ~46k tokens — well beyond Groq's limits.
# Other HA tools remain available for direct calls but not in LLM context.
_HA_ESSENTIAL_TOOLS = {
    "ha_call_service",      # primary action: turn on/off, set brightness, etc.
    "ha_get_state",         # read current entity state
    "ha_search_entities",   # find entities by name or domain
    "ha_config_list_areas", # list rooms/areas
    "ha_bulk_control",      # control multiple entities at once
    "ha_get_overview",      # quick home summary
    "ha_list_services",     # discover available services
}


async def _load_overrides(tool_names: list[str]) -> dict[str, dict]:
    """Return {tool_name: override_dict} fetched from Redis in one round-trip."""
    overrides: dict[str, dict] = {}
    redis = await get_redis()
    if redis is not None:
        keys = [_REDIS_KEY.format(name) for name in tool_names]
        values = await redis.mget(*keys)
        for name, raw in zip(tool_names, values):
            if raw is not None:
                overrides[name] = json.loads(raw)
    return overrides


async def get_active_tools() -> list[dict]:
    """Return enabled tools for the LLM.

    HA MCP tools are limited to _HA_ESSENTIAL_TOOLS to avoid hitting LLM token
    limits (the full 83-tool list from HA MCP exceeds 46k tokens per request).
    """
    tools = await get_tools()
    names = [t["function"]["name"] for t in tools]
    overrides = await _load_overrides(names + ["home_assistant"])
    ha_enabled = overrides.get("home_assistant", {}).get("enabled", True)
    return [
        t for t in tools
        if overrides.get(t["function"]["name"], {}).get("enabled", True)
        and (
            t["function"]["name"] in BASE_TOOL_NAMES
            or (ha_enabled and t["function"]["name"] in _HA_ESSENTIAL_TOOLS)
        )
    ]


async def _tool_skills() -> list[dict]:
    tools = await get_tools()
    tool_names = [t["function"]["name"] for t in tools]
    overrides = await _load_overrides(tool_names + ["home_assistant"])

    skills = []
    ha_tool_names: list[str] = []

    for tool in tools:
        fn = tool["function"]
        name = fn["name"]
        if name not in BASE_TOOL_NAMES:
            ha_tool_names.append(name)
            continue
        meta = _TOOL_META.get(name, {})
        override = overrides.get(name, {})
        skills.append({
            "id":          name,
            "name":        name.replace("_", " ").title(),
            "enabled":     override.get("enabled", True),
            "category":    meta.get("category", "utility"),
            "description": meta.get("description", fn.get("description", "")),
            "type":        "tool",
        })

    # Single aggregated entry for the entire HA MCP integration
    if ha_tool_names or settings.ha_mcp_url:
        ha_override = overrides.get("home_assistant", {})
        skills.append({
            "id":          "home_assistant",
            "name":        "Home Assistant",
            "enabled":     ha_override.get("enabled", True),
            "category":    "home",
            "description": _TOOL_META["home_assistant"]["description"],
            "type":        "integration",
            "deviceCount": len(ha_tool_names),
            "connected":   bool(ha_tool_names),
        })

    return skills


# ── Routes ────────────────────────────────────────────────────────────────

@router.get("")
async def list_skills():
    return await _tool_skills()


@router.post("/{skill_id}/toggle")
async def toggle_skill(skill_id: str, _user: dict = Depends(get_current_user)):
    redis = await get_redis()
    key = _REDIS_KEY.format(skill_id)

    override: dict = {}
    if redis is not None:
        raw = await redis.get(key)
        if raw is not None:
            override = json.loads(raw)

    override["enabled"] = not override.get("enabled", True)

    if redis is not None:
        await redis.set(key, json.dumps(override))

    return {"id": skill_id, "enabled": override["enabled"]}


@router.post("/home_assistant/refresh", dependencies=[Depends(get_current_user)])
async def refresh_ha_tools():
    """Invalidate MCP discovery cache and re-discover HA tools immediately."""
    invalidate_tools_cache()
    tools = await get_tools()
    ha_count = sum(1 for t in tools if t["function"]["name"] not in BASE_TOOL_NAMES)
    return {"discovered": ha_count}


@router.get("/{skill_id}/settings")
async def get_skill_settings(skill_id: str):
    redis = await get_redis()
    if redis is None:
        return {}
    raw = await redis.get(_REDIS_KEY.format(skill_id))
    return json.loads(raw) if raw is not None else {}


@router.put("/{skill_id}/settings")
async def update_skill_settings(skill_id: str, body: dict):
    redis = await get_redis()
    key = _REDIS_KEY.format(skill_id)

    override: dict = {}
    if redis is not None:
        raw = await redis.get(key)
        if raw is not None:
            override = json.loads(raw)

    override.update(body)

    if redis is not None:
        await redis.set(key, json.dumps(override))

    return override


class TestRequest(BaseModel):
    text: str
    lang: str = "en-us"


@router.post("/{skill_id}/test")
async def test_skill(skill_id: str, body: TestRequest):
    """Quick test: run the tool directly if it's a built-in tool."""
    from ..tools.executor import run as run_tool
    # Map skill_id back to tool name
    tools = await get_tools()
    tool_names = {t["function"]["name"] for t in tools}
    if skill_id in tool_names:
        # Parse args from text for simple tools
        args = _parse_test_args(skill_id, body.text)
        result = await run_tool(skill_id, args)
        return {"result": result}
    return {"result": None, "note": f"'{skill_id}' is a Rocky narrative skill — invoked via voice/chat."}


def _parse_test_args(tool: str, text: str) -> dict:
    """Best-effort arg extraction for quick test calls."""
    import re
    if tool == "get_weather":
        return {"city": text.strip() or "Lisbon"}
    if tool == "search_wikipedia":
        return {"query": text.strip() or "Project Hail Mary"}
    if tool == "execute_python":
        return {"code": f"print({text.strip() or '2 ** 10'})"}
    if tool == "set_timer":
        nums = re.findall(r"\d+", text)
        return {"duration_seconds": int(nums[0]) * 60 if nums else 60, "label": "test"}
    return {}
