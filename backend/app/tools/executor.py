import ast
import asyncio
import json
import math
import operator
import resource
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import psutil
import structlog

from ..config import settings
from ..core.http_client import get_http_client
from ..core.redis_client import get_redis

from ..bridges.mcp_bridge import mcp_bridge

log = structlog.get_logger()

_mcp_sessions: dict[str, str] = {}  # mcp_url → session_id
_MCP_HEADERS = {"Accept": "application/json, text/event-stream"}


def _parse_sse_json(text: str) -> dict | None:
    """Extract JSON payload from a text/event-stream response body."""
    for line in text.splitlines():
        if line.startswith("data:"):
            try:
                return json.loads(line[5:].strip())
            except json.JSONDecodeError:
                pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


async def _mcp_init_session(client, endpoint: str) -> str | None:
    """Initialize an MCP streamable-http session; returns the session ID."""
    payload = {
        "jsonrpc": "2.0", "id": 0, "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "rocky", "version": "1.0"},
        },
    }
    r = await client.post(endpoint, json=payload, headers=_MCP_HEADERS)
    if r.status_code != 200:
        return None
    session_id = r.headers.get("mcp-session-id")
    if not session_id:
        return None
    notif = {"jsonrpc": "2.0", "method": "notifications/initialized"}
    await client.post(endpoint, json=notif,
                      headers={**_MCP_HEADERS, "Mcp-Session-Id": session_id})
    return session_id

_TZ = settings.timezone
try:
    _TZINFO = ZoneInfo(_TZ)
except ZoneInfoNotFoundError:
    _TZINFO = timezone.utc

# ── Cooking/food timer presets (seconds) ─────────────────────────────────
COOKING_PRESETS: dict[str, int] = {
    "pasta":      600,   # 10 min
    "spaghetti":  600,
    "rice":      1080,   # 18 min
    "eggs":       360,   # 6 min soft-boiled
    "ramen":      180,   # 3 min
    "noodles":    300,   # 5 min
    "oatmeal":    300,
    "pizza":      720,   # 12 min
    "cookies":    720,
    "tea":        300,   # 5 min
    "coffee":     240,   # 4 min
    "steak":      480,   # 8 min medium
    "potato":    1200,   # 20 min
    "bread":     2100,   # 35 min
    "cake":      2400,   # 40 min
    "chicken":   1500,   # 25 min
}

# ── Alarm storage keys ────────────────────────────────────────────────────
_ALARMS_KEY = "rocky:alarms"
_LIST_KEY   = "rocky:list:{}"

# ── Critical Tools (require human-in-the-loop) ───────────────────────────
CRITICAL_TOOLS = ["execute_python", "delete_memory", "call_service"]


async def run(name: str, args: dict, sio=None, tool_call_id: str = None, bypass_auth: bool = False) -> str | dict:
    """Execute a tool by name and return the result as a string or auth status."""

    if name in CRITICAL_TOOLS and not bypass_auth:
        log.info("critical_tool_auth_required", tool=name, tool_call_id=tool_call_id)
        return {
            "status": "pending_auth",
            "tool_call_id": tool_call_id,
            "tool": name,
            "args": args,
            "message": "Esta ação requer confirmação manual",
        }

    try:
        match name:
            case "check_server_health": return _check_server_health()
            case "set_timer":           return await _set_timer(sio=sio, **args)
            case "get_weather":         return await _get_weather(**args)
            case "search_wikipedia":    return await _search_wikipedia(**args)
            case "execute_python":      return await _execute_python(**args)
            case "set_alarm":           return await _set_alarm(**args)
            case "set_reminder":        return await _set_reminder(**args)
            case "list_alarms":         return await _list_alarms()
            case "cancel_alarm":        return await _cancel_alarm(**args)
            case "add_to_list":         return await _add_to_list(**args)
            case "get_list":            return await _get_list(**args)
            case "remove_from_list":    return await _remove_from_list(**args)
            case _:
                if settings.mcp_enabled:
                    mcp_res = await mcp_bridge.call_tool(name, args)
                    if mcp_res is not None:
                        return mcp_res
                return f"Unknown tool: {name}"
    except Exception as e:
        log.error("tool_error", tool=name, error=str(e))
        return f"Tool '{name}' failed: {e}"




# ── Implementations ───────────────────────────────────────────────────────

def _check_server_health() -> str:
    """Read hardware status: CPU temp, RAM, Disk space, and memory devices."""
    temp_str = "N/A"
    try:
        if hasattr(psutil, "sensors_temperatures"):
            temps = psutil.sensors_temperatures()
            if "coretemp" in temps:
                temp_str = f"{temps['coretemp'][0].current}°C"
            elif "cpu_thermal" in temps:
                temp_str = f"{temps['cpu_thermal'][0].current}°C"
            elif temps:
                first_key = list(temps.keys())[0]
                temp_str = f"{temps[first_key][0].current}°C"
    except Exception:
        pass

    ram = psutil.virtual_memory()
    ram_usage = f"{ram.percent}% ({ram.used // 1024**2}MB / {ram.total // 1024**2}MB)"

    disks = []
    warnings = []
    for part in psutil.disk_partitions():
        if any(x in part.mountpoint for x in ["/boot", "/snap", "/loop"]):
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
            free_gb = usage.free // 1024**3
            total_gb = usage.total // 1024**3
            percent_free = (usage.free / usage.total) * 100
            disks.append(f"{part.mountpoint}: {free_gb}GB free of {total_gb}GB ({usage.percent}% used)")
            if 900 <= total_gb <= 1100 and percent_free < 10:
                warnings.append(f"Warning: Disk {part.mountpoint} (1TB) has only {percent_free:.1f}% space left.")
        except Exception:
            continue

    devices = []
    for part in psutil.disk_partitions():
        if "removable" in part.opts or "usb" in part.device.lower():
            devices.append(f"{part.device} on {part.mountpoint}")

    res = [
        "Optiplex 3040 Server Health Status:",
        f"- CPU Temperature: {temp_str}",
        f"- RAM Usage: {ram_usage}",
        "- Disk Space Overview:",
    ]
    res.extend([f"  * {d}" for d in disks])
    if devices:
        res.append("- External Devices: " + ", ".join(devices))
    if warnings:
        res.append("\nCRITICAL ALERTS:")
        res.extend([f"! {w}" for w in warnings])
        res.append("\nRocky Suggestion: Human, disk space is low. I suggest cleaning logs or temporary files soon.")

    return "\n".join(res)


async def _set_timer(
    duration_seconds: int = 0,
    label: str = "timer",
    preset: str | None = None,
    sio=None,
) -> str:
    if preset is not None:
        resolved = COOKING_PRESETS.get(preset.lower())
        if resolved is None:
            return f"Unknown preset '{preset}'. Available: {', '.join(COOKING_PRESETS)}."
        duration_seconds = resolved
        if label == "timer":
            label = preset

    if duration_seconds <= 0:
        return "Please provide a duration or a valid preset."

    label = label or "timer"

    async def _fire() -> None:
        await asyncio.sleep(duration_seconds)
        if sio:
            await sio.emit("timer_fired", {"label": label})
        log.info("timer_fired", label=label, seconds=duration_seconds)

    asyncio.create_task(_fire())

    mins, secs = divmod(duration_seconds, 60)
    hours, mins = divmod(mins, 60)
    parts: list[str] = []
    if hours: parts.append(f"{hours}h")
    if mins:  parts.append(f"{mins}m")
    if secs:  parts.append(f"{secs}s")
    human = " ".join(parts) or f"{duration_seconds}s"
    return f"Timer set: '{label}' will fire in {human}."


def _parse_datetime(datetime_iso: str) -> datetime:
    """Parse ISO datetime string and localise to configured timezone if naive."""
    dt = datetime.fromisoformat(datetime_iso)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_TZINFO)
    return dt


async def _set_alarm(datetime_iso: str, label: str = "alarm") -> str:
    redis = await get_redis()
    if redis is None:
        return "Alarm storage unavailable (Valkey not connected)."

    try:
        dt = _parse_datetime(datetime_iso)
    except ValueError:
        return f"Invalid datetime format: '{datetime_iso}'. Use YYYY-MM-DDTHH:MM:SS."

    now = datetime.now(tz=_TZINFO)
    if dt <= now:
        return "Cannot set an alarm in the past."

    alarm_id = str(uuid.uuid4())[:8]
    payload = json.dumps({
        "id": alarm_id,
        "type": "alarm",
        "label": label,
        "datetime_iso": datetime_iso,
        "message": None,
    })
    await redis.zadd(_ALARMS_KEY, {payload: dt.timestamp()})

    friendly = dt.strftime("%d %b %Y às %H:%M")
    log.info("alarm_set", label=label, at=datetime_iso)
    return f"Alarm '{label}' set for {friendly}."


async def _set_reminder(datetime_iso: str, message: str, label: str = "reminder") -> str:
    redis = await get_redis()
    if redis is None:
        return "Reminder storage unavailable (Valkey not connected)."

    try:
        dt = _parse_datetime(datetime_iso)
    except ValueError:
        return f"Invalid datetime format: '{datetime_iso}'. Use YYYY-MM-DDTHH:MM:SS."

    now = datetime.now(tz=_TZINFO)
    if dt <= now:
        return "Cannot set a reminder in the past."

    reminder_id = str(uuid.uuid4())[:8]
    payload = json.dumps({
        "id": reminder_id,
        "type": "reminder",
        "label": label,
        "datetime_iso": datetime_iso,
        "message": message,
    })
    await redis.zadd(_ALARMS_KEY, {payload: dt.timestamp()})

    friendly = dt.strftime("%d %b %Y às %H:%M")
    log.info("reminder_set", label=label, message=message, at=datetime_iso)
    return f"Reminder '{label}' set for {friendly}: \"{message}\"."


async def _list_alarms() -> str:
    redis = await get_redis()
    if redis is None:
        return "Alarm storage unavailable."

    now = time.time()
    entries = await redis.zrangebyscore(_ALARMS_KEY, now, "+inf", withscores=True)
    if not entries:
        return "No pending alarms or reminders."

    lines = []
    for raw, score in entries:
        data = json.loads(raw)
        dt_str = datetime.fromtimestamp(score, tz=_TZINFO).strftime("%d %b %Y %H:%M")
        kind = data.get("type", "alarm").capitalize()
        label = data.get("label", "?")
        msg = data.get("message")
        line = f"- [{kind}] '{label}' @ {dt_str}"
        if msg:
            line += f' — "{msg}"'
        lines.append(line)

    return "Pending alarms and reminders:\n" + "\n".join(lines)


async def _cancel_alarm(label: str) -> str:
    redis = await get_redis()
    if redis is None:
        return "Alarm storage unavailable."

    entries = await redis.zrangebyscore(_ALARMS_KEY, time.time(), "+inf")
    for raw in entries:
        data = json.loads(raw)
        if data.get("label", "").lower() == label.lower():
            await redis.zrem(_ALARMS_KEY, raw)
            kind = data.get("type", "alarm")
            log.info("alarm_cancelled", label=label, type=kind)
            return f"{kind.capitalize()} '{label}' cancelled."

    return f"No pending alarm or reminder found with label '{label}'."


async def _add_to_list(list_name: str, item: str) -> str:
    redis = await get_redis()
    if redis is None:
        return "List storage unavailable."

    key = _LIST_KEY.format(list_name.lower())
    await redis.rpush(key, item)
    count = await redis.llen(key)
    return f"Added '{item}' to {list_name} list ({count} item{'s' if count != 1 else ''} total)."


async def _get_list(list_name: str) -> str:
    redis = await get_redis()
    if redis is None:
        return "List storage unavailable."

    key = _LIST_KEY.format(list_name.lower())
    items = await redis.lrange(key, 0, -1)
    if not items:
        return f"The {list_name} list is empty."

    lines = [f"{i + 1}. {item}" for i, item in enumerate(items)]
    return f"{list_name.capitalize()} list ({len(items)} items):\n" + "\n".join(lines)


async def _remove_from_list(list_name: str, item: str) -> str:
    redis = await get_redis()
    if redis is None:
        return "List storage unavailable."

    key = _LIST_KEY.format(list_name.lower())
    # Try exact match first, then case-insensitive
    removed = await redis.lrem(key, 1, item)
    if removed:
        return f"Removed '{item}' from {list_name} list."

    # Case-insensitive fallback: scan all items
    items = await redis.lrange(key, 0, -1)
    for existing in items:
        if existing.lower() == item.lower():
            await redis.lrem(key, 1, existing)
            return f"Removed '{existing}' from {list_name} list."

    return f"'{item}' not found in {list_name} list."


async def _get_weather(city: str) -> str:
    try:
        c = await get_http_client()
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

        cur   = data.get("current", {})
        daily = data.get("daily", {})

        temp       = cur.get("temperature_2m", "?")
        feels_like = cur.get("apparent_temperature", "?")
        wind       = cur.get("wind_speed_10m", "?")
        code       = cur.get("weather_code", 0)
        desc       = _weather_code(code)

        tmax = (daily.get("temperature_2m_max") or ["?"])[0]
        tmin = (daily.get("temperature_2m_min") or ["?"])[0]
        rain = (daily.get("precipitation_sum")  or [0])[0]

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
        c = await get_http_client()
        r = await c.get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{query.replace(' ', '_')}",
            headers={"User-Agent": "ProjectHailRocky/1.0"},
        )
        if r.status_code == 404:
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
        data    = r.json()
        title   = data.get("title", query)
        extract = data.get("extract", "No summary available.")
        if len(extract) > 500:
            extract = extract[:497] + "..."
        return f"{title}: {extract}"
    except Exception as e:
        return f"Wikipedia search failed: {e}"


async def _execute_python(code: str) -> str:
    """Execute Python code in a sandboxed subprocess and return output/errors."""

    def _sandbox() -> None:
        resource.setrlimit(resource.RLIMIT_AS,     (128 * 1024 * 1024, 128 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU,    (5, 5))
        resource.setrlimit(resource.RLIMIT_NOFILE, (50, 50))
        resource.setrlimit(resource.RLIMIT_NPROC,  (0, 0))
        resource.setrlimit(resource.RLIMIT_CORE,   (0, 0))

    _sandbox_env = {
        "PATH": "/usr/bin:/bin",
        "HOME": "/tmp",
        "PYTHONDONTWRITEBYTECODE": "1",
    }

    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-c", code,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=_sandbox_env,
            preexec_fn=_sandbox,
        )

        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=5.0)
        except asyncio.TimeoutError:
            try:
                process.kill()
            except Exception:
                pass
            return "Error: Execution timed out (5s limit)."

        out = stdout.decode().strip()
        err = stderr.decode().strip()

        if process.returncode != 0:
            return f"Error (Code {process.returncode}):\n{err}"

        return out if out else "Execution successful (no output)."
    except Exception as e:
        return f"System error during execution: {str(e)}"
