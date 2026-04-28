import json
import logging
from app.db.session import db

logger = logging.getLogger("RockyDB-Services")

async def get_messages(limit: int = 50):
    messages = await db.message.find_many(
        order={"timestamp": "desc"},
        take=limit
    )
    return [{"role": m.role, "text": m.text, "timestamp": int(m.timestamp.timestamp() * 1000)} for m in messages][::-1]

async def save_message(role: str, text: str, device_id: str = "default"):
    await db.message.create(
        data={
            "role": role,
            "text": text,
            "deviceId": device_id
        }
    )

async def get_logs(limit: int = 50):
    logs = await db.log.find_many(
        order={"timestamp": "desc"},
        take=limit
    )
    return [{"timestamp": int(log.timestamp.timestamp() * 1000), "message": log.message} for log in logs]

async def save_log(message: str):
    await db.log.create(data={"message": message})

async def get_system_state():
    state = await db.systemstate.find_unique(where={"id": "default"})
    if not state:
        state = await db.systemstate.create(
            data={
                "id": "default",
                "mode": "dashboard",
                "lights": json.dumps({"lights": {}})
            }
        )
    return state

async def update_system_mode(mode: str):
    await db.systemstate.update(
        where={"id": "default"},
        data={"mode": mode}
    )

async def get_protocols():
    protocols = await db.protocol.find_many()
    return [{
        "id": p.id,
        "label": p.label,
        "description": p.description,
        "icon": p.icon,
        "color": p.color,
        "settings": json.loads(p.settings)
    } for p in protocols]

async def save_protocol(id: str, settings: dict):
    await db.protocol.update(
        where={"id": id},
        data={"settings": json.dumps(settings)}
    )

async def add_memory(content: str, category: str = "general"):
    await db.memory.create(
        data={
            "content": content,
            "category": category
        }
    )
