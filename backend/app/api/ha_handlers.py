"""
Socket.io handlers for Home Assistant device control, protocols, and routines.
Registered alongside chat handlers in socketio_handlers.register().
"""
import asyncio
import json
import psutil
import structlog
import socketio

from ..bridges import ha_bridge
from ..core.redis_client import get_redis

log = structlog.get_logger()

# ── Defaults ──────────────────────────────────────────────────────────────

_DEFAULT_PROTOCOLS = [
    {"id": "cinema",  "label": "Cinema",    "description": "Dim, immersive",    "icon": "Film",    "color": "text-blue-400",   "settings": {"brightness": 15,  "speed": 1000, "color": "#001133", "targetLights": []}},
    {"id": "music",   "label": "Music",     "description": "Dynamic colors",    "icon": "Music2",  "color": "text-pink-400",   "settings": {"brightness": 80,  "speed": 300,  "color": "#ff00cc", "targetLights": []}},
    {"id": "sunset",  "label": "Sunset",    "description": "Warm gradient",     "icon": "Sunset",  "color": "text-amber-400",  "settings": {"brightness": 60,  "speed": 800,  "color": "#ff8800", "targetLights": []}},
    {"id": "focus",   "label": "Focus",     "description": "Cool white, full",  "icon": "Zap",     "color": "text-cyan-400",   "settings": {"brightness": 100, "speed": 500,  "color": "#e0f0ff", "targetLights": []}},
    {"id": "night",   "label": "Night",     "description": "Dim warm red",      "icon": "Moon",    "color": "text-red-400",    "settings": {"brightness": 5,   "speed": 2000, "color": "#330000", "targetLights": []}},
]

_DEFAULT_ROUTINES = [
    {"id": "home",  "label": "I'm Home",     "icon": "Home",        "color": "text-cyan-400",   "actions": [{"device": "all", "action": "on",  "params": {"brightness": 70, "color": "#ffaa66"}}]},
    {"id": "away",  "label": "Leaving Home", "icon": "ShieldCheck", "color": "text-red-400",    "actions": [{"device": "all", "action": "off", "params": {}}]},
    {"id": "night", "label": "Good Night",   "icon": "Moon",        "color": "text-purple-400", "actions": [{"device": "all", "action": "on",  "params": {"brightness": 5,  "color": "#220033"}}]},
    {"id": "party", "label": "Party Mode",   "icon": "Music",       "color": "text-pink-400",   "actions": [{"device": "all", "action": "on",  "params": {"brightness": 100, "color": "#ff00cc"}}]},
]


# ── Redis helpers ─────────────────────────────────────────────────────────

async def _load_protocols() -> list:
    redis = await get_redis()
    if redis:
        try:
            raw = await redis.get("rocky:protocols")
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    return list(_DEFAULT_PROTOCOLS)


async def _save_protocols(protocols: list) -> None:
    redis = await get_redis()
    if redis:
        try:
            await redis.set("rocky:protocols", json.dumps(protocols))
        except Exception:
            pass


async def _load_routines() -> list:
    redis = await get_redis()
    if redis:
        try:
            raw = await redis.get("rocky:routines")
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    return list(_DEFAULT_ROUTINES)


async def _save_routines(routines: list) -> None:
    redis = await get_redis()
    if redis:
        try:
            await redis.set("rocky:routines", json.dumps(routines))
        except Exception:
            pass


# ── Initial state push ────────────────────────────────────────────────────

async def push_initial_state(sid: str, sio: socketio.AsyncServer) -> None:
    try:
        lights, areas, protocols = await asyncio.gather(
            ha_bridge.get_lights(),
            ha_bridge.get_areas(),
            _load_protocols(),
            return_exceptions=True,
        )
        # Replace any exceptions with safe empty values
        if isinstance(lights, Exception):    lights = {}
        if isinstance(areas, Exception):     areas = {}
        if isinstance(protocols, Exception): protocols = list(_DEFAULT_PROTOCOLS)

        await sio.emit("system_state_update", {
            "lights": lights,
            "areas": areas,
            "protocols": protocols,
        }, to=sid)
    except Exception as e:
        log.warning("push_initial_state_failed", sid=sid, error=str(e))
        # Still send protocols so UI isn't empty
        await sio.emit("system_state_update", {
            "lights": {}, "areas": {}, "protocols": list(_DEFAULT_PROTOCOLS),
        }, to=sid)


# ── Background metrics loop ───────────────────────────────────────────────

async def metrics_loop(sio: socketio.AsyncServer) -> None:
    while True:
        await asyncio.sleep(5)
        try:
            cpu = psutil.cpu_percent(interval=0.1)
            mem = psutil.virtual_memory()
            temps = {}
            try:
                raw = psutil.sensors_temperatures()
                for entries in (raw or {}).values():
                    if entries:
                        temps["t"] = entries[0].current
                        break
            except Exception:
                pass
            await sio.emit("stats_updated", {
                "cpu": round(cpu, 1),
                "ram": round(mem.percent, 1),
                "totalRam": round(mem.total / (1024 ** 3), 1),
                "temp": round(temps.get("t", 0.0), 1),
            })
        except Exception as e:
            log.warning("metrics_loop_error", error=str(e))


# ── Handler registration ──────────────────────────────────────────────────

def register(sio: socketio.AsyncServer) -> None:

    @sio.event
    async def control_device(sid: str, data: dict):
        device = data.get("device", "")
        action = data.get("action", "toggle")
        params = data.get("params") or {}

        if device == "all":
            await ha_bridge.control_all_lights(action)
            # Push refreshed state to all clients
            lights = await ha_bridge.get_lights()
            await sio.emit("system_state_update", {"lights": lights})
            return

        await ha_bridge.control_light(device, action, params)

        # Push updated state of this specific light back to all clients
        updated = await ha_bridge.get_light_state(device)
        if updated:
            await sio.emit("device_updated", {"device": device, "state": updated})

    @sio.event
    async def sync_ha(sid: str, data=None):
        lights, areas = await asyncio.gather(
            ha_bridge.get_lights(),
            ha_bridge.get_areas(),
        )
        await sio.emit("system_state_update", {"lights": lights, "areas": areas}, to=sid)
        log.info("ha_synced", sid=sid, lights=len(lights))

    @sio.event
    async def set_mode(sid: str, mode_id: str):
        # Try as HA scene first; always emit mode_updated so frontend transitions
        protocols = await _load_protocols()
        protocol = next((p for p in protocols if p["id"] == mode_id), None)
        if protocol:
            targets = protocol["settings"].get("targetLights") or []
            brightness = protocol["settings"].get("brightness", 100)
            color = protocol["settings"].get("color", "#ffffff")
            for entity in targets:
                await ha_bridge.control_light(entity, "set", {"brightness": brightness, "color": color})
        await sio.emit("mode_updated", mode_id)

    @sio.event
    async def get_routines(sid: str, data=None):
        routines = await _load_routines()
        await sio.emit("routines_list", routines, to=sid)

    @sio.event
    async def execute_routine(sid: str, routine_id: str):
        routines = await _load_routines()
        routine = next((r for r in routines if r["id"] == routine_id), None)
        if not routine:
            return
        for action in routine.get("actions", []):
            device = action.get("device", "all")
            act = action.get("action", "on")
            params = action.get("params", {})
            if device == "all":
                await ha_bridge.control_all_lights(act)
            else:
                await ha_bridge.control_light(device, act, params)
        lights = await ha_bridge.get_lights()
        await sio.emit("system_state_update", {"lights": lights})
        log.info("routine_executed", routine=routine_id)

    @sio.event
    async def create_protocol(sid: str, data: dict):
        protocols = await _load_protocols()
        protocols.append(data)
        await _save_protocols(protocols)
        await sio.emit("protocol_created", data)

    @sio.event
    async def save_protocol(sid: str, data: dict):
        protocol_id = data.get("id")
        new_settings = data.get("settings", {})
        protocols = await _load_protocols()
        updated = None
        for p in protocols:
            if p["id"] == protocol_id:
                p["settings"] = {**p.get("settings", {}), **new_settings}
                updated = p
                break
        if updated:
            await _save_protocols(protocols)
            await sio.emit("protocol_updated", {"id": protocol_id, "settings": updated["settings"]})

    @sio.event
    async def delete_protocol(sid: str, data: dict):
        protocol_id = data.get("id")
        protocols = await _load_protocols()
        protocols = [p for p in protocols if p["id"] != protocol_id]
        await _save_protocols(protocols)
        await sio.emit("protocol_deleted", {"id": protocol_id})

    @sio.event
    async def add_log(sid: str, message: str):
        import time
        await sio.emit("new_log", {"timestamp": int(time.time() * 1000), "message": message})
