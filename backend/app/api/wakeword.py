"""
Wake word trigger endpoint.

Called by the local wakeword detector (services/wakeword/detector.py).
Emits `wake_word_detected` to all connected Socket.io clients.

Only reachable from localhost (no auth needed — firewall handles it).
"""
from fastapi import APIRouter, Request
from pydantic import BaseModel
import structlog

log = structlog.get_logger()
router = APIRouter()

# Will be set by main.py after sio is created
_sio = None


def set_sio(sio) -> None:
    global _sio
    _sio = sio


class TriggerRequest(BaseModel):
    word: str = "rocky"


@router.post("/trigger")
async def trigger(body: TriggerRequest):
    log.info("wake_word_triggered", word=body.word)
    if _sio:
        await _sio.emit("wake_word_detected", {"word": body.word})
    return {"ok": True, "word": body.word}
