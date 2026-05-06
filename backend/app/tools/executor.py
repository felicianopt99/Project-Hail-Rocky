"""
Tool executor — dispatches LLM tool calls to the right implementation.
Each tool returns a plain string that goes back to the LLM as context.
"""
import ast
import asyncio
import math
import operator
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
import structlog


from ..config import settings

log = structlog.get_logger()

_TZ = settings.timezone
try:
    _TZINFO = ZoneInfo(_TZ)
except ZoneInfoNotFoundError:
    _TZINFO = timezone.utc


# ── Dispatch ──────────────────────────────────────────────────────────────

async def run(name: str, args: dict, sio=None) -> str:
    """Execute a tool by name and return the result as a string."""
    try:
        match name:
            case "get_datetime":       return _get_datetime()
            case "set_timer":          return await _set_timer(sio=sio, **args)
            case "get_weather":        return await _get_weather(**args)
            case "search_wikipedia":   return await _search_wikipedia(**args)
            case "calculate":          return _calculate(**args)
            case "calculate":          return _calculate(**args)
            case _:
                return f"Unknown tool: {name}"
    except Exception as e:
        log.error("tool_error", tool=name, error=str(e))
        return f"Tool '{name}' failed: {e}"


# ── Implementations ───────────────────────────────────────────────────────

def _get_datetime() -> str:
    now = datetime.now(_TZINFO)
    return (
        f"Current date and time: {now.strftime('%A, %d %B %Y, %H:%M')} "
        f"(timezone: {_TZ})"
    )


async def _set_timer(duration_seconds: int, label: str = "timer", sio=None) -> str:
    label = label or "timer"

    async def _fire():
        await asyncio.sleep(duration_seconds)
        if sio:
            await sio.emit("timer_fired", {"label": label})
        log.info("timer_fired", label=label, seconds=duration_seconds)

    asyncio.create_task(_fire())

    mins, secs = divmod(duration_seconds, 60)
    hours, mins = divmod(mins, 60)
    parts = []
    if hours: parts.append(f"{hours}h")
    if mins:  parts.append(f"{mins}m")
    if secs:  parts.append(f"{secs}s")
    human = " ".join(parts) or f"{duration_seconds}s"
    return f"Timer set: '{label}' will fire in {human}."


async def _get_weather(city: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            # 1. Geocode
            geo = await c.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1, "language": "en"},
            )
            geo.raise_for_status()
            results = geo.json().get("results", [])
            if not results:
                return f"City '{city}' not found."
            loc = results[0]
            lat, lon = loc["latitude"], loc["longitude"]
            name = loc.get("name", city)
            country = loc.get("country", "")

            # 2. Weather
            wx = await c.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
                    "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
                    "forecast_days": 1,
                    "timezone": "auto",
                },
            )
            wx.raise_for_status()
            data = wx.json()

        cur = data.get("current", {})
        daily = data.get("daily", {})

        temp       = cur.get("temperature_2m", "?")
        feels_like = cur.get("apparent_temperature", "?")
        wind       = cur.get("wind_speed_10m", "?")
        code       = cur.get("weather_code", 0)
        desc       = _weather_code(code)

        tmax  = (daily.get("temperature_2m_max") or ["?"])[0]
        tmin  = (daily.get("temperature_2m_min") or ["?"])[0]
        rain  = (daily.get("precipitation_sum")  or [0])[0]

        return (
            f"Weather in {name}, {country}: {temp}°C (feels {feels_like}°C), {desc}. "
            f"Wind {wind} km/h. Today: max {tmax}°C / min {tmin}°C, "
            f"precipitation {rain} mm."
        )
    except Exception as e:
        return f"Could not fetch weather: {e}"


def _weather_code(code: int) -> str:
    mapping = {
        0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
        45: "fog", 48: "icy fog",
        51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
        61: "light rain", 63: "rain", 65: "heavy rain",
        71: "light snow", 73: "snow", 75: "heavy snow",
        80: "rain showers", 81: "showers", 82: "heavy showers",
        95: "thunderstorm", 96: "thunderstorm with hail",
    }
    return mapping.get(code, f"code {code}")


async def _search_wikipedia(query: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{query.replace(' ', '_')}",
                headers={"User-Agent": "ProjectHailRocky/1.0"},
            )
            if r.status_code == 404:
                # Try search endpoint
                s = await c.get(
                    "https://en.wikipedia.org/w/api.php",
                    params={"action": "query", "list": "search", "srsearch": query,
                            "format": "json", "srlimit": 1},
                )
                hits = s.json().get("query", {}).get("search", [])
                if not hits:
                    return f"No Wikipedia article found for '{query}'."
                title = hits[0]["title"]
                r = await c.get(
                    f"https://en.wikipedia.org/api/rest_v1/page/summary/{title.replace(' ', '_')}",
                    headers={"User-Agent": "ProjectHailRocky/1.0"},
                )
            r.raise_for_status()
            data = r.json()
            title   = data.get("title", query)
            extract = data.get("extract", "No summary available.")
            # Truncate long extracts
            if len(extract) > 500:
                extract = extract[:497] + "..."
            return f"{title}: {extract}"
    except Exception as e:
        return f"Wikipedia search failed: {e}"


# Safe math operators only
_SAFE_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub,
    ast.Mult: operator.mul, ast.Div: operator.truediv,
    ast.Pow: operator.pow, ast.Mod: operator.mod,
    ast.USub: operator.neg, ast.UAdd: operator.pos,
    ast.FloorDiv: operator.floordiv,
}
_SAFE_NAMES = {
    "pi": math.pi, "e": math.e,
    "sqrt": math.sqrt, "abs": abs,
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "log": math.log, "log10": math.log10,
    "ceil": math.ceil, "floor": math.floor, "round": round,
}

def _safe_eval(node):
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in _SAFE_NAMES:
            return _SAFE_NAMES[node.id]
        raise ValueError(f"Unknown name: {node.id}")
    if isinstance(node, ast.Call):
        func = _safe_eval(node.func)
        args = [_safe_eval(a) for a in node.args]
        return func(*args)
    if isinstance(node, ast.BinOp):
        op = _SAFE_OPS.get(type(node.op))
        if op:
            return op(_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp):
        op = _SAFE_OPS.get(type(node.op))
        if op:
            return op(_safe_eval(node.operand))
    raise ValueError(f"Unsupported expression: {ast.dump(node)}")


def _calculate(expression: str) -> str:
    try:
        tree = ast.parse(expression.strip(), mode="eval")
        result = _safe_eval(tree)
        if isinstance(result, float) and result.is_integer():
            result = int(result)
        return f"{expression} = {result}"
    except Exception as e:
        return f"Calculation error: {e}"



