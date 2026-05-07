import asyncio
import time
import re
from typing import Any, Dict, List, Optional, Tuple, Union
import structlog
import litellm
import socketio

from ..config import settings
from ..core.redis_client import get_redis
from ..core.semantic_cache import semantic_cache
from ..rocky.personality import (
    system_prompt as personality,
    emotional_states as states,
    intimacy,
)
from ..bridges import letta_bridge, azure_speaker
from ..voice.tts import synthesize_chunks, SAMPLE_RATE
from ..tools.definitions import get_tools
from ..tools.executor import run as run_tool
from . import skills as skills_api
from ..core.trace import set_trace_id, get_trace_id
from ..schemas import socket_schemas

log = structlog.get_logger()

_sessions: Dict[str, Dict[str, Any]] = {}


def _session(sid: str) -> Dict[str, Any]:
    return _sessions.setdefault(sid, {"history": [], "state": "neutral", "is_processing": False})


# ── Sentence boundary splitter for sentence-level TTS streaming ───────────
_SENTENCE_END = re.compile(r'(?<=[.!?…])\s+')


def _pop_sentence(buf: str, is_first: bool = False) -> Tuple[str, str]:
    """Return (completed_sentence, remainder). If is_first, we allow smaller chunks."""
    parts = _SENTENCE_END.split(buf, maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1]
    
    # If it's the first chunk and it's long enough (e.g. 2 words), yield it anyway
    if is_first and len(buf.split()) >= 2:
         return buf.strip(), ""
         
    return "", buf





# ── Core chat logic (shared by text and voice paths) ─────────────────────
async def _chat(sid: str, content: str, sio: socketio.AsyncServer, language: str = "en") -> None:
    session = _session(sid)
    redis = await get_redis()

    # Use speaker name as user_id so each person has their own intimacy score
    user_id = session.get("speaker") or sid

    current_state = await states.load(sid, redis)
    score = await intimacy.load(user_id, redis)
    new_state = states.detect(content, current_state)
    await states.save(sid, new_state, redis)
    score = await intimacy.update(user_id, content, redis)

    session["history"].append({"role": "user", "content": content})

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

        session["history"].append({"role": "assistant", "content": cached_resp})
        return

    log.info("cache_check", hit=False, sid=sid)

    # ── Tool calling ───────────────────────────────────────
    # We try tools first. If no tool is needed, _try_tools returns False and we proceed.
    tool_response = await _try_tools(sid, content, new_state, score, session, sio, user_id=user_id)
    if tool_response:
        log.info("decision_pipeline_tool_handled", sid=sid)
        return # Tool was handled

    # ── Letta / LiteLLM ────────────────────────────────────
    if settings.has_letta and await letta_bridge.is_available():
        await _chat_letta(sid, content, new_state, score, session, sio, user_id=user_id, language=language)
    else:
        await _chat_litellm(sid, content, new_state, score, session, sio, user_id=user_id)


async def _finish_chat_after_tool(
    sid: str, sio: socketio.AsyncServer, session: dict, 
    messages: list, state: str
) -> None:
    """Helper to stream the final LLM response after a tool has executed."""
    model = settings.get_llm_model()
    final_response = await litellm.acompletion(
        model=model, messages=messages, stream=True, temperature=0.8, max_tokens=512,
    )
    full_final, buf_final = "", ""
    async for chunk in final_response:
        token = chunk.choices[0].delta.content or ""
        if not token:
            continue
        full_final += token
        buf_final += token
        await sio.emit("chat_token", token, to=sid)
        if settings.has_tts():
            sentence, buf_final = _pop_sentence(buf_final, is_first=(full_final == token))
            if sentence:
                await _emit_tts(sid, sentence, sio, state)
    
    if buf_final.strip() and settings.has_tts():
        await _emit_tts(sid, buf_final.strip(), sio, state)
    
    session["history"].append({"role": "assistant", "content": full_final})
    resp = socket_schemas.ChatResponse(text=full_final)
    await sio.emit("chat_response", resp.model_dump(), to=sid)
    await sio.emit("status_update", "idle", to=sid)


async def _try_tools(
    sid: str, content: str, state: str, score: float,
    session: Dict[str, Any], sio: socketio.AsyncServer,
    user_id: Optional[str] = None,
) -> bool:
    """
    Try to handle the message via LLM tool calling.
    Returns True if a tool was called and response was sent, False otherwise.
    Only makes 1 LLM call — if tools are used a second call streams the final answer,
    but if no tools are needed the first response is used directly (zero extra cost).
    """
    import json as _json
    system = personality.build_system_prompt(
        emotional_state=state, intimacy_score=score, message=content
    )
    if user_id and user_id != sid:
        system += f"\n\n## Speaker\nYou are speaking with {user_id}. Use their name naturally."
    messages = [{"role": "system", "content": system}, *session["history"][-20:]]
    model = settings.get_llm_model()

    try:
        # Filter out disabled tools (respects Skills page toggle)
        tools = await get_tools()
        active_tools = [
            t for t in tools
            if skills_api._overrides.get(t["function"]["name"], {}).get("enabled", True)
        ]
        
        # Stream the first call to detect tools early
        response = await litellm.acompletion(
            model=model, messages=messages,
            tools=active_tools, tool_choice="auto",
            stream=True, temperature=0.85, max_tokens=1024,
        )
        
        full, buf = "", ""
        tool_calls = []
        
        async for chunk in response:
            delta = chunk.choices[0].delta
            
            # Check for tool calls
            if hasattr(delta, "tool_calls") and delta.tool_calls:
                # Accumulate tool calls (usually they come in the first chunks)
                for tc in delta.tool_calls:
                    if len(tool_calls) <= tc.index:
                        tool_calls.append(tc)
                    else:
                        # Append parts (for streaming tool call arguments)
                        curr = tool_calls[tc.index]
                        if tc.function and tc.function.arguments:
                            curr.function.arguments += tc.function.arguments
                continue

            # If we reached here and have tool_calls, we finish the loop to process them
            if tool_calls:
                # We need to exhaust the stream to be sure no more tool calls come
                # (usually they come all at once or in sequence at the start)
                continue

            # No tool call detected yet, stream tokens directly
            token = delta.content or ""
            if not token:
                continue
            full += token
            buf += token
            await sio.emit("chat_token", token, to=sid)
            if settings.has_tts():
                sentence, buf = _pop_sentence(buf, is_first=(full == token))
                if sentence:
                    await _emit_tts(sid, sentence, sio, state)

        # ── Handle Tool Calls if any were found ───────────────────────────
        if tool_calls:
            messages.append({"role": "assistant", "tool_calls": [tc.model_dump() for tc in tool_calls]})
            for tc in tool_calls:
                tool_name = tc.function.name
                tool_args = _json.loads(tc.function.arguments or "{}")
                log.info("tool_called", tool=tool_name, args=tool_args)
                result = await run_tool(tool_name, tool_args, sio=sio, tool_call_id=tc.id)
                
                # Check for Human-in-the-loop auth requirement
                if isinstance(result, dict) and result.get("status") == "pending_auth":
                    session["pending_tool_auth"] = {
                        "id": tc.id,
                        "name": tool_name,
                        "args": tool_args,
                        "messages": messages,
                        "state": state
                    }
                    await sio.emit("REQUEST_CONFIRMATION", result, to=sid)
                    return True

                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

            await _finish_chat_after_tool(sid, sio, session, messages, state)
            return True

        # ── No tools were called ──
        return False

    except Exception as exc:
        log.error("tool_error", error=str(exc))
        return False  # Fall through to normal chat


async def _chat_letta(
    sid: str, content: str, state: str, score: float,
    session: Dict[str, Any], sio: socketio.AsyncServer,
    user_id: Optional[str] = None,
    language: str = "en"
) -> None:
    """Chat via Letta agent — full persistent memory."""
    try:
        # 1. Force language and speaker context
        lang_map = {"pt": "Portuguese", "en": "English", "es": "Spanish", "fr": "French"}
        lang_name = lang_map.get(language, "English")
        
        msg = f"[Language: {lang_name}] "
        if user_id and user_id != sid:
            msg += f"[Speaking with: {user_id}] "
        msg += content

        # 2. Consume streaming response from Letta
        full_reply = ""
        sentence_buf = ""
        
        # Check if Pipecat is active to prevent redundant emissions
        from ..bridges.pipecat_bridge import PipecatBridge
        is_pipecat_active = PipecatBridge().is_session_running(sid)

        async for token in letta_bridge.send_message_stream(msg):
            if not token:
                continue
            
            full_reply += token
            sentence_buf += token
            
            if not is_pipecat_active:
                # Emit token to frontend for real-time text display
                await sio.emit("chat_token", token, to=sid)
            
            # Sentence-level TTS streaming
            if settings.has_tts():
                sentence, sentence_buf = _pop_sentence(sentence_buf, is_first=(full_reply == token))
                if sentence and not is_pipecat_active:
                    await _emit_tts(sid, sentence, sio, state)

        if not full_reply:
            log.warning("letta_empty_reply", sid=sid)
            await _chat_litellm(sid, content, state, score, session, sio, user_id=user_id)
            return

        # Final cleanup for TTS and history
        if sentence_buf.strip() and settings.has_tts() and not is_pipecat_active:
            await _emit_tts(sid, sentence_buf.strip(), sio, state)

        session["history"].append({"role": "assistant", "content": full_reply})
        if not is_pipecat_active:
            resp = socket_schemas.ChatResponse(text=full_reply)
            await sio.emit("chat_response", resp.model_dump(), to=sid)
            await sio.emit("status_update", "idle", to=sid)
        
        # Store in semantic cache
        if full_reply:
            await semantic_cache.store(content, full_reply)
            
        log.info("chat_letta_ok", sid=sid, state=state, chars=len(full_reply), pipecat_active=is_pipecat_active)

    except Exception as exc:
        log.error("letta_chat_error", error=str(exc), sid=sid)
        err = socket_schemas.ChatError(message=f"Letta error: {exc}")
        await sio.emit("chat_error", err.model_dump(), to=sid)
        await sio.emit("status_update", "error", to=sid)


async def _chat_litellm(
    sid: str, content: str, state: str, score: float,
    session: Dict[str, Any], sio: socketio.AsyncServer,
    user_id: Optional[str] = None,
) -> None:
    """
    Pure conversational LLM response — no tools (those are handled by _try_tools).
    Single streaming call, no wasted API cost.
    """
    # (Cache check moved to caller _chat for both Letta and LiteLLM)

    system = personality.build_system_prompt(
        emotional_state=state, intimacy_score=score, message=content
    )
    if user_id and user_id != sid:
        system += f"\n\n## Speaker\nYou are speaking with {user_id}. Use their name naturally."

    messages = [{"role": "system", "content": system}, *session["history"][-20:]]

    full_response = ""
    sentence_buf = ""

    try:
        response = await litellm.acompletion(
            model=settings.get_llm_model(),
            messages=messages,
            stream=True,
            temperature=0.85,
            max_tokens=1024,
        )
        # Check if Pipecat is active to prevent redundant emissions
        from ..bridges.pipecat_bridge import PipecatBridge
        is_pipecat_active = PipecatBridge().is_session_running(sid)

        async for chunk in response:
            token = chunk.choices[0].delta.content or ""
            if not token:
                continue
            full_response += token
            sentence_buf += token
            
            if not is_pipecat_active:
                await sio.emit("chat_token", token, to=sid)
            
            if settings.has_tts():
                sentence, sentence_buf = _pop_sentence(sentence_buf, is_first=(full_response == token))
                if sentence and not is_pipecat_active:
                    await _emit_tts(sid, sentence, sio, state)

        if sentence_buf.strip() and settings.has_tts() and not is_pipecat_active:
            await _emit_tts(sid, sentence_buf.strip(), sio, state)

        session["history"].append({"role": "assistant", "content": full_response})
        log.info("emitting_chat_response", sid=sid, length=len(full_response), pipecat_active=is_pipecat_active)
        
        if not is_pipecat_active:
            resp = socket_schemas.ChatResponse(text=full_response)
            await sio.emit("chat_response", resp.model_dump(), to=sid)
            await sio.emit("status_update", "idle", to=sid)
        
        # Store in semantic cache
        if full_response:
            await semantic_cache.store(content, full_response)
            
        log.info("chat_litellm_ok", sid=sid, state=state)

    except Exception as exc:
        log.error("llm_error", error=str(exc), sid=sid)
        err = socket_schemas.ChatError(message=f"LLM error: {exc}")
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


# ── Register handlers ─────────────────────────────────────────────────────
def register(sio: socketio.AsyncServer) -> None:
    # Import here to avoid circular dependency if needed, though PipecatBridge is usually fine
    from ..bridges.pipecat_bridge import PipecatBridge
    PipecatBridge(sio)

    @sio.event
    async def connect(sid: str, environ: Dict[str, Any], auth: Optional[Any] = None) -> None:
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
        """User stopped speaking — cancel any TTS, then STT + speaker ID → chat."""
        log.info("manual_stop_received", sid=sid)
        if settings.voice_debug_events:
            await sio.emit("voice_debug", {"stage": "manual_stop_received", "timestamp": time.time()}, to=sid)
        import asyncio as _asyncio
        from ..voice.stt import transcribe

        # Interrupt any active TTS first (barge-in when using manual stop flow)
        await _cancel_tts(sid, sio)

        session = _session(sid)
        
        # Se o Pipecat estiver ativo (ou a ligar), deixamos que seja o Pipecat a ditar o fluxo.
        if settings.has_pipecat():
            from ..bridges.pipecat_bridge import PipecatBridge
            bridge = PipecatBridge()
            # We don't have a direct way to check _running from outside without exposing it, 
            # but PipecatBridge is a singleton.
            # Let's assume if it has a session it might be running.
            # Actually, PipecatBridge already handles session existence.
            await bridge.send_eot(sid)
            log.info("manual_stop_signal_sent", sid=sid)
            return

        buf: bytearray = session.pop("audio_buf", bytearray())

        pcm = bytes(buf)
        await sio.emit("status_update", "processing_stt", to=sid)
        try:
            session = _session(sid)
            session["is_processing"] = True
            
            async def _no_speaker():
                return None

            # Run STT and speaker ID concurrently — speaker ID is free if cached
            transcript, speaker = await _asyncio.gather(
                transcribe(pcm, filename="audio.raw"),
                azure_speaker.identify(pcm, sid) if settings.has_speaker_id() else _no_speaker(),
            )
            if not transcript:
                await sio.emit("status_update", "idle", to=sid)
                session["is_processing"] = False
                return

            # Handle speaker identification result
            if speaker:
                name = speaker["name"]
                changed = speaker["changed"]

                if changed:
                    old_name = session.get("speaker", "someone")
                    session["speaker"] = name
                    session["history"] = []  # fresh context for new speaker
                    change_data = socket_schemas.SpeakerChanged(from_name=old_name, to=name)
                    await sio.emit("speaker_changed", change_data.model_dump(by_alias=True), to=sid)
                    log.info("speaker_switched", from_=old, to=name, sid=sid)
                    # Rocky greets the new person before processing their utterance
                    await _greet_speaker(sid, name, sio)
                elif session.get("speaker") != name:
                    session["speaker"] = name
                    identified = socket_schemas.SpeakerIdentified(name=name)
                    await sio.emit("speaker_identified", identified.model_dump(), to=sid)

            log.info("emitting_transcript_result", sid=sid, length=len(transcript))
            await sio.emit("transcript_result", transcript, to=sid)
            await _chat(sid, transcript, sio)
        except Exception as exc:
            log.error("stt_error", error=str(exc), sid=sid)
            await sio.emit("status_update", "error", to=sid)
        finally:
            session = _session(sid)
            session["is_processing"] = False

    @sio.event
    async def voice_interrupt(sid: str, data: Optional[Any] = None) -> None:
        """Interrupts any active voice processing (Bridge + Legacy TTS)."""
        log.info("voice_interrupt_received", sid=sid)
        session = _session(sid)
        session["is_processing"] = False
        
        # 1. Interrupt Pipecat Bridge
        from ..bridges.pipecat_bridge import PipecatBridge
        await PipecatBridge().send_cancel_frame(sid)
        
        # 2. Interrupt Legacy TTS
        await _cancel_tts(sid, sio)

    @sio.event
    async def manual_activation(sid: str, data: Optional[Any] = None) -> None:
        log.info("manual_activation_received", sid=sid)
        if settings.voice_debug_events:
            await sio.emit("voice_debug", {"stage": "manual_activation_observed", "timestamp": time.time()}, to=sid)
        await sio.emit("status_update", "listening", to=sid)

    @sio.event
    async def auth_granted(sid: str, data: Dict[str, Any]) -> None:
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
    async def ping(sid: str, data: Optional[Any] = None) -> None:
        await sio.emit("pong_latency", data, to=sid)
