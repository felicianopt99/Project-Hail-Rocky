import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Type, Any

import structlog
from .base import BasePlugin
from .schema import PluginManifest, PluginConfig, PluginMetadata
from .registry import plugin_registry
from ...config import settings

log = structlog.get_logger()

class PluginManager:
    """Manages the lifecycle of plugins: discovery, loading, and registration."""
    
    def __init__(self, plugins_dir: str = "backend/plugins"):
        self.plugins_dir = Path(plugins_dir).absolute()
        self.log = log.bind(plugins_dir=str(self.plugins_dir))

    async def discover_and_load(self) -> None:
        """Scans the plugins directory and loads all valid plugins."""
        if not self.plugins_dir.exists():
            self.log.warning("plugins_dir_not_found")
            return

        for plugin_folder in self.plugins_dir.iterdir():
            if plugin_folder.is_dir():
                try:
                    await self._load_plugin(plugin_folder)
                except Exception as e:
                    self.log.error("plugin_load_failed", folder=plugin_folder.name, error=str(e))

    async def _load_plugin(self, folder: Path) -> None:
        manifest_path = folder / "manifest.json"
        if not manifest_path.exists():
            self.log.debug("skip_folder_no_manifest", folder=folder.name)
            return

        # Load manifest
        with open(manifest_path, "r") as f:
            manifest_data = json.load(f)
        
        manifest = PluginManifest(**manifest_data)
        if not manifest.enabled:
            self.log.info("plugin_disabled_by_manifest", plugin_id=manifest.metadata.id)
            return

        # Import entry point
        entry_point = folder / manifest.entry_point
        if not entry_point.exists():
            self.log.error("entry_point_not_found", plugin_id=manifest.metadata.id, path=str(entry_point))
            return

        # Dynamic import
        plugin_class = self._import_plugin_class(manifest.metadata.id, entry_point)
        if not plugin_class:
            return

        # Instantiate (Using default config for now, could be loaded from DB/Settings)
        # TODO: Load actual config from persistent storage
        config = PluginConfig(enabled=True, settings={})
        
        plugin_instance = plugin_class(manifest=manifest, config=config)
        await plugin_instance.initialize()
        
        # Register
        await plugin_registry.register(plugin_instance)
        self.log.info("plugin_loaded_successfully", plugin_id=manifest.metadata.id, version=manifest.metadata.version)


    def _import_plugin_class(self, plugin_id: str, file_path: Path) -> Optional[Type[BasePlugin]]:
        """Imports the module and finds the class inheriting from BasePlugin."""
        module_name = f"rocky_plugin_{plugin_id}"
        
        try:
            spec = importlib.util.spec_from_file_location(module_name, str(file_path))
            if spec is None or spec.loader is None:
                return None
                
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)

            # Find the first class that inherits from BasePlugin and is NOT BasePlugin itself
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if (
                    isinstance(attr, type) and 
                    issubclass(attr, BasePlugin) and 
                    attr is not BasePlugin
                ):
                    return attr
                    
            self.log.error("no_baseplugin_subclass_found", plugin_id=plugin_id)
            return None
        except Exception as e:
            self.log.error("module_import_error", plugin_id=plugin_id, error=str(e))
            return None

    async def get_all_plugin_tools(self) -> List[Dict[str, Any]]:
        """Aggregates tools from all active plugins."""
        all_tools = []
        for plugin in plugin_registry.list_plugins().values():
            try:
                tools = await plugin.get_tools()
                for tool in tools:
                    # Prefix tool names to avoid collision and identify source
                    # Actually, better to keep names clean but track metadata
                    all_tools.append(tool)
            except Exception as e:
                self.log.error("get_tools_failed", plugin_id=plugin.id, error=str(e))
        return all_tools

# Singleton manager
plugin_manager = PluginManager()
