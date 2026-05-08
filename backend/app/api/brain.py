from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json
import asyncio
import structlog

from ..api import socketio_handlers
from ..core.semantic_cache import semantic_cache
from ..core.trace import set_trace_id, get_trace_id
from ..config import settings
from ..rocky.graph.workflow import rocky_brain_graph
from langchain_core.messages import HumanMessage

log = structlog.get_logger()

router = APIRouter()

class BrainRequest(BaseModel):
    sid: str
    content: str
    emotional_state: str = "neutral"
    context: list[dict] | None = None

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
    cache_hit = await semantic_cache.check(req.content)
    if cache_hit:
        cached_resp = cache_hit["response"]
        score = cache_hit["score"]
        log.info("cache_check", hit=True, sid=req.sid, score=round(score, 4), prompt=req.content[:50])
        
        # If we return now, we bypass the whole socketio_handlers._chat.
        # To keep it simple and follow the "ignore Letta" instruction:
        return StreamingResponse(iter([cached_resp]), media_type="text/plain")
    
    log.info("cache_check", hit=False, sid=req.sid)

    async def generate():
        # Mocking a socketio server to capture emissions.
        # This allows us to use the same logic for both REST and Socket.io paths.
        class MockSio:
            def __init__(self):
                self.tokens = asyncio.Queue()
                self.done = asyncio.Event()

            async def emit(self, event, data=None, to=None):
                if event == "chat_token":
                    await self.tokens.put(data)
                elif event in ["chat_response", "chat_error"]:
                    await self.tokens.put(None) # Signal end
                    self.done.set()
                elif event == "status_update" and data == "idle":
                    if not self.done.is_set():
                        await self.tokens.put(None)
                        self.done.set()

        mock_sio = MockSio()
        
        # Run chat in background — this now handles LangGraph vs Legacy automatically
        task = asyncio.create_task(socketio_handlers._chat(req.sid, req.content, mock_sio, history=req.context))
        
        try:
            loop = asyncio.get_event_loop()
            deadline = loop.time() + 60.0
            while True:
                try:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        break
                    token = await asyncio.wait_for(mock_sio.tokens.get(), timeout=min(remaining, 10.0))
                    if token is None:
                        break
                    yield token
                except asyncio.TimeoutError:
                    break
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            while not mock_sio.tokens.empty():
                mock_sio.tokens.get_nowait()

    return StreamingResponse(generate(), media_type="text/plain")
