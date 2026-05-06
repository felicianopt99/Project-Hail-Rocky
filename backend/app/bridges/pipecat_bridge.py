import asyncio
import time
import websockets
import structlog
import json
from typing import Optional

from ..config import settings

log = structlog.get_logger()

class PipecatBridge:
    """
    Bridge that connects the Backend to the Voice Engine's Pipecat pipeline.
    It relays audio chunks from Socket.io to the Pipecat WebSocket.
    """

    def __init__(self, sid: str, sio_server):
        self._sid = sid
        self._sio = sio_server
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._starting = False
        self._queue = asyncio.Queue()

    async def start(self):
        if self._ws or self._starting:
            return

        self._starting = True
        base_url = settings.voice_engine_url.replace("http://", "ws://")
        url = f"{base_url}/voice?sid={self._sid}"
        
        max_retries = 5
        backoff = 0.5
        
        for attempt in range(max_retries):
            try:
                log.info("pipecat_bridge_connecting", url=url, attempt=attempt+1)
                # Increase timeout for handshake to 20s
                self._ws = await websockets.connect(url, open_timeout=20)
                self._running = True
                self._task = asyncio.create_task(self._listen())
                log.info("pipecat_bridge_started", sid=self._sid)
                
                if settings.voice_debug_events:
                    await self._sio.emit("voice_debug", {"stage": "bridge_started", "timestamp": time.time()}, to=self._sid)
                
                # Flush buffered audio
                while not self._queue.empty():
                    chunk = await self._queue.get()
                    await self._ws.send(chunk)
                
                self._starting = False
                return # Success!
                
            except (ConnectionRefusedError, OSError) as e:
                log.warning("pipecat_bridge_retry", attempt=attempt+1, error=str(e), next_retry_in=backoff)
                if attempt == max_retries - 1:
                    log.error("pipecat_bridge_max_retries_reached", error=str(e))
                    await self._sio.emit("voice_error", {
                        "code": "VOICE_ENGINE_UNAVAILABLE",
                        "message": f"Voice Engine unavailable after {max_retries} attempts."
                    }, to=self._sid)
                    await self._sio.emit("status_update", "error", to=self._sid)
                else:
                    await asyncio.sleep(backoff)
                    backoff *= 2 # Exponential backoff
            except Exception as e:
                log.error("pipecat_bridge_unexpected_error", error=str(e))
                await self._sio.emit("voice_error", {"message": f"Bridge Error: {e}"}, to=self._sid)
                break
        
        self._ws = None
        self._starting = False

    async def send_audio(self, chunk: bytes):
        if not self._ws or not self._running:
            # Buffer audio while connecting
            await self._queue.put(chunk)
            if not self._starting:
                await self.start()
            return
            
        if self._ws:
            try:
                await self._ws.send(chunk)
            except Exception as e:
                log.error("pipecat_bridge_send_error", error=str(e))
                self._running = False

    async def _listen(self):
        """Listen for audio output from Pipecat and relay to Socket.io client."""
        log.info("pipecat_bridge_listen_loop_started")
        try:
            async for message in self._ws:
                if isinstance(message, bytes):
                    # Relay PCM chunk back to frontend
                    # log.debug("pipecat_bridge_received_audio", size=len(message))
                    await self._sio.emit("tts_chunk", message, to=self._sid)
                else:
                    # Handle control messages (json)
                    try:
                        data = json.loads(message)
                        msg_type = data.get("type")
                        log.info("pipecat_bridge_received_control", type=msg_type)
                        
                        if msg_type == "voice_error":
                            await self._sio.emit("voice_error", data, to=self._sid)
                        elif msg_type == "voice_debug":
                            await self._sio.emit("voice_debug", data, to=self._sid)
                        elif msg_type == "tts_start":
                            await self._sio.emit("tts_start", data, to=self._sid)
                            await self._sio.emit("status_update", "synthesizing_tts", to=self._sid)
                        elif msg_type == "tts_end":
                            await self._sio.emit("tts_end", to=self._sid)
                        elif msg_type == "transcript":
                            await self._sio.emit("transcript_result", data.get("text"), to=self._sid)
                            await self._sio.emit("status_update", "processing_stt", to=self._sid)
                        elif msg_type == "chat_token":
                            await self._sio.emit("chat_token", data.get("token"), to=self._sid)
                            await self._sio.emit("status_update", "thinking_llm", to=self._sid)
                        elif msg_type == "chat_response":
                            await self._sio.emit("chat_response", {"text": data.get("text")}, to=self._sid)
                            # chat_response usually precedes tts_end or is concurrent. 
                            # We don't force idle here as TTS might still be playing.
                    except Exception as e:
                        log.warning("pipecat_bridge_parse_error", message=message, error=str(e))
        except websockets.ConnectionClosed as e:
            log.info("pipecat_bridge_closed", sid=self._sid, code=e.code, reason=e.reason)
        except Exception as e:
            log.error("pipecat_bridge_listen_error", error=str(e))
        finally:
            self._running = False
            log.info("pipecat_bridge_listen_loop_stopped")

    async def send_cancel_frame(self):
        """Sends an interruption message (CancelFrame) to the Voice Engine."""
        if self._ws and self._running:
            try:
                log.info("pipecat_bridge_sending_cancel", sid=self._sid)
                await self._ws.send(json.dumps({"type": "cancel"}))
            except Exception as e:
                log.error("pipecat_bridge_cancel_error", error=str(e))

    async def send_eot(self):
        """Sends an End-of-Turn signal to the Voice Engine."""
        if self._ws and self._running:
            try:
                log.info("pipecat_bridge_sending_eot", sid=self._sid)
                await self._ws.send(json.dumps({"type": "end_of_turn"}))
            except Exception as e:
                log.error("pipecat_bridge_eot_error", error=str(e))

    async def stop(self):
        self._running = False
        
        # Clear any pending audio buffers
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        
        if self._ws:
            await self._ws.close()
            self._ws = None
        if self._task:
            self._task.cancel()
            self._task = None
