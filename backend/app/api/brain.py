from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import structlog

from ..api import socketio_handlers
from ..config import settings

log = structlog.get_logger()

router = APIRouter()

class BrainRequest(BaseModel):
    sid: str
    content: str
    emotional_state: str = "neutral"

@router.post("/chat")
async def chat(req: BrainRequest):
    """
    Stream tokens from Rocky's brain.
    This bypasses Socket.io and provides a direct interface for the Pipecat pipeline.
    """
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    # This is a bit tricky because socketio_handlers.py is designed for Socket.io.
    # We'll need a way to run the chat logic and capture the output tokens.
    
    async def generate():
        # Mocking a socketio server to capture emissions
        class MockSio:
            def __init__(self):
                self.tokens = asyncio.Queue()
                self.done = asyncio.Event()

            async def emit(self, event, data=None, to=None):
                if event == "chat_token":
                    await self.tokens.put(data)
                elif event == "chat_response":
                    await self.tokens.put(None) # Signal end
                    self.done.set()
                elif event == "status_update" and data == "idle":
                    if not self.done.is_set():
                        await self.tokens.put(None)
                        self.done.set()

        mock_sio = MockSio()
        
        # Run chat in background
        task = asyncio.create_task(socketio_handlers._chat(req.sid, req.content, mock_sio))
        
        try:
            while True:
                try:
                    # Timeout after 30s of silence if we haven't finished
                    token = await asyncio.wait_for(mock_sio.tokens.get(), timeout=30.0)
                    if token is None:
                        break
                    yield token
                except asyncio.TimeoutError:
                    log.warning("brain_chat_timeout", sid=req.sid)
                    break
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except:
                    pass
            # Ensure the queue doesn't leak or hang next calls
            while not mock_sio.tokens.empty():
                mock_sio.tokens.get_nowait()

    return StreamingResponse(generate(), media_type="text/plain")
