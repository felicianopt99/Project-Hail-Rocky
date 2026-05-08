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
        if settings.use_langgraph_brain:
            log.info("using_langgraph_brain", sid=req.sid)
            initial_state = {
                "messages": [HumanMessage(content=req.content)],
                "sid": req.sid,
                "tools_called": []
            }
            
            # Use astream_events to get tokens in real-time
            async for event in rocky_brain_graph.astream_events(initial_state, version="v1"):
                kind = event["event"]
                if kind == "on_chat_model_stream":
                    content = event["data"]["chunk"].content
                    if content:
                        yield content
                elif kind == "on_tool_start":
                    # Optional: emit thinking event via socket.io if we had access to it here
                    # For now, just logging is fine
                    log.info("graph_tool_start", tool=event["name"])
            return

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
            loop = asyncio.get_event_loop()
            deadline = loop.time() + 60.0  # 60s total budget, not per-token
            while True:
                try:
                    remaining = deadline - loop.time()
                    if remaining <= 0:
                        log.warning("brain_chat_total_timeout", sid=req.sid)
                        break
                    token = await asyncio.wait_for(mock_sio.tokens.get(), timeout=min(remaining, 10.0))
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
                except asyncio.CancelledError:
                    pass
            # Ensure the queue doesn't leak or hang next calls
            while not mock_sio.tokens.empty():
                mock_sio.tokens.get_nowait()

    return StreamingResponse(generate(), media_type="text/plain")
