import logging
import httpx
from app.core.config import settings
# from vision_agents import tool

logger = logging.getLogger("RockySkills-HA")

NAMED_COLORS = {
    "red":     [255, 0,   0  ],
    "green":   [0,   200, 0  ],
    "blue":    [0,   0,   255],
    "yellow":  [255, 255, 0  ],
    "orange":  [255, 120, 0  ],
    "purple":  [130, 0,   180],
    "pink":    [255, 100, 150],
    "white":   [255, 255, 255],
    "cyan":    [0,   220, 255],
    "magenta": [255, 0,   220],
}

def hex_to_rgb(hex_str):
    hex_str = hex_str.lstrip("#")
    if len(hex_str) != 6:
        return None
    return [int(hex_str[i:i+2], 16) for i in (0, 2, 4)]

async def get_ha_entities():
    if not settings.HA_BASE_URL or not settings.HA_ACCESS_TOKEN:
        return []
    
    try:
        logger.info(f"Fetching HA entities from {settings.HA_BASE_URL}...")
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{settings.HA_BASE_URL}/api/states",
                headers={"Authorization": f"Bearer {settings.HA_ACCESS_TOKEN}"},
                timeout=5
            )
            response.raise_for_status()
            states = response.json()
            logger.info(f"Successfully fetched {len(states)} entities from HA.")
            
            supported_domains = ["light.", "switch.", "fan.", "input_boolean.", "media_player."]
            filtered = [s for s in states if any(s["entity_id"].startswith(d) for d in supported_domains)]
            logger.info(f"Found {len(filtered)} supported entities: {[e['entity_id'] for e in filtered]}")
            return filtered
    except Exception as e:
        logger.error(f"Error fetching HA entities: {e}. Bad math!")
        return []

async def control_entity(device, action, brightness=None, color=None, color_temp_kelvin=None):
    if not settings.HA_BASE_URL or not settings.HA_ACCESS_TOKEN:
        return {"success": False, "error": "Home Assistant not configured"}

    entity_id = device
    if not any(device.startswith(d) for d in ["light.", "switch.", "fan.", "input_boolean.", "media_player."]):
        entities = await get_ha_entities()
        normalized = device.lower().replace(" ", "_")
        match = next((e["entity_id"] for e in entities if normalized in e["entity_id"].lower() or normalized in e.get("attributes", {}).get("friendly_name", "").lower()), None)
        if match:
            entity_id = match
        else:
            return {"success": False, "error": f"Device '{device}' not found"}

    domain = entity_id.split(".")[0]
    
    # Mapping actions to HA services
    if action == "on" or action == "set":
        if action == "set" and brightness == 0:
            service = "turn_off"
        else:
            service = "turn_on"
    elif action == "off":
        service = "turn_off"
    else:
        service = "toggle"
        
    payload = {"entity_id": entity_id}
    
    if (action == "on" or action == "set") and domain == "light":
        if brightness is not None:
            payload["brightness_pct"] = brightness
        if color_temp_kelvin is not None:
            payload["color_temp_kelvin"] = color_temp_kelvin
        elif color:
            rgb = NAMED_COLORS.get(color.lower()) or hex_to_rgb(color)
            if rgb:
                payload["rgb_color"] = rgb

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{settings.HA_BASE_URL}/api/services/{domain}/{service}",
                headers={"Authorization": f"Bearer {settings.HA_ACCESS_TOKEN}"},
                json=payload,
                timeout=5
            )
            response.raise_for_status()
            return {"success": True, "device": entity_id, "action": action}
    except Exception as e:
        logger.error(f"Error controlling HA entity {entity_id}: {e}")
        return {"success": False, "error": str(e)}

# @tool
async def light_control(device: str, action: str, brightness: int = None, color: str = None) -> str:
    """
    Control lights and switches in the home.
    - device: The name of the light or room (e.g., 'studio', 'living room', 'all').
    - action: 'on', 'off', or 'toggle'.
    - brightness: Optional brightness level from 0 to 100.
    - color: Optional color name or hex code.
    """
    result = await control_entity(device, action, brightness, color)
    if result["success"]:
        return f"Confirmed! Turned {action} {result['device']}. Amaze!"
    return f"Bad math! Could not control {device}: {result.get('error')}. Fist-bump?"
