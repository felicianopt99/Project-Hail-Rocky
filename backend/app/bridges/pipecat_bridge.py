import asyncio
import time
import websockets
import structlog
import json
from typing import Optional, Dict

from ..config import settings
from ..core.trace import get_trace_id, set_trace_id
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
        self._sessions: Dict[str, Dict[str, Any]] = {} # sid -> connection info
        self._initialized = True
        log.info("pipecat_bridge_initialized")

    async def _get_connection(self, sid: str):
        if sid not in self._sessions:
            self._sessions[sid] = {
                "ws": None,
                "task": None,
                "running": False,
                "starting": False,
                "queue": asyncio.Queue(),
                "retry_count": 0,
                "trace_id": get_trace_id() or set_trace_id()
            }
        return self._sessions[sid]

    async def start(self, sid: str):
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
                session["ws"] = await websockets.connect(url, open_timeout=20)
                session["running"] = True
                session["task"] = asyncio.create_task(self._listen(sid))
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
                    backoff *= 2
            except Exception as e:
                log.error("pipecat_bridge_unexpected_error", error=str(e), sid=sid)
                break
        
        session["ws"] = None
        session["starting"] = False

    async def send_audio(self, sid: str, chunk: bytes):
        session = await self._get_connection(sid)
        if not session["ws"] or not session["running"]:
            await session["queue"].put(chunk)
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
            except:
                pass
            session["ws"] = None
        
        if session["task"]:
            session["task"].cancel()
            session["task"] = None
            
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
                            await self._sio.emit("status_update", "thinking_llm", to=sid)
                        elif msg_type == "chat_response":
                            resp = socket_schemas.ChatResponse(text=data.get("text", ""))
                            await self._sio.emit("chat_response", resp.model_dump(), to=sid)
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

    async def send_cancel_frame(self, sid: str):
        session = await self._get_connection(sid)
        if session["ws"] and session["running"]:
            try:
                await session["ws"].send(json.dumps({"type": "cancel"}))
            except Exception:
                pass

    async def send_eot(self, sid: str):
        session = await self._get_connection(sid)
        if session["ws"] and session["running"]:
            try:
                await session["ws"].send(json.dumps({"type": "end_of_turn"}))
            except Exception:
                pass

    async def stop(self, sid: str):
        if sid not in self._sessions:
            return
        session = self._sessions[sid]
        session["running"] = False
        
        while not session["queue"].empty():
            try:
                session["queue"].get_nowait()
            except asyncio.QueueEmpty:
                break
        
        if session["ws"]:
            await asyncio.sleep(0.05)
            try:
                await session["ws"].close()
            except:
                pass
            session["ws"] = None
        if session["task"]:
            session["task"].cancel()
            session["task"] = None
        
        # Keep the session entry for potential trace_id reuse if disconnected briefly,
        # but usually we want to clear it on disconnect.
        # self._sessions.pop(sid, None)

    async def stop_all(self):
        sids = list(self._sessions.keys())
        for sid in sids:
            await self.stop(sid)
