from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class PluginMetadata(BaseModel):
    """Metadata for a plugin, typically defined in manifest.json."""
    id: str = Field(..., description="Unique identifier for the plugin (snake_case)")
    name: str = Field(..., description="Human-readable name of the plugin")
    version: str = Field("0.1.0", description="Semantic version of the plugin")
    description: Optional[str] = Field(None, description="Short description of what the plugin does")
    author: Optional[str] = Field(None, description="Author of the plugin")
    homepage: Optional[str] = Field(None, description="URL to the plugin's homepage/repository")
    license: Optional[str] = Field("MIT", description="License of the plugin")

class PluginManifest(BaseModel):
    """The manifest file (manifest.json) content structure."""
    metadata: PluginMetadata
    enabled: bool = True
    config_schema: Optional[Dict[str, Any]] = Field(None, description="JSON Schema for plugin configuration")
    entry_point: str = Field("plugin.py", description="The main Python file of the plugin")
    dependencies: List[str] = Field(default_factory=list, description="List of PyPI dependencies required")

class PluginConfig(BaseModel):
    """Runtime configuration for a plugin instance."""
    enabled: bool = True
    settings: Dict[str, Any] = Field(default_factory=dict)
