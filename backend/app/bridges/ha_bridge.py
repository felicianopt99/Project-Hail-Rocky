"""
Home Assistant REST API bridge (Deprecated).

This module is no longer used for device control, as Project Hail Rocky now uses
the Model Context Protocol (MCP) to interact with Home Assistant dynamically.
"""

# Minimal placeholder to avoid import errors if still referenced elsewhere
async def is_available() -> bool:
    return False
