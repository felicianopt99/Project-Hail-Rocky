from fastapi import APIRouter, Depends
from typing import List, Dict, Any
from ..core.plugins.registry import plugin_registry
from ..core.plugins.schema import PluginManifest

router = APIRouter()

@router.get("/")
async def list_plugins():
    """Returns a list of all loaded plugins and their metadata."""
    plugins = plugin_registry.list_plugins()
    result = []
    for p_id, p_instance in plugins.items():
        result.append({
            "id": p_id,
            "metadata": p_instance.manifest.metadata.model_dump(),
            "enabled": p_instance.config.enabled,
            "initialized": p_instance._is_initialized
        })
    return result

@router.get("/{plugin_id}")
async def get_plugin_details(plugin_id: str):
    """Returns detailed information about a specific plugin."""
    plugin = plugin_registry.get_plugin(plugin_id)
    if not plugin:
        return {"error": "Plugin not found"}, 404
        
    return {
        "id": plugin.id,
        "manifest": plugin.manifest.model_dump(),
        "config": plugin.config.model_dump(),
        "tools": await plugin.get_tools()
    }
