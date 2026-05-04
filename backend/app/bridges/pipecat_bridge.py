import asyncio
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
        # Voice engine URL from settings (e.g. http://127.0.0.1:8880 -> ws://127.0.0.1:8880/voice)
        base_url = settings.voice_engine_url.replace("http://", "ws://")
        url = f"{base_url}/voice?sid={self._sid}"
        
        try:
            log.info("pipecat_bridge_connecting", url=url)
            # Increase timeout for handshake to 20s
            self._ws = await websockets.connect(url, open_timeout=20)
            self._running = True
            self._task = asyncio.create_task(self._listen())
            log.info("pipecat_bridge_started", sid=self._sid)
            
            # Flush buffered audio
            while not self._queue.empty():
                chunk = await self._queue.get()
                await self._ws.send(chunk)
                log.debug("pipecat_bridge_flushed_chunk", size=len(chunk))
        except Exception as e:
            log.error("pipecat_bridge_start_failed", error=str(e))
            self._ws = None
        finally:
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
                        log.info("pipecat_bridge_received_control", type=data.get("type"))
                        if data.get("type") == "tts_start":
                            await self._sio.emit("tts_start", data, to=self._sid)
                        elif data.get("type") == "tts_end":
                            await self._sio.emit("tts_end", to=self._sid)
                    except:
                        log.warning("pipecat_bridge_unknown_message", message=message)
        except websockets.ConnectionClosed as e:
            log.info("pipecat_bridge_closed", sid=self._sid, code=e.code, reason=e.reason)
        except Exception as e:
            log.error("pipecat_bridge_listen_error", error=str(e))
        finally:
            self._running = False
            log.info("pipecat_bridge_listen_loop_stopped")

    async def stop(self):
        self._running = False
        if self._ws:
            await self._ws.close()
            self._ws = None
        if self._task:
            self._task.cancel()
            self._task = None
