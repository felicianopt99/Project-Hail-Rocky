from typing import Any, Dict, List, Optional
import httpx
from app.core.plugins.base import BasePlugin

class HomeAssistantPlugin(BasePlugin):
    """
    Real implementation of Home Assistant integration.
    Uses HA REST API with the credentials from global settings.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # We'll use the central settings as the single source of truth for core HA config
        # but we can also have plugin-specific settings if needed.
        from app.config import settings
        self.base_url = settings.ha_base_url.rstrip("/")
        self.token = settings.ha_access_token
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        self.entities: List[Dict[str, Any]] = []

    async def initialize(self) -> None:
        await super().initialize()
        if not self.base_url or not self.token:
            self.log.warning("ha_credentials_missing", base_url=bool(self.base_url), token=bool(self.token))
        else:
            await self.sync_entities()

    async def sync_entities(self) -> None:
        """Fetch all entities from HA and store them locally."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(f"{self.base_url}/api/states", headers=self.headers)
                r.raise_for_status()
                self.entities = r.json()
                self.log.info("ha_sync_complete", count=len(self.entities))
        except Exception as e:
            self.log.error("ha_sync_failed", error=str(e))

    async def get_tools(self) -> List[Dict[str, Any]]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "get_home_assistant_overview",
                    "description": "Get a summary of currently active or important entities in Home Assistant (e.g., lights that are ON, climate status).",
                    "parameters": {
                        "type": "object",
                        "properties": {}
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "list_home_assistant_entities",
                    "description": "List available Home Assistant entities (lights, switches, sensors, etc.). Use this to discover device IDs.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {
                                "type": "string",
                                "description": "Optional domain to filter (e.g., 'light', 'switch', 'climate')."
                            }
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "call_home_assistant_service",
                    "description": "Call a service in Home Assistant to control devices (e.g., toggle lights, set temperature).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "domain": {
                                "type": "string",
                                "description": "The domain of the service (e.g., 'light', 'switch', 'media_player')."
                            },
                            "service": {
                                "type": "string",
                                "description": "The service name (e.g., 'turn_on', 'turn_off', 'toggle')."
                            },
                            "entity_id": {
                                "type": "string",
                                "description": "The target entity ID (e.g., 'light.living_room')."
                            },
                            "data": {
                                "type": "object",
                                "description": "Optional extra data for the service (e.g., brightness: 255)."
                            }
                        },
                        "required": ["domain", "service", "entity_id"]
                    }
                }
            }
        ]

    async def execute_tool(self, name: str, args: Dict[str, Any]) -> Any:
        if name == "get_home_assistant_overview":
            return await self._get_overview()
        elif name == "list_home_assistant_entities":
            return await self._list_entities(args.get("domain"))
        elif name == "call_home_assistant_service":
            return await self._call_service(
                args["domain"], 
                args["service"], 
                args["entity_id"], 
                args.get("data", {})
            )
        return f"Unknown tool: {name}"

    async def _get_overview(self) -> str:
        """Return a curated overview of the home state."""
        if not self.entities:
            await self.sync_entities()
        
        on_entities = []
        for s in self.entities:
            if s["state"] not in ["off", "unavailable", "unknown", "idle"]:
                entity_id = s["entity_id"]
                domain = entity_id.split(".")[0]
                if domain in ["light", "switch", "media_player", "climate"]:
                    name = s.get("attributes", {}).get("friendly_name", entity_id)
                    on_entities.append(f"- {name} is {s['state']}")
        
        if not on_entities:
            return "All major devices are currently off or idle."
        
        return "Current active devices:\n" + "\n".join(on_entities[:20])

    async def _list_entities(self, domain_filter: Optional[str] = None) -> str:
        """List entities, either from cache or by fetching fresh states."""
        # If we have a filter, maybe we want fresh data
        if not self.entities:
            await self.sync_entities()
        
        states = self.entities
        
        # Excluded entities from config
        excluded = self.config.get("excluded_entities", [])
        
        filtered = []
        for s in states:
            entity_id = s["entity_id"]
            if entity_id in excluded:
                continue
            if domain_filter and not entity_id.startswith(f"{domain_filter}."):
                continue
            
            friendly_name = s.get("attributes", {}).get("friendly_name", entity_id)
            state = s["state"]
            filtered.append(f"- {friendly_name} (`{entity_id}`): {state}")
        
        if not filtered:
            return f"No entities found{f' in domain {domain_filter}' if domain_filter else ''}."
        
        return "\n".join(filtered[:50])

    async def _call_service(self, domain: str, service: str, entity_id: str, data: Dict[str, Any]) -> str:
        try:
            payload = {"entity_id": entity_id, **data}
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(
                    f"{self.base_url}/api/services/{domain}/{service}",
                    headers=self.headers,
                    json=payload
                )
                r.raise_for_status()
                return f"Successfully called {domain}.{service} for {entity_id}."
        except Exception as e:
            self.log.error("ha_service_call_failed", tool=f"{domain}.{service}", entity=entity_id, error=str(e))
            return f"Failed to control {entity_id}: {e}"
