import asyncio
import re
import structlog
import litellm
import socketio

from ..config import settings
from ..core.redis_client import get_redis
from ..rocky.personality import (
    system_prompt as personality,
    emotional_states as states,
    intimacy,
)
from ..bridges import letta_bridge, azure_speaker, pipecat_bridge
from ..voice.tts import synthesize_chunks, SAMPLE_RATE
from ..tools.definitions import TOOLS
from ..tools.executor import run as run_tool
from . import ha_handlers, skills as skills_api

log = structlog.get_logger()

_sessions: dict = {}


def _session(sid: str) -> dict:
    return _sessions.setdefault(sid, {"history": [], "state": "neutral"})


# ── Sentence boundary splitter for sentence-level TTS streaming ───────────
_SENTENCE_END = re.compile(r'(?<=[.!?…])\s+')


def _pop_sentence(buf: str) -> tuple[str, str]:
    """Return (completed_sentence, remainder) or ('', buf) if no boundary yet."""
    parts = _SENTENCE_END.split(buf, maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1]
    return "", buf


# ── Core chat logic (shared by text and voice paths) ─────────────────────
async def _chat(sid: str, content: str, sio: socketio.AsyncServer) -> None:
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
    await sio.emit("system_state_update", {
        "emotional_state": new_state,
        "intimacy": round(score, 1),
        "intimacy_label": intimacy.label(score),
    }, to=sid)

    # ── Tools always run first regardless of memory backend ─────────────
    # This ensures lights/weather/timer work even when Letta is active.
    tool_response = await _try_tools(sid, content, new_state, score, session, sio, user_id=user_id)
    if tool_response:
        return  # tool handled the response

    # ── Letta (memory-backed) or direct LiteLLM ───────────────────────
    if settings.has_letta() and await letta_bridge.is_available():
        await _chat_letta(sid, content, new_state, score, session, sio, user_id=user_id)
    else:
        await _chat_litellm(sid, content, new_state, score, session, sio, user_id=user_id)


async def _try_tools(
    sid: str, content: str, state: str, score: float,
    session: dict, sio: socketio.AsyncServer,
    user_id: str | None = None,
) -> bool:
    """
    Try to handle the message via LLM tool calling.
    Returns True if a tool was called and response was sent, False otherwise.
    Only makes 1 LLM call — if tools are used a second call streams the final answer,
    but if no tools are needed the first response is used directly (zero extra cost).
    """
    import json as _json
    system = personality.build_system_prompt(
        emotional_state=state, intimacy_score=score, message=content,
    )
    if user_id and user_id != sid:
        system += f"\n\n## Speaker\nYou are speaking with {user_id}. Use their name naturally."
    messages = [{"role": "system", "content": system}, *session["history"][-20:]]
    model = settings.get_llm_model()

    try:
        # Filter out disabled tools (respects Skills page toggle)
        active_tools = [
            t for t in TOOLS
            if skills_api._overrides.get(t["function"]["name"], {}).get("enabled", True)
        ]
        first = await litellm.acompletion(
            model=model, messages=messages,
            tools=active_tools, tool_choice="auto",
            stream=False, temperature=0.85, max_tokens=1024,
        )
        choice = first.choices[0]

        if choice.finish_reason != "tool_calls" or not choice.message.tool_calls:
            return False  # No tool — let Letta/LiteLLM handle it

        # ── Tool(s) called ────────────────────────────────────────────────
        messages.append(choice.message.model_dump(exclude_none=True))
        for tc in choice.message.tool_calls:
            tool_name = tc.function.name
            tool_args = _json.loads(tc.function.arguments or "{}")
            log.info("tool_called", tool=tool_name, args=tool_args)
            result = await run_tool(tool_name, tool_args, sio=sio)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

        # Stream final answer (only call when tools were actually used)
        response = await litellm.acompletion(
            model=model, messages=messages, stream=True, temperature=0.8, max_tokens=512,
        )
        full, buf = "", ""
        async for chunk in response:
            token = chunk.choices[0].delta.content or ""
            if not token:
                continue
            full += token
            buf += token
            await sio.emit("chat_token", token, to=sid)
            if settings.has_tts():
                sentence, buf = _pop_sentence(buf)
                if sentence:
                    await _emit_tts(sid, sentence, sio, state)
        if buf.strip() and settings.has_tts():
            await _emit_tts(sid, buf.strip(), sio, state)
        session["history"].append({"role": "assistant", "content": full})
        await sio.emit("chat_response", {"text": full}, to=sid)
        await sio.emit("status_update", "idle", to=sid)
        return True

    except Exception as exc:
        log.error("tool_error", error=str(exc))
        return False  # Fall through to normal chat


async def _chat_letta(
    sid: str, content: str, state: str, score: float,
    session: dict, sio: socketio.AsyncServer,
    user_id: str | None = None,
) -> None:
    """Chat via Letta agent — full persistent memory."""
    try:
        # Send with speaker context so Letta can address the right person
        msg = content
        if user_id and user_id != sid:
            msg = f"[Speaking with: {user_id}] {content}"
        reply = await letta_bridge.send_message(msg)
        if not reply:
            log.warning("letta_empty_reply", sid=sid)
            await _chat_litellm(sid, content, state, score, session, sio, user_id=user_id)
            return

        session["history"].append({"role": "assistant", "content": reply})

        # Emit tokens word-by-word for a streaming feel
        words = reply.split(" ")
        sentence_buf = ""
        for i, word in enumerate(words):
            token = word + (" " if i < len(words) - 1 else "")
            await sio.emit("chat_token", token, to=sid)
            sentence_buf += token
            if settings.has_tts():
                sentence, sentence_buf = _pop_sentence(sentence_buf)
                if sentence:
                    await _emit_tts(sid, sentence, sio, state)

        if sentence_buf.strip() and settings.has_tts():
            await _emit_tts(sid, sentence_buf.strip(), sio, state)

        await sio.emit("chat_response", {"text": reply}, to=sid)
        await sio.emit("status_update", "idle", to=sid)
        log.info("chat_letta_ok", sid=sid, state=state, words=len(words))

    except Exception as exc:
        log.error("letta_chat_error", error=str(exc), sid=sid)
        await sio.emit("chat_error", {"message": f"Letta error: {exc}"}, to=sid)
        await sio.emit("status_update", "error", to=sid)


async def _chat_litellm(
    sid: str, content: str, state: str, score: float,
    session: dict, sio: socketio.AsyncServer,
    user_id: str | None = None,
) -> None:
    """
    Pure conversational LLM response — no tools (those are handled by _try_tools).
    Single streaming call, no wasted API cost.
    """
    system = personality.build_system_prompt(
        emotional_state=state, intimacy_score=score, message=content,
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
        async for chunk in response:
            token = chunk.choices[0].delta.content or ""
            if not token:
                continue
            full_response += token
            sentence_buf += token
            await sio.emit("chat_token", token, to=sid)
            if settings.has_tts():
                sentence, sentence_buf = _pop_sentence(sentence_buf)
                if sentence:
                    await _emit_tts(sid, sentence, sio, state)

        if sentence_buf.strip() and settings.has_tts():
            await _emit_tts(sid, sentence_buf.strip(), sio, state)

        session["history"].append({"role": "assistant", "content": full_response})
        await sio.emit("chat_response", {"text": full_response}, to=sid)
        await sio.emit("status_update", "idle", to=sid)
        log.info("chat_litellm_ok", sid=sid, state=state)

    except Exception as exc:
        log.error("llm_error", error=str(exc), sid=sid)
        await sio.emit("chat_error", {"message": f"LLM error: {exc}"}, to=sid)
        await sio.emit("status_update", "error", to=sid)


async def _greet_speaker(sid: str, name: str, sio: socketio.AsyncServer) -> None:
    """Rocky briefly acknowledges a new speaker entering the conversation."""
    greeting = f"Oh. Different human. Rocky recognise {name}. Yes?"
    await sio.emit("chat_token", greeting, to=sid)
    await sio.emit("chat_response", {"text": greeting}, to=sid)
    if settings.has_tts():
        await _emit_tts(sid, greeting, sio, "neutral")


async def _cancel_tts(sid: str, sio: socketio.AsyncServer) -> None:
    """Cancel any active TTS stream for this session and notify the client."""
    session = _session(sid)
    task: asyncio.Task | None = session.pop("tts_task", None)
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
        await sio.emit("tts_start", {"sampleRate": SAMPLE_RATE}, to=sid)
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

    @sio.event
    async def connect(sid: str, environ: dict, auth=None):
        _session(sid)
        log.info("client_connected", sid=sid)
        await sio.emit("status_update", "idle", to=sid)
        await sio.emit("chat_history", [], to=sid)
        await sio.emit("system_state_update", {"emotional_state": "neutral", "intimacy": 35.0}, to=sid)
        await sio.emit("service_status", {"service": "stt", "ok": settings.has_stt()}, to=sid)
        await sio.emit("service_status", {"service": "tts", "ok": settings.has_tts()}, to=sid)
        await sio.emit("service_status", {"service": "llm", "ok": settings.has_llm()}, to=sid)

        # Push HA state (lights, areas, protocols) — runs in background so connect is not delayed
        import asyncio
        asyncio.create_task(ha_handlers.push_initial_state(sid, sio))

        if not settings.has_llm():
            await sio.emit("chat_response", {
                "text": "Rocky here. No LLM API key found. Set GROQ_API_KEY in .env and restart."
            }, to=sid)

    @sio.event
    async def disconnect(sid: str):
        session = _sessions.get(sid)
        if session and "pipecat_bridge" in session:
            await session["pipecat_bridge"].stop()
        
        _sessions.pop(sid, None)
        await azure_speaker.clear_session(sid)
        log.info("client_disconnected", sid=sid)

    @sio.event
    async def chat_request(sid: str, data):
        content = (data.get("content", "") if isinstance(data, dict) else str(data)).strip()
        if not content or not settings.has_llm():
            if not settings.has_llm():
                await sio.emit("chat_error", {"message": "No LLM API key."}, to=sid)
            return
        await _chat(sid, content, sio)

    @sio.event
    async def audio_blob(sid: str, data):
        """Complete audio recording from MediaRecorder → STT → chat → TTS."""
        # Interrupt any currently-playing TTS before starting new speech processing
        await _cancel_tts(sid, sio)

        if not settings.has_stt():
            await sio.emit("chat_error", {"message": "STT unavailable — set GROQ_API_KEY"}, to=sid)
            return

        from ..voice.stt import transcribe

        await sio.emit("status_update", "processing_stt", to=sid)
        try:
            transcript = await transcribe(bytes(data) if not isinstance(data, bytes) else data)
            if not transcript:
                await sio.emit("status_update", "idle", to=sid)
                return
            await sio.emit("transcript_result", transcript, to=sid)
            if settings.has_llm():
                await _chat(sid, transcript, sio)
            else:
                await sio.emit("status_update", "idle", to=sid)
        except Exception as exc:
            log.error("stt_error", error=str(exc), sid=sid)
            await sio.emit("chat_error", {"message": f"STT error: {exc}"}, to=sid)
            await sio.emit("status_update", "error", to=sid)

    @sio.event
    async def audio_chunk(sid: str, data):
        """Streaming PCM chunks — 2026 Pipecat Pipeline."""
        log.info("audio_chunk_received", type=type(data).__name__, size=len(data) if hasattr(data, "__len__") else "N/A")
        session = _session(sid)
        
        # 1. Barge-in detection
        if "tts_task" in session and not session["tts_task"].done():
            await _cancel_tts(sid, sio)

        # 2. Pipecat Bridge (Streaming)
        print(f"DEBUG: HAS PIPECAT? {settings.has_pipecat()} - URL: {settings.voice_engine_url}")
        if settings.has_pipecat():
            # log.debug("audio_chunk_pipecat", sid=sid)
            bridge = session.get("pipecat_bridge")
            if not bridge:
                log.info("pipecat_bridge_initializing", sid=sid)
                bridge = pipecat_bridge.PipecatBridge(sid, sio)
                session["pipecat_bridge"] = bridge
                await bridge.start()
            
            await bridge.send_audio(bytes(data) if not isinstance(data, bytes) else data)
            return {"success": True, "streamed": True}

        # 3. Legacy accumulation fallback
        buf = session.setdefault("audio_buf", bytearray())
        buf.extend(bytes(data) if not isinstance(data, bytes) else data)

        if len(buf) > 960_000:
            buf.clear()
            
        return {"success": True, "accumulated": True}

    @sio.event
    async def manual_stop(sid: str, data=None):
        """User stopped speaking — cancel any TTS, then STT + speaker ID → chat."""
        import asyncio as _asyncio
        from ..voice.stt import transcribe

        # Interrupt any active TTS first (barge-in when using manual stop flow)
        await _cancel_tts(sid, sio)

        session = _session(sid)
        buf: bytearray = session.pop("audio_buf", bytearray())

        if not buf or not settings.has_stt():
            await sio.emit("status_update", "idle", to=sid)
            return

        pcm = bytes(buf)
        await sio.emit("status_update", "processing_stt", to=sid)
        try:
            async def _no_speaker():
                return None

            # Run STT and speaker ID concurrently — speaker ID is free if cached
            transcript, speaker = await _asyncio.gather(
                transcribe(pcm, filename="audio.raw"),
                azure_speaker.identify(pcm, sid) if settings.has_speaker_id() else _no_speaker(),
            )
            if not transcript:
                await sio.emit("status_update", "idle", to=sid)
                return

            # Handle speaker identification result
            if speaker:
                name = speaker["name"]
                changed = speaker["changed"]

                if changed:
                    old = session.get("speaker", "someone")
                    session["speaker"] = name
                    session["history"] = []  # fresh context for new speaker
                    await sio.emit("speaker_changed", {"from": old, "to": name}, to=sid)
                    log.info("speaker_switched", from_=old, to=name, sid=sid)
                    # Rocky greets the new person before processing their utterance
                    await _greet_speaker(sid, name, sio)
                elif session.get("speaker") != name:
                    session["speaker"] = name
                    await sio.emit("speaker_identified", {"name": name}, to=sid)

            await sio.emit("transcript_result", transcript, to=sid)
            await _chat(sid, transcript, sio)
        except Exception as exc:
            log.error("stt_error", error=str(exc), sid=sid)
            await sio.emit("status_update", "error", to=sid)

    @sio.event
    async def manual_activation(sid: str, data=None):
        await sio.emit("status_update", "listening", to=sid)

    @sio.event
    async def ping(sid: str, data=None):
        await sio.emit("pong_latency", data, to=sid)
