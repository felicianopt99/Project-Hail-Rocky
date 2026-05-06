"""
Home Assistant Socket.io Handlers (Deprecated).

This module is no longer used, as the Rocky dashboard and chat now use
the Model Context Protocol (MCP) for Home Assistant integration.
"""

def register(sio):
    pass

async def metrics_loop(sio):
    pass

async def push_initial_state(sid, sio):
    pass
