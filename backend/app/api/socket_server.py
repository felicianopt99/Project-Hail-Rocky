import socketio
import logging
import asyncio
from app.db import services as db_service
from app.services.state_manager import state_manager
from app.models.schemas import ControlDeviceRequest

logger = logging.getLogger("RockySocket")

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')

@sio.event
async def connect(sid, environ, auth=None):
    logger.info(f"Client connected: {sid}. Fist-bump!")
    # Use background tasks to not block connection
    asyncio.create_task(sync_system_state(sid))
    asyncio.create_task(state_manager.sync_ha())

@sio.event
async def disconnect(sid):
    logger.info(f"Client disconnected: {sid}. Watch for leaks!")

@sio.on("get_system_state")
async def handle_get_system_state(sid):
    await sync_system_state(sid)

async def sync_system_state(sid=None):
    try:
        messages = await db_service.get_messages()
        logs = await db_service.get_logs()
        db_state = await db_service.get_system_state()
        protocols = await db_service.get_protocols()
        
        state_update = {
            "messages": messages,
            "logs": logs,
            "lights": state_manager.state["lights"],
            "systemMode": db_state.mode,
            "availableDevices": state_manager.state["availableDevices"],
            "protocols": protocols,
            "weather": state_manager.state["weather"]
        }
        
        if sid:
            await sio.emit("system_state_update", state_update, to=sid)
        else:
            await sio.emit("system_state_update", state_update)
    except Exception as e:
        logger.error(f"Sync failed: {e}. Bad math!")

@sio.on("control_device")
async def handle_control_device(sid, data):
    try:
        req = ControlDeviceRequest(**data)
        device = req.device
        action = req.action
        params = req.params or {}
        
        logger.info(f"Control device: {device} -> {action}")
        
        # We'll need to update the import for skills
        from app.skills.home_assistant import control_entity
        result = await control_entity(device, action, **params)
        
        if result["success"]:
            msg = f"Manual control: {device} {action} confirmed. Amaze!"
            await db_service.save_log(msg)
            await sio.emit("new_log", {
                "timestamp": int(asyncio.get_event_loop().time() * 1000), 
                "message": msg
            }, to=sid)
    except Exception as e:
        logger.error(f"Control failed: {e}. Bad math!")

@sio.on("set_mode")
async def handle_set_mode(sid, mode_str):
    try:
        # mode_str might be direct or in a dict
        mode = mode_str if isinstance(mode_str, str) else mode_str.get("mode")
        if not mode:
            return

        logger.info(f"Setting mode: {mode}")
        await db_service.update_system_mode(mode)
        await db_service.save_log(f"System mode shifted to {mode.upper()}. Watch!")
        await sio.emit("mode_updated", mode)
    except Exception as e:
        logger.error(f"Set mode failed: {e}")

# Callback for StateManager to broadcast to Socket.io clients
async def broadcast_state_update(msg):
    event_type = msg.get("event")
    data = msg.get("data")
    
    event_map = {
        "state_synced": "system_state_update",
        "stats_updated": "stats_updated",
        "weather_updated": "weather_updated",
        "device_updated": "device_updated"
    }
    
    sio_event = event_map.get(event_type)
    if sio_event:
        await sio.emit(sio_event, data)

@sio.on("sync_ha")
async def handle_sync_ha(sid):
    logger.info(f"Manual HA sync requested by {sid}")
    await state_manager.sync_ha()

@sio.on("execute_routine")
async def handle_execute_routine(sid, routine_id):
    logger.info(f"Executing routine: {routine_id}")
    # Routine logic would go here
    await db_service.save_log(f"Executing routine: {routine_id.upper()}")
    await sio.emit("new_log", {
        "timestamp": int(asyncio.get_event_loop().time() * 1000), 
        "message": f"Routine {routine_id} activated. Amaze!"
    }, to=sid)

state_manager.add_callback(broadcast_state_update)
