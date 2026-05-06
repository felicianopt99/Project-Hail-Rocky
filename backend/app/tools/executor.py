import ast
import asyncio
import math
import operator
import time
import subprocess
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
import psutil
import structlog


from ..config import settings

log = structlog.get_logger()

_TZ = settings.timezone
try:
    _TZINFO = ZoneInfo(_TZ)
except ZoneInfoNotFoundError:
    _TZINFO = timezone.utc


# ── Critical Tools (require human-in-the-loop) ──────────────────────────
CRITICAL_TOOLS = ["execute_python", "delete_memory", "call_service"]


async def run(name: str, args: dict, sio=None, tool_call_id: str = None, bypass_auth: bool = False) -> str | dict:
    """Execute a tool by name and return the result as a string or auth status."""
    
    # Check for authorization if tool is critical and not already bypassed
    if name in CRITICAL_TOOLS and not bypass_auth:
        log.info("critical_tool_auth_required", tool=name, tool_call_id=tool_call_id)
        return {
            "status": "pending_auth",
            "tool_call_id": tool_call_id,
            "tool": name,
            "args": args,
            "message": "Esta ação requer confirmação manual"
        }

    try:
        match name:
            case "check_server_health": return _check_server_health()
            case "set_timer":          return await _set_timer(sio=sio, **args)
            case "get_weather":        return await _get_weather(**args)
            case "search_wikipedia":   return await _search_wikipedia(**args)
            case "execute_python":     return await _execute_python(**args)
            case _:
                # If tool is not built-in, try proxying to configured MCP servers
                if settings.ha_mcp_url:
                    mcp_res = await _proxy_mcp_call(settings.ha_mcp_url, name, args)
                    if mcp_res is not None:
                        return mcp_res
                
                return f"Unknown tool: {name}"
    except Exception as e:
        log.error("tool_error", tool=name, error=str(e))
        return f"Tool '{name}' failed: {e}"


async def _proxy_mcp_call(mcp_url: str, name: str, args: dict) -> str | None:
    """
    Proxy a tool call to an MCP server using the streamable_http protocol.
    Returns the result string or None if the tool is not found on this server.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            url = f"{mcp_url.rstrip('/')}/call"
            payload = {"name": name, "arguments": args}
            r = await client.post(url, json=payload)
            
            if r.status_code == 200:
                data = r.json()
                # MCP 'call' response usually has a 'content' list of blocks
                content = data.get("content", [])
                text_results = [c.get("text", "") for c in content if c.get("type") == "text"]
                return "\n".join(text_results) if text_results else str(data)
            
            if r.status_code == 404:
                return None
                
            return f"Error from MCP server: {r.status_code} - {r.text}"
    except Exception as e:
        log.debug("mcp_proxy_attempt_failed", url=mcp_url, tool=name, error=str(e))
        return None


# ── Implementations ───────────────────────────────────────────────────────

def _check_server_health() -> str:
    """Read hardware status: CPU temp, RAM, Disk space, and memory devices."""
    # 1. CPU Temp
    temp_str = "N/A"
    try:
        if hasattr(psutil, "sensors_temperatures"):
            temps = psutil.sensors_temperatures()
            if "coretemp" in temps:
                temp_str = f"{temps['coretemp'][0].current}°C"
            elif "cpu_thermal" in temps:
                temp_str = f"{temps['cpu_thermal'][0].current}°C"
            elif temps:
                # Try the first available sensor
                first_key = list(temps.keys())[0]
                temp_str = f"{temps[first_key][0].current}°C"
    except:
        pass
    
    # 2. RAM
    ram = psutil.virtual_memory()
    ram_usage = f"{ram.percent}% ({ram.used // 1024**2}MB / {ram.total // 1024**2}MB)"
    
    # 3. Disks & Warnings
    disks = []
    warnings = []
    for part in psutil.disk_partitions():
        # Skip virtual/temp filesystems
        if any(x in part.mountpoint for x in ["/boot", "/snap", "/loop"]):
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
            free_gb = usage.free // 1024**3
            total_gb = usage.total // 1024**3
            percent_free = (usage.free / usage.total) * 100
            
            disks.append(f"{part.mountpoint}: {free_gb}GB free of {total_gb}GB ({usage.percent}% used)")
            
            # Warning logic for 1TB disks (< 10% free)
            if 900 <= total_gb <= 1100 and percent_free < 10:
                warnings.append(f"Warning: Disk {part.mountpoint} (1TB) has only {percent_free:.1f}% space left.")
        except:
            continue
            
    # 4. Connected Memory Devices (simplified list)
    devices = []
    for part in psutil.disk_partitions():
        if "removable" in part.opts or "usb" in part.device.lower():
            devices.append(f"{part.device} on {part.mountpoint}")

    # Build response
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


async def _execute_python(code: str) -> str:
    """Execute Python code in a subprocess and return output/errors."""
    try:
        # Use asyncio.create_subprocess_exec for non-blocking execution
        process = await asyncio.create_subprocess_exec(
            "python3", "-c", code,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=5.0)
        except asyncio.TimeoutError:
            try:
                process.kill()
            except:
                pass
            return "Error: Execution timed out (5s limit)."
            
        out = stdout.decode().strip()
        err = stderr.decode().strip()
        
        if process.returncode != 0:
            return f"Error (Code {process.returncode}):\n{err}"
            
        return out if out else "Execution successful (no output)."
    except Exception as e:
        return f"System error during execution: {str(e)}"
