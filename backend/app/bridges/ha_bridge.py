"""
Home Assistant REST API bridge.

Rocky never speaks directly to devices — all physical actions go through HA.
Docs: https://developers.home-assistant.io/docs/api/rest/
"""
import httpx
import structlog

from ..config import settings

log = structlog.get_logger()

_TIMEOUT = httpx.Timeout(5.0, connect=3.0)

# Singleton client — reuses TCP connections for all HA API calls
_client: httpx.AsyncClient | None = None


def _get_ha_client() -> httpx.AsyncClient:
    """Return (and lazily create) the shared HA HTTP client."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=_TIMEOUT,
            headers={
                "Authorization": f"Bearer {settings.ha_access_token}",
                "Content-Type": "application/json",
            },
        )
    return _client


def _url(path: str) -> str:
    return f"{settings.ha_base_url.rstrip('/')}/api{path}"



def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return (255, 255, 255)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _rgb_to_hex(rgb: list) -> str:
    try:
        return "#{:02x}{:02x}{:02x}".format(int(rgb[0]), int(rgb[1]), int(rgb[2]))
    except Exception:
        return "#ffffff"


# ── Availability ──────────────────────────────────────────────────────────

async def is_available() -> bool:
    if not settings.ha_base_url or not settings.ha_access_token:
        return False
    try:
        c = _get_ha_client()
        r = await c.get(_url("/"))
        return r.status_code == 200
    except Exception:
        return False


# ── State fetching ────────────────────────────────────────────────────────

async def get_lights() -> dict[str, dict]:
    """Return {entity_id: LightState} for all light entities."""
    if not settings.ha_base_url:
        return {}
    try:
        c = _get_ha_client()
        r = await c.get(_url("/states"))
        r.raise_for_status()
        states = r.json()
    except Exception as e:
        log.warning("ha_get_lights_failed", error=str(e))
        return {}

    lights: dict[str, dict] = {}
    for entity in states:
        eid = entity.get("entity_id", "")
        if not eid.startswith("light."):
            continue
        attrs = entity.get("attributes", {})
        state = entity.get("state", "off")

        # Brightness: HA returns 0-255, we use 0-100
        raw_brightness = attrs.get("brightness", 0) or 0
        brightness = round(raw_brightness / 2.55)

        # Color
        rgb = attrs.get("rgb_color")
        color = _rgb_to_hex(rgb) if rgb else "#ffffff"

        lights[eid] = {
            "name": attrs.get("friendly_name", eid.split(".", 1)[-1].replace("_", " ").title()),
            "status": state,
            "brightness": brightness,
            "color": color,
            "color_temp_kelvin": attrs.get("color_temp_kelvin"),
            "min_color_temp_kelvin": attrs.get("min_color_temp_kelvin"),
            "max_color_temp_kelvin": attrs.get("max_color_temp_kelvin"),
        }
    return lights


async def get_areas() -> dict[str, str]:
    """Return {area_id: area_name} via HA config/area_registry API."""
    if not settings.ha_base_url:
        return {}
    try:
        c = _get_ha_client()
        r = await c.get(_url("/config/area_registry"))
        r.raise_for_status()
        return {a["area_id"]: a["name"] for a in r.json()}
    except Exception as e:
        log.warning("ha_get_areas_failed", error=str(e))
        return {}


# ── Light control ─────────────────────────────────────────────────────────

async def control_light(entity_id: str, action: str, params: dict | None = None) -> bool:
    """
    action: "on" | "off" | "toggle" | "set"
    params: { brightness?: 0-100, color?: "#rrggbb", color_temp_kelvin?: int }
    """
    if not settings.ha_base_url:
        return False

    params = params or {}

    # Map action to HA service
    if action in ("off",):
        service = "turn_off"
        payload: dict = {"entity_id": entity_id}
    elif action in ("toggle",):
        service = "toggle"
        payload = {"entity_id": entity_id}
    else:
        # "on" or "set"
        service = "turn_on"
        payload = {"entity_id": entity_id}
        if "brightness" in params:
            payload["brightness_pct"] = int(params["brightness"])
        if "color" in params:
            payload["rgb_color"] = list(_hex_to_rgb(params["color"]))
        if "color_temp_kelvin" in params:
            payload["color_temp_kelvin"] = int(params["color_temp_kelvin"])

    try:
        c = _get_ha_client()
        r = await c.post(
            _url(f"/services/light/{service}"),
            json=payload,
        )
        r.raise_for_status()
        log.info("ha_light_ok", entity=entity_id, action=action)
        return True
    except Exception as e:
        log.error("ha_light_failed", entity=entity_id, action=action, error=str(e))
        return False


async def control_all_lights(action: str) -> bool:
    """Turn all lights on or off using HA's domain-level service call."""
    if not settings.ha_base_url:
        return False
    service = "turn_on" if action == "on" else "turn_off"
    try:
        c = _get_ha_client()
        # Omitting entity_id targets ALL entities of the light domain
        r = await c.post(
            _url(f"/services/light/{service}"),
            json={},
        )
        r.raise_for_status()
        log.info("ha_all_lights", action=action)
        return True
    except Exception as e:
        log.error("ha_all_lights_failed", action=action, error=str(e))
        return False


async def activate_scene(scene_id: str) -> bool:
    """Activate an HA scene by entity_id (e.g. scene.cinema_mode)."""
    if not settings.ha_base_url:
        return False
    try:
        c = _get_ha_client()
        r = await c.post(
            _url("/services/scene/turn_on"),
            json={"entity_id": scene_id},
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log.error("ha_scene_failed", scene=scene_id, error=str(e))
        return False


async def get_light_state(entity_id: str) -> dict | None:
    """Fetch current state of a single light."""
    if not settings.ha_base_url:
        return None
    try:
        c = _get_ha_client()
        r = await c.get(_url(f"/states/{entity_id}"))
        r.raise_for_status()
        entity = r.json()
        attrs = entity.get("attributes", {})
        raw_b = attrs.get("brightness", 0) or 0
        rgb = attrs.get("rgb_color")
        return {
            "name": attrs.get("friendly_name", entity_id),
            "status": entity.get("state", "off"),
            "brightness": round(raw_b / 2.55),
            "color": _rgb_to_hex(rgb) if rgb else "#ffffff",
            "color_temp_kelvin": attrs.get("color_temp_kelvin"),
            "min_color_temp_kelvin": attrs.get("min_color_temp_kelvin"),
            "max_color_temp_kelvin": attrs.get("max_color_temp_kelvin"),
        }

    except Exception as e:
        log.warning("ha_get_state_failed", entity=entity_id, error=str(e))
        return None
