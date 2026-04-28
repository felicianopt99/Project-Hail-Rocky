import asyncio
import logging
import aiohttp
import psutil
from app.core.config import settings
from app.skills.home_assistant import get_ha_entities

logger = logging.getLogger("RockyStateManager")

class StateManager:
    def __init__(self):
        self.callbacks = set()
        self.state = {
            "lights": {},
            "availableDevices": [],
            "weather": {"temp": 18, "desc": "Clear Sky", "city": settings.WEATHER_CITY},
            "system_stats": {"cpu": 0, "ram": 0, "temp": 45}
        }
        self.running = False
        self._session = None

    def add_callback(self, callback):
        self.callbacks.add(callback)

    def remove_callback(self, callback):
        if callback in self.callbacks:
            self.callbacks.remove(callback)

    async def start(self):
        if self.running:
            return
        self.running = True
        self._session = aiohttp.ClientSession()
        
        # Start background tasks
        asyncio.create_task(self._sync_loop())
        asyncio.create_task(self._stats_loop())
        asyncio.create_task(self._weather_loop())
        
        logger.info("StateManager started. Watching the pipes! Amaze!")

    async def stop(self):
        self.running = False
        if self._session:
            await self._session.close()
        logger.info("StateManager stopped. Sleep well, Friend.")

    async def _sync_loop(self):
        while self.running:
            try:
                await self.sync_ha()
            except Exception as e:
                logger.error(f"HA Sync error: {e}. Bad math!")
            await asyncio.sleep(300)

    async def _stats_loop(self):
        while self.running:
            try:
                cpu = psutil.cpu_percent()
                mem = psutil.virtual_memory()
                stats = {
                    "cpu": cpu,
                    "ram": round(mem.used / (1024**3), 1),
                    "totalRam": round(mem.total / (1024**3), 1),
                    "temp": 45 # TODO: Get actual temp
                }
                self.state["system_stats"] = stats
                await self._broadcast_update("stats_updated", stats)
            except Exception as e:
                logger.error(f"Stats loop error: {e}")
            await asyncio.sleep(2)

    async def _weather_loop(self):
        while self.running:
            try:
                await self.sync_weather()
            except Exception as e:
                logger.error(f"Weather loop error: {e}")
            await asyncio.sleep(600)

    async def sync_ha(self):
        # NOTE: get_ha_entities should ideally be async too. 
        # For now, we'll run it in a thread if it's sync, or refactor it.
        entities = await get_ha_entities()
        if not entities:
            return

        new_lights = {}
        for e in entities:
            entity_id = e["entity_id"]
            
            # Skip redundant remote access switches
            if entity_id.endswith("_remote_access") and entity_id.startswith("switch."):
                continue
                
            attrs = e.get("attributes", {})
            friendly_name = attrs.get("friendly_name", entity_id.split(".")[1].replace("_", " ").title())
            
            # Convert mireds to kelvin if necessary
            color_temp = attrs.get("color_temp_kelvin")
            if not color_temp and attrs.get("color_temp"):
                color_temp = 1000000 // attrs["color_temp"]
                
            new_lights[entity_id] = {
                "name": friendly_name,
                "status": "off" if e["state"] in ["off", "unavailable", "unknown"] else "on",
                "brightness": round(attrs.get("brightness", 255) / 2.55) if e["state"] == "on" else 0,
                "color": "#ffffff",
                "color_temp_kelvin": color_temp,
                "min_color_temp_kelvin": attrs.get("min_color_temp_kelvin") or (1000000 // attrs["max_mireds"]) if attrs.get("max_mireds") else 2000,
                "max_color_temp_kelvin": attrs.get("max_color_temp_kelvin") or (1000000 // attrs["min_mireds"]) if attrs.get("min_mireds") else 6500,
            }
        
        self.state["lights"] = new_lights
        # Use full entity IDs for precision, but show friendly names in UI
        self.state["availableDevices"] = [{"id": id, "name": data["name"]} for id, data in new_lights.items()]
        await self._broadcast_update("state_synced", self.state)

    async def sync_weather(self):
        url = f"https://api.open-meteo.com/v1/forecast?latitude={settings.WEATHER_LAT}&longitude={settings.WEATHER_LON}&current=temperature_2m,weather_code&timezone=auto"
        
        try:
            async with self._session.get(url, timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.state["weather"]["temp"] = round(data["current"]["temperature_2m"])
                    await self._broadcast_update("weather_updated", self.state["weather"])
                else:
                    logger.warning(f"Weather API returned status {resp.status}")
        except Exception as e:
            logger.error(f"Weather sync failed: {e}. Bad math!")

    async def _broadcast_update(self, event_type, data):
        if not self.callbacks:
            return
        
        msg = {"type": "state_sync", "event": event_type, "data": data}
        for callback in list(self.callbacks):
            try:
                await callback(msg)
            except Exception as e:
                logger.error(f"Failed to broadcast: {e}. Removing callback.")
                self.remove_callback(callback)

state_manager = StateManager()
