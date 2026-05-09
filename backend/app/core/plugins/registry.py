from typing import Dict, Optional
from .base import BasePlugin

class PluginRegistry:
    """A simple global registry for active plugin instances."""
    
    def __init__(self):
        self._plugins: Dict[str, BasePlugin] = {}
        self._tool_map: Dict[str, str] = {}  # tool_name -> plugin_id

    async def register(self, plugin: BasePlugin) -> None:
        self._plugins[plugin.id] = plugin
        # Pre-cache tool mappings
        tools = await plugin.get_tools()
        for tool in tools:
            tool_name = tool["function"]["name"]
            self._tool_map[tool_name] = plugin.id

    def unregister(self, plugin_id: str) -> None:
        if plugin_id in self._plugins:
            # Remove from tool map
            to_remove = [k for k, v in self._tool_map.items() if v == plugin_id]
            for k in to_remove:
                del self._tool_map[k]
            del self._plugins[plugin_id]

    def get_plugin_by_tool(self, tool_name: str) -> Optional[BasePlugin]:
        plugin_id = self._tool_map.get(tool_name)
        if plugin_id:
            return self._plugins.get(plugin_id)
        return None

    def get_plugin(self, plugin_id: str) -> Optional[BasePlugin]:
        return self._plugins.get(plugin_id)

    def list_plugins(self) -> Dict[str, BasePlugin]:
        return self._plugins.copy()

# Global instance
plugin_registry = PluginRegistry()
