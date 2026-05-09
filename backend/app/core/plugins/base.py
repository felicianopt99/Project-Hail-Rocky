from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
import structlog
from .schema import PluginManifest, PluginConfig

log = structlog.get_logger()

class BasePlugin(ABC):
    """
    Abstract Base Class for all Project-Hail-Rocky plugins.
    Each plugin should reside in its own directory within /plugins.
    """
    
    def __init__(self, manifest: PluginManifest, config: PluginConfig):
        self.manifest = manifest
        self.config = config
        self.id = manifest.metadata.id
        self.log = log.bind(plugin_id=self.id)
        self._is_initialized = False

    async def initialize(self) -> None:
        """Lifecycle method called when the plugin is loaded."""
        self.log.info("plugin_initializing")
        self._is_initialized = True

    async def shutdown(self) -> None:
        """Lifecycle method called when the system is shutting down or plugin is disabled."""
        self.log.info("plugin_shutting_down")
        self._is_initialized = False

    @abstractmethod
    async def get_tools(self) -> List[Dict[str, Any]]:
        """
        Returns a list of tool definitions in OpenAI function calling format.
        Example:
            return [{
                "type": "function",
                "function": {
                    "name": "my_tool",
                    "description": "Does something cool",
                    "parameters": { ... }
                }
            }]
        """
        pass

    @abstractmethod
    async def execute_tool(self, name: str, args: Dict[str, Any]) -> Any:
        """
        Executes a tool by name with the provided arguments.
        """
        pass

    def get_setting(self, key: str, default: Any = None) -> Any:
        """Helper to safely retrieve a setting from the plugin configuration."""
        return self.config.settings.get(key, default)
