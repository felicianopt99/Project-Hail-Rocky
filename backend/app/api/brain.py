from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import structlog

from ..api import socketio_handlers
from ..core.semantic_cache import semantic_cache
from ..core.trace import set_trace_id, get_trace_id

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
    set_trace_id()
    structlog.contextvars.bind_contextvars(sid=req.sid, trace_id=get_trace_id())
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    
    # ── Fast-path Semantic Cache check ───────────────────
    cached = await semantic_cache.check(req.content)
    if cached:
        log.info("brain_chat_cache", cache_hit=True, sid=req.sid)
        # We still want to run the full pipeline in the background to update 
        # state, intimacy and history, but we can return the cached response 
        # immediately to the Pipecat pipeline for zero-latency speech.
        # However, the user said "ignora a chamada ao agente Letta".
        # Running it in background might still call Letta.
        
        # If we return now, we bypass the whole socketio_handlers._chat.
        # To keep it simple and follow the "ignore Letta" instruction:
        return StreamingResponse(iter([cached]), media_type="text/plain")
    
    log.info("brain_chat_cache", cache_hit=False, sid=req.sid)

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
