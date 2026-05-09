import asyncio
import time
import websockets
import structlog
import json
from typing import Any, Optional

from ..config import settings
from ..core.trace import get_trace_id, set_trace_id
from ..core.redis_client import get_redis
from ..schemas import socket_schemas

log = structlog.get_logger()

class PipecatBridge:
    """
    Singleton Bridge that connects the Backend to the Voice Engine's Pipecat pipeline.
    It manages multiple session connections and handles automatic recovery.
    """
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super(PipecatBridge, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, sio_server=None):
        if sio_server:
            self._sio = sio_server
        if self._initialized:
            return
        self._sessions: dict[str, Any] = {}
        self._running = False
        self._initialized = True
        self._watchdog_task = asyncio.create_task(self._watchdog())
        log.info("pipecat_bridge_initialized")

    async def _get_connection(self, sid: str):
        if sid not in self._sessions:
            trace_id = await self._load_trace_id(sid) or get_trace_id() or set_trace_id()
            self._sessions[sid] = {
                "ws": None,
                "task": None,
                "running": False,
                "starting": False,
                "queue": asyncio.Queue(maxsize=50),
                "retry_count": 0,
                "trace_id": trace_id,
                "last_activity": time.time(),
            }
        return self._sessions[sid]

    async def _load_trace_id(self, sid: str) -> str | None:
        try:
            redis = await get_redis()
            if redis:
                return await redis.get(f"rocky:bridge:trace:{sid}")
        except Exception:
            pass
        return None

    async def _persist_session(self, sid: str) -> None:
        session = self._sessions.get(sid)
        if not session:
            return
        try:
            redis = await get_redis()
            if redis:
                await redis.setex(f"rocky:bridge:trace:{sid}", 1800, session["trace_id"])
        except Exception:
            pass

    async def _clear_session(self, sid: str) -> None:
        try:
            redis = await get_redis()
            if redis:
                await redis.delete(f"rocky:bridge:trace:{sid}")
        except Exception:
            pass

    async def start(self, sid: str):
        self._running = True # Mark as running immediately when starting/connecting
        session = await self._get_connection(sid)
        if session["ws"] or session["starting"]:
            return

        session["starting"] = True
        trace_id = session["trace_id"]
        
        # Ensure structlog has the trace_id in context
        structlog.contextvars.bind_contextvars(trace_id=trace_id)

        base_url = settings.voice_engine_url.replace("http://", "ws://")
        url = f"{base_url}/voice?sid={sid}&trace_id={trace_id}"
        
        max_retries = 5
        backoff = 0.5
        
        for attempt in range(max_retries):
            try:
                log.info("pipecat_bridge_connecting", url=url, attempt=attempt+1, sid=sid)
                session["ws"] = await websockets.connect(url, open_timeout=20, ping_interval=20, ping_timeout=10)
                session["running"] = True
                self._running = True
                session["task"] = asyncio.create_task(self._listen(sid))
                await self._persist_session(sid)
                log.info("pipecat_bridge_started", sid=sid, trace_id=trace_id)

                if settings.voice_debug_events:
                    await self._sio.emit("voice_debug", {"stage": "bridge_started", "timestamp": time.time()}, to=sid)

                # Flush buffered audio
                while not session["queue"].empty():
                    chunk = await session["queue"].get()
                    await session["ws"].send(chunk)
                
                session["starting"] = False
                session["retry_count"] = 0
                return # Success!
                
            except (ConnectionRefusedError, OSError, websockets.InvalidMessage) as e:
                log.warning("pipecat_bridge_retry", attempt=attempt+1, error=str(e), sid=sid)
                if attempt == max_retries - 1:
                    log.error("pipecat_bridge_max_retries_reached", error=str(e), sid=sid)
                    await self._sio.emit("voice_error", {
                        "code": "VOICE_ENGINE_UNAVAILABLE",
                        "message": f"Voice Engine unavailable after {max_retries} attempts."
                    }, to=sid)
                else:
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 30)
            except Exception as e:
                log.error("pipecat_bridge_unexpected_error", error=str(e), sid=sid)
                break
        
        session["ws"] = None
        session["starting"] = False
        self._running = any(s.get("running") or s.get("starting") for s in self._sessions.values())

    async def send_audio(self, sid: str, chunk: bytes):
        session = await self._get_connection(sid)
        session["last_activity"] = time.time()
        
        if not session["ws"] or not session["running"]:
            # Drop oldest frame if queue is full to prevent blocking
            if session["queue"].full():
                try:
                    session["queue"].get_nowait()
                except asyncio.QueueEmpty:
                    pass
            
            try:
                session["queue"].put_nowait(chunk)
            except asyncio.QueueFull:
                pass

            if not session["starting"]:
                await self.start(sid)
            return
            
        try:
            await session["ws"].send(chunk)
        except Exception as e:
            log.error("pipecat_bridge_send_error", error=str(e), sid=sid)
            session["running"] = False
            await self._handle_reconnection(sid)

    async def _handle_reconnection(self, sid: str):
        """Attempt to recover the session without losing Letta context."""
        session = await self._get_connection(sid)
        if session["starting"]:
            return

        log.warning("pipecat_bridge_recovering", sid=sid)
        await self._sio.emit("VOICE_RECOVERING", {"sid": sid}, to=sid)
        
        # Clean up old connection
        if session["ws"]:
            try:
                await session["ws"].close()
            except Exception:
                pass
            session["ws"] = None

        # Robust cleanup of old task (Requirement 2)
        if session["task"]:
            task = session["task"]
            task.cancel()
            try:
                # Wait for cancellation with timeout
                await asyncio.wait_for(task, timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
            session["task"] = None

        # Discard stale audio buffered from the failed session.
        # Replaying it into the new pipeline would arrive before StartFrame
        # and leave every processor in an uninitialised state.
        while not session["queue"].empty():
            session["queue"].get_nowait()

        # Restart
        await self.start(sid)

    async def _listen(self, sid: str):
        """Listen for audio output from Pipecat and relay to WebRTC or Socket.io."""
        session = await self._get_connection(sid)
        trace_id = session["trace_id"]
        structlog.contextvars.bind_contextvars(trace_id=trace_id, sid=sid)
        
        log.info("pipecat_bridge_listen_loop_started")
        from ..api.socketio_handlers import _session
        
        sample_rate = 24000
        
        try:
            async for message in session["ws"]:
                session["last_activity"] = time.time() # Update activity on engine events
                if isinstance(message, bytes):
                    sess_data = _session(sid)
                    webrtc_track = sess_data.get("webrtc_audio_track")
                    
                    if webrtc_track:
                        webrtc_track.add_audio(message, sample_rate=sample_rate)
                    else:
                        await self._sio.emit("tts_chunk", message, to=sid)
                else:
                    try:
                        data = json.loads(message)
                        msg_type = data.get("type")
                        
                        if msg_type == "voice_error":
                            await self._sio.emit("voice_error", data, to=sid)
                        elif msg_type == "voice_debug":
                            await self._sio.emit("voice_debug", data, to=sid)
                        elif msg_type == "tts_start":
                            sample_rate = data.get("sampleRate", 24000)
                            start_payload = socket_schemas.TtsStart(sampleRate=sample_rate)
                            await self._sio.emit("tts_start", start_payload.model_dump(), to=sid)
                            await self._sio.emit("status_update", "synthesizing_tts", to=sid)
                        elif msg_type == "tts_end":
                            await self._sio.emit("tts_end", to=sid)
                        elif msg_type == "transcript":
                            await self._sio.emit("transcript_result", data.get("text"), to=sid)
                            await self._sio.emit("status_update", "processing_stt", to=sid)
                        elif msg_type == "chat_token":
                            await self._sio.emit("chat_token", data.get("token"), to=sid)
                        elif msg_type == "chat_response":
                            resp = socket_schemas.ChatResponse(text=data.get("text", ""))
                            await self._sio.emit("chat_response", resp.model_dump(), to=sid)
                            await self._sio.emit("status_update", "idle", to=sid)
                    except Exception as e:
                        log.warning("pipecat_bridge_parse_error", message=message, error=str(e))
        except websockets.ConnectionClosed as e:
            log.info("pipecat_bridge_closed", sid=sid, code=e.code, reason=e.reason)
            if e.code != 1000: # Abnormal closure
                await self._handle_reconnection(sid)
        except Exception as e:
            log.error("pipecat_bridge_listen_error", error=str(e))
            await self._handle_reconnection(sid)
        finally:
            session["running"] = False
            log.info("pipecat_bridge_listen_loop_stopped")

    async def _watchdog(self):
        """Silently cleans up inactive sessions (Requirement 3)."""
        while True:
            try:
                await asyncio.sleep(30)
                now = time.time()
                to_remove = []
                
                # Check for inactive sessions (> 120s)
                for sid, session in list(self._sessions.items()):
                    if now - session.get("last_activity", 0) > 120:
                        to_remove.append(sid)
                
                for sid in to_remove:
                    log.info("pipecat_bridge_watchdog_cleanup", sid=sid)
                    await self.stop(sid)
            except Exception as e:
                log.error("pipecat_bridge_watchdog_error", error=str(e))

    async def send_cancel_frame(self, sid: str):
        session = await self._get_connection(sid)
        if session["ws"] and session["running"]:
            try:
                await session["ws"].send(json.dumps({"type": "cancel"}))
            except Exception:
                pass

    async def interrupt_speech(self, sid: str):
        """Alias for send_cancel_frame for broader compatibility."""
        await self.send_cancel_frame(sid)

    async def send_eot(self, sid: str):
        session = await self._get_connection(sid)
        if session["ws"] and session["running"]:
            try:
                await session["ws"].send(json.dumps({"type": "end_of_turn"}))
            except Exception:
                pass

    def is_session_running(self, sid: str) -> bool:
        """Check if a specific session is currently active (running or starting)."""
        session = self._sessions.get(sid)
        return bool(session and (session.get("running") or session.get("starting")))

    async def stop(self, sid: str):
        if sid not in self._sessions:
            return
        session = self._sessions[sid]
        session["running"] = False
        session["starting"] = False
        
        # Update global running state: True if any session is running or starting
        self._running = any(s.get("running") or s.get("starting") for s in self._sessions.values())
        
        while not session["queue"].empty():
            try:
                session["queue"].get_nowait()
            except asyncio.QueueEmpty:
                break
        
        if session["ws"]:
            await asyncio.sleep(0.05)
            try:
                await session["ws"].close()
            except Exception:
                pass
            session["ws"] = None
        if session["task"]:
            session["task"].cancel()
            session["task"] = None

        await self._clear_session(sid)
        self._sessions.pop(sid, None)

    async def stop_all(self):
        sids = list(self._sessions.keys())
        for sid in sids:
            await self.stop(sid)
