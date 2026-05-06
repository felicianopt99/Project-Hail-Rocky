"""Skills API — lists available tools exposed to the LLM via function calling."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..tools.definitions import get_tools
from .auth import get_current_user

router = APIRouter()

# Tool enable/disable overrides (in-memory; Phase 6: persist to Redis)
_overrides: dict[str, dict] = {}

# ── Helpers ───────────────────────────────────────────────────────────────

_TOOL_META: dict[str, dict] = {
    "get_datetime":      {"category": "utility",      "description": "Current date and time."},
    "set_timer":         {"category": "productivity",  "description": "Set a countdown timer."},
    "get_weather":       {"category": "information",   "description": "Weather and forecast."},
    "search_wikipedia":  {"category": "knowledge",     "description": "Wikipedia summaries."},
    "calculate":         {"category": "productivity",  "description": "Mathematical calculations."},
    "control_lights":    {"category": "home",          "description": "Control smart home lights."},
    "activate_scene":    {"category": "home",          "description": "Activate a Home Assistant scene."},
}


async def _tool_skills() -> list[dict]:
    skills = []
    for tool in await get_tools():
        fn = tool["function"]
        name = fn["name"]
        meta = _TOOL_META.get(name, {})
        override = _overrides.get(name, {})
        skills.append({
            "id":          name,
            "name":        name.replace("_", " ").title(),
            "enabled":     override.get("enabled", True),
            "category":    meta.get("category", "utility"),
            "description": meta.get("description", fn.get("description", "")),
            "type":        "tool",
        })
    return skills


# ── Routes ────────────────────────────────────────────────────────────────

@router.get("")
async def list_skills():
    return await _tool_skills()


@router.post("/{skill_id}/toggle")
async def toggle_skill(skill_id: str, _user: dict = Depends(get_current_user)):
    override = _overrides.setdefault(skill_id, {})
    override["enabled"] = not override.get("enabled", True)
    return {"id": skill_id, "enabled": override["enabled"]}


@router.get("/{skill_id}/settings")
async def get_skill_settings(skill_id: str):
    return _overrides.get(skill_id, {})


@router.put("/{skill_id}/settings")
async def update_skill_settings(skill_id: str, body: dict):
    _overrides.setdefault(skill_id, {}).update(body)
    return _overrides[skill_id]


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
    if tool == "calculate":
        return {"expression": text.strip() or "2 ** 10"}
    if tool == "set_timer":
        nums = re.findall(r"\d+", text)
        return {"duration_seconds": int(nums[0]) * 60 if nums else 60, "label": "test"}
    return {}
