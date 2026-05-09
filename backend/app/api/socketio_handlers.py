import asyncio
import json
import time
from typing import Any, Optional
import structlog
import socketio

from ..config import settings
from ..core.redis_client import get_redis
from ..core.semantic_cache import semantic_cache
from ..rocky.personality import (
    system_prompt as personality,
    emotional_states as states,
    intimacy,
)
from ..bridges import azure_speaker
from ..voice.tts import synthesize_chunks, SAMPLE_RATE
from ..tools.executor import run as run_tool
from ..core.trace import set_trace_id, get_trace_id
from ..schemas import socket_schemas
from ..rocky.graph.workflow import rocky_brain_graph
from langchain_core.messages import HumanMessage, AIMessage

log = structlog.get_logger()

_sessions: dict[str, dict[str, Any]] = {}


def _session(sid: str) -> dict[str, Any]:
    return _sessions.setdefault(sid, {"history": [], "state": "neutral", "is_processing": False})








# ── Core chat logic (shared by text and voice paths) ─────────────────────
async def _chat(sid: str, content: str, sio: socketio.AsyncServer, history: list[dict] | None = None, language: str = "en") -> None:
    session = _session(sid)
    redis = await get_redis()

    # Use speaker name as user_id so each person has their own intimacy score
    user_id = session.get("speaker") or sid

    current_state = await states.load(sid, redis)
    score = await intimacy.load(user_id, redis)
    new_state = await states.detect(content, current_state)
    await states.save(sid, new_state, redis)
    score = await intimacy.update(user_id, content, redis)

    session["history"].append({"role": "user", "content": content})
    if len(session["history"]) > 100:
        session["history"] = session["history"][-80:]

    await sio.emit("status_update", "thinking_llm", to=sid)
    
    state_update = socket_schemas.SystemStateUpdate(
        emotional_state=new_state,
        intimacy=round(score, 1),
        intimacy_label=intimacy.label(score),
    )
    await sio.emit("system_state_update", state_update.model_dump(exclude_none=True), to=sid)

    # ── Semantic Cache check ───────────────────────────────
    # We check the cache before calling Letta or LiteLLM to save latency and cost.
    # Score 0.95 similarity is enforced by the cache threshold in settings.
    cache_hit = await semantic_cache.check(content)
    if cache_hit:
        cached_resp = cache_hit["response"]
        score = cache_hit["score"]
        
        log.info("cache_check", hit=True, sid=sid, score=round(score, 4), prompt=content[:50])
        
        # Check if Pipecat is active to determine how to emit the response
        from ..bridges.pipecat_bridge import PipecatBridge
        is_pipecat_active = PipecatBridge().is_session_running(sid)
        
        # If Pipecat is NOT active, we send the full response via socket
        if not is_pipecat_active:
            # For immediate display, we can also emit the "tokens" (the whole thing)
            await sio.emit("chat_token", cached_resp, to=sid)

            resp = socket_schemas.ChatResponse(text=cached_resp)
            await sio.emit("chat_response", resp.model_dump(), to=sid)
            await sio.emit("status_update", "idle", to=sid)

            # Also handle TTS for cached responses if enabled
            if settings.has_tts():
                await _emit_tts(sid, cached_resp, sio, new_state)
        else:
            # If Pipecat is active, we just emit the token for brain.py to capture it
            await sio.emit("chat_token", cached_resp, to=sid)
            # Signal end for mock_sio in brain.py
            await sio.emit("chat_response", {"text": cached_resp}, to=sid)
            await sio.emit("status_update", "idle", to=sid)

        session["history"].append({"role": "assistant", "content": cached_resp})
        return

    log.info("cache_check", hit=False, sid=sid)

    # ── Unified LangGraph Brain ──────────────────────────────────────────
    await _chat_langgraph(sid, content, session, sio, history=history)


async def _chat_langgraph(sid: str, content: str, session: dict, sio: socketio.AsyncServer, history: list[dict] | None = None) -> None:
    """Chat via LangGraph state machine — unified agentic intelligence."""
    from ..bridges.pipecat_bridge import PipecatBridge
    is_pipecat_active = PipecatBridge().is_session_running(sid)
    
    # Use provided history (REST/Voice) or session history (Socket.io)
    msg_source = history if history is not None else session.get("history", [])
    
    # Convert history dicts to LangChain messages
    messages = []
    for m in msg_source[-15:]: # Keep last 15 for context
        if m["role"] == "user":
            messages.append(HumanMessage(content=m["content"]))
        else:
            messages.append(AIMessage(content=m["content"]))
    
    # Add current message
    messages.append(HumanMessage(content=content))

    initial_state = {
        "messages": messages,
        "sid": sid,
        "tools_called": []
    }
    
    full_response = ""
    sentence_buf = ""
    current_emo = "neutral"

    log.info("langgraph_chat_start", sid=sid)

    try:
        async for event in rocky_brain_graph.astream_events(initial_state, version="v1"):
            kind = event["event"]
            
            # 1. Token streaming
            if kind == "on_chat_model_stream":
                token = event["data"]["chunk"].content
                if token:
                    full_response += token
                    sentence_buf += token
                    await sio.emit("chat_token", token, to=sid)
                    

            
            # 2. State updates (personality node)
            elif kind == "on_chain_end" and event["name"] == "personality":
                data = event["data"]["output"]
                current_emo = data.get("emotional_state", "neutral")
                score = data.get("intimacy_score", 35.0)
                state_update = socket_schemas.SystemStateUpdate(
                    emotional_state=current_emo,
                    intimacy=round(score, 1),
                    intimacy_label=intimacy.label(score),
                )
                await sio.emit("system_state_update", state_update.model_dump(exclude_none=True), to=sid)
            
            # 3. Tool execution status
            elif kind == "on_tool_start":
                await sio.emit("status_update", "thinking_llm", to=sid) # Re-use thinking status for tool calls
                log.info("langgraph_tool_start", tool=event["name"])

        # Final TTS chunk
        if sentence_buf.strip() and settings.has_tts() and not is_pipecat_active:
            await _emit_tts(sid, sentence_buf.strip(), sio, current_emo)

        session["history"].append({"role": "assistant", "content": full_response})
        resp = socket_schemas.ChatResponse(text=full_response)
        await sio.emit("chat_response", resp.model_dump(), to=sid)
        await sio.emit("status_update", "idle", to=sid)
        
        # Store in semantic cache
        if full_response:
            await semantic_cache.store(content, full_response)
            
        log.info("langgraph_chat_complete", sid=sid, length=len(full_response))

    except Exception as exc:
        log.error("langgraph_chat_error", error=str(exc), sid=sid)
        err = socket_schemas.ChatError(message=f"Brain Error: {exc}", code="graph_error")
        await sio.emit("chat_error", err.model_dump(), to=sid)
        await sio.emit("status_update", "error", to=sid)



async def _greet_speaker(sid: str, name: str, sio: socketio.AsyncServer) -> None:
    """Rocky briefly acknowledges a new speaker entering the conversation."""
    greeting = f"Oh. Different human. Rocky recognise {name}. Yes?"
    await sio.emit("chat_token", greeting, to=sid)
    resp = socket_schemas.ChatResponse(text=greeting)
    await sio.emit("chat_response", resp.model_dump(), to=sid)
    if settings.has_tts():
        await _emit_tts(sid, greeting, sio, "neutral")


async def _cancel_tts(sid: str, sio: socketio.AsyncServer) -> None:
    """Cancel any active TTS stream for this session and notify the client."""
    session = _session(sid)
    task: Optional[asyncio.Task[Any]] = session.pop("tts_task", None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        await sio.emit("stop_speaking", to=sid)
        log.info("tts_interrupted", sid=sid)


async def _emit_tts(sid: str, text: str, sio: socketio.AsyncServer, emotional_state: str = "neutral") -> None:
    import asyncio

    async def _stream() -> None:
        start_payload = socket_schemas.TtsStart(sampleRate=SAMPLE_RATE)
        await sio.emit("tts_start", start_payload.model_dump(), to=sid)
        await sio.emit("status_update", "synthesizing_tts", to=sid)
        try:
            async for chunk in synthesize_chunks(text, emotional_state):
                await sio.emit("tts_chunk", chunk, to=sid)
            await sio.emit("tts_end", to=sid)
        except asyncio.CancelledError:
            await sio.emit("tts_end", to=sid)  # always close cleanly
            raise
        except Exception as e:
            log.error("tts_emit_error", error=str(e))
            await sio.emit("tts_error", to=sid)
        finally:
            session = _session(sid)
            session.pop("tts_task", None)

    task = asyncio.create_task(_stream())
    _session(sid)["tts_task"] = task
    await task  # await so callers still sequence sentence-by-sentence


# ── Home Assistant dashboard helpers ─────────────────────────────────────

def _state_to_light(entity_id: str, state_data: dict) -> dict:
    """Convert a raw HA state dict to the LightState shape the frontend expects."""
    attrs = state_data.get("attributes", {})
    rgb = attrs.get("rgb_color")
    hex_color = "#ffffff"
    if rgb and len(rgb) == 3:
        hex_color = "#{:02x}{:02x}{:02x}".format(*rgb)
    brightness_raw = attrs.get("brightness")
    brightness_pct = round((brightness_raw / 255) * 100) if brightness_raw else 0
    return {
        "name": attrs.get("friendly_name", entity_id),
        "status": "on" if state_data.get("state") == "on" else "off",
        "brightness": brightness_pct,
        "color": hex_color,
        "color_temp_kelvin": attrs.get("color_temp_kelvin"),
        "min_color_temp_kelvin": attrs.get("min_color_temp_kelvin"),
        "max_color_temp_kelvin": attrs.get("max_color_temp_kelvin"),
    }


async def _fetch_ha_lights() -> tuple[dict, dict]:
    """Return (lights_dict, areas_dict) by querying the HA MCP server."""
    from ..tools.executor import _proxy_mcp_call
    mcp = settings.ha_mcp_url

    # 1. Areas
    areas: dict[str, str] = {}
    areas_raw = await _proxy_mcp_call(mcp, "ha_config_list_areas", {})
    if areas_raw:
        try:
            d = json.loads(areas_raw) if isinstance(areas_raw, str) else areas_raw
            for a in d.get("areas", []):
                areas[a["area_id"]] = a["name"]
        except Exception:
            pass

    # 2. All light entity IDs
    search_raw = await _proxy_mcp_call(mcp, "ha_search_entities", {"domain_filter": "light"})
    entity_ids: list[str] = []
    if search_raw:
        try:
            d = json.loads(search_raw) if isinstance(search_raw, str) else search_raw
            results = (d.get("data") or d).get("results", [])
            entity_ids = [r["entity_id"] for r in results]
        except Exception:
            pass

    if not entity_ids:
        return {}, areas

    # 3. Batch state fetch
    states: dict[str, dict] = {}
    state_raw = await _proxy_mcp_call(mcp, "ha_get_state", {"entity_id": entity_ids})
    if state_raw:
        try:
            d = json.loads(state_raw) if isinstance(state_raw, str) else state_raw
            states = (d.get("data") or d).get("states", {})
        except Exception:
            pass

    # 4. Map entities to areas (one call per area)
    entity_area: dict[str, str] = {}
    for area_id in areas:
        ar_raw = await _proxy_mcp_call(mcp, "ha_search_entities",
                                       {"domain_filter": "light", "area_filter": area_id})
        if ar_raw:
            try:
                d = json.loads(ar_raw) if isinstance(ar_raw, str) else ar_raw
                results = (d.get("data") or d).get("results", [])
                for r in results:
                    entity_area[r["entity_id"]] = area_id
            except Exception:
                pass

    # 5. Build lights dict
    lights: dict[str, dict] = {}
    for eid, sd in states.items():
        light = _state_to_light(eid, sd)
        area_id = entity_area.get(eid)
        light["areaId"] = area_id
        light["areaName"] = areas.get(area_id) if area_id else None
        lights[eid] = light

    return lights, areas


# ── Register handlers ─────────────────────────────────────────────────────
def register(sio: socketio.AsyncServer) -> None:
    # Import here to avoid circular dependency if needed, though PipecatBridge is usually fine
    from ..bridges.pipecat_bridge import PipecatBridge
    PipecatBridge(sio)

    @sio.event
    async def connect(sid: str, environ: dict[str, Any], auth: Optional[Any] = None) -> None:
        set_trace_id()
        structlog.contextvars.bind_contextvars(sid=sid, trace_id=get_trace_id())
        _session(sid)
        log.info("client_connected")
        await sio.emit("status_update", "idle", to=sid)
        await sio.emit("chat_history", [], to=sid)
        
        initial_state = socket_schemas.SystemStateUpdate(
            emotional_state="neutral", 
            intimacy=35.0
        )
        await sio.emit("system_state_update", initial_state.model_dump(exclude_none=True), to=sid)
        
        await sio.emit("service_status", socket_schemas.ServiceStatus(service="stt", ok=settings.has_stt()).model_dump(), to=sid)
        await sio.emit("service_status", socket_schemas.ServiceStatus(service="tts", ok=settings.has_tts()).model_dump(), to=sid)
        await sio.emit("service_status", socket_schemas.ServiceStatus(service="llm", ok=settings.has_llm()).model_dump(), to=sid)



        if not settings.has_llm():
            resp = socket_schemas.ChatResponse(
                text="Rocky here. No LLM API key found. Set GROQ_API_KEY in .env and restart."
            )
            await sio.emit("chat_response", resp.model_dump(), to=sid)

    @sio.event
    async def disconnect(sid: str) -> None:
        from ..bridges.pipecat_bridge import PipecatBridge
        bridge = PipecatBridge()
        await bridge.stop(sid)
        
        _sessions.pop(sid, None)
        await azure_speaker.clear_session(sid)
        log.info("client_disconnected", sid=sid)

    @sio.event
    async def chat_request(sid: str, data: Any) -> None:
        set_trace_id()
        structlog.contextvars.bind_contextvars(sid=sid, trace_id=get_trace_id())
        content = (data.get("content", "") if isinstance(data, dict) else str(data)).strip()
        if not content or not settings.has_llm():
            if not settings.has_llm():
                err = socket_schemas.ChatError(message="No LLM API key.")
                await sio.emit("chat_error", err.model_dump(), to=sid)
            return
        
        session = _session(sid)
        if session.get("is_processing"):
            log.info("chat_request_interrupting_active", sid=sid)
            await voice_interrupt(sid)
        
        session["is_processing"] = True
        try:
            await _chat(sid, content, sio)
        finally:
            session["is_processing"] = False


    @sio.event
    async def manual_stop(sid: str, data: Optional[Any] = None) -> None:
        """User stopped speaking — signal Pipecat to process the turn."""
        log.info("manual_stop_received", sid=sid)
        
        # Interrupt any active legacy TTS
        await _cancel_tts(sid, sio)

        # Pipecat Bridge: Single Source of Truth
        from ..bridges.pipecat_bridge import PipecatBridge
        bridge = PipecatBridge()
        if bridge.is_session_running(sid):
            await bridge.send_eot(sid)
            log.info("manual_stop_signal_sent", sid=sid)
        else:
            await sio.emit("status_update", "idle", to=sid)

    @sio.event
    async def voice_interrupt(sid: str, data: Optional[Any] = None) -> None:
        """Interrupts any active voice processing (Bridge + Legacy TTS)."""
        log.info("voice_interrupt_received", sid=sid)
        session = _session(sid)
        session["is_processing"] = False
        
        # Task 3: Concurrent interruption with exception safety.
        from ..bridges.pipecat_bridge import PipecatBridge
        try:
            await asyncio.gather(
                PipecatBridge().send_cancel_frame(sid),
                _cancel_tts(sid, sio),
                return_exceptions=True
            )
        except Exception as e:
            log.error("voice_interrupt_error", error=str(e), sid=sid)

    @sio.event
    async def manual_activation(sid: str, data: Optional[Any] = None) -> None:
        log.info("manual_activation_received", sid=sid)
        if settings.voice_debug_events:
            await sio.emit("voice_debug", {"stage": "manual_activation_observed", "timestamp": time.time()}, to=sid)

        # Pre-start the Pipecat bridge so the WebSocket connection and StartFrame
        # are established before the first WebRTC audio frame arrives.
        from ..bridges.pipecat_bridge import PipecatBridge
        bridge = PipecatBridge(sio)
        _session(sid)["pipecat_bridge"] = bridge
        asyncio.create_task(bridge.start(sid))

        await sio.emit("status_update", "listening", to=sid)

    @sio.event
    async def auth_granted(sid: str, data: dict[str, Any]) -> None:
        """Resume tool execution after human approval."""
        session = _session(sid)
        pending = session.pop("pending_tool_auth", None)
        if not pending:
            log.warning("auth_granted_no_pending", sid=sid)
            return
        
        log.info("auth_granted_resuming", tool=pending["name"], sid=sid)
        
        # Execute tool with bypass_auth=True
        result = await run_tool(
            pending["name"], 
            pending["args"], 
            sio=sio, 
            tool_call_id=pending["id"],
            bypass_auth=True
        )
        
        messages = pending["messages"]
        messages.append({"role": "tool", "tool_call_id": pending["id"], "content": result})
        
        # Finish the chat completion
        await _finish_chat_after_tool(sid, sio, session, messages, pending["state"])

    @sio.event
    async def sync_ha(sid: str, data: Optional[Any] = None) -> None:
        """Fetch all light entities + areas from HA and push to the dashboard."""
        if not settings.ha_mcp_url:
            return
        try:
            lights, areas = await _fetch_ha_lights()
            update = socket_schemas.SystemStateUpdate(lights=lights, areas=areas)
            await sio.emit("system_state_update", update.model_dump(exclude_none=True), to=sid)
            log.info("sync_ha_ok", lights=len(lights), areas=len(areas), sid=sid)
        except Exception as e:
            log.error("sync_ha_failed", error=str(e), sid=sid)

    @sio.event
    async def control_device(sid: str, data: dict[str, Any]) -> None:
        """Toggle or update a light entity and emit the new state back."""
        if not settings.ha_mcp_url:
            return
        device: str = data.get("device", "")
        action: str = data.get("action", "toggle")
        params: dict = data.get("params", {})
        if not device:
            return

        from ..tools.executor import _proxy_mcp_call
        try:
            if action == "toggle":
                await _proxy_mcp_call(settings.ha_mcp_url, "ha_call_service",
                                      {"domain": "light", "service": "toggle", "entity_id": device})
            elif action == "set":
                svc_data: dict[str, Any] = {}
                if "brightness" in params:
                    svc_data["brightness_pct"] = int(params["brightness"])
                if "color" in params:
                    hx = params["color"].lstrip("#")
                    svc_data["rgb_color"] = [int(hx[i:i+2], 16) for i in (0, 2, 4)]
                if "color_temp_kelvin" in params:
                    svc_data["color_temp_kelvin"] = int(params["color_temp_kelvin"])
                await _proxy_mcp_call(settings.ha_mcp_url, "ha_call_service",
                                      {"domain": "light", "service": "turn_on",
                                       "entity_id": device, "data": svc_data})

            # Short wait for HA state to settle, then read back new state
            await asyncio.sleep(0.4)
            state_raw = await _proxy_mcp_call(settings.ha_mcp_url, "ha_get_state",
                                              {"entity_id": device})
            if state_raw:
                parsed = json.loads(state_raw) if isinstance(state_raw, str) else state_raw
                state_data = (parsed.get("data", {}) or {}).get("states", {}).get(device, {})
                if state_data:
                    light_state = _state_to_light(device, state_data)
                    await sio.emit("device_updated", {"device": device, "state": light_state}, to=sid)
        except Exception as e:
            log.error("control_device_failed", error=str(e), device=device, sid=sid)

    @sio.event
    async def ping(sid: str, data: Optional[Any] = None) -> None:
        await sio.emit("pong_latency", data, to=sid)
