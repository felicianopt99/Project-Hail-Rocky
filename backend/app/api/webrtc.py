import asyncio
import structlog
import numpy as np
from fastapi import APIRouter, Request
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import MediaStreamTrack, AudioStreamTrack
from av import AudioFrame

from .socketio_handlers import _session
from ..bridges.pipecat_bridge import PipecatBridge
from ..config import settings

log = structlog.get_logger()
router = APIRouter()

# Global reference to Socket.io server, will be set by main.py
sio_instance = None

def set_sio(sio):
    global sio_instance
    sio_instance = sio


class PipecatAudioTrack(AudioStreamTrack):
    """
    Outgoing WebRTC track that transmits audio from Pipecat to the browser.
    """
    def __init__(self):
        super().__init__()
        self._queue = asyncio.Queue()
        self._next_pts = 0

    async def recv(self):
        # Wait for a frame from the queue
        frame = await self._queue.get()
        
        # Ensure PTS is set for correct timing in the browser
        frame.pts = self._next_pts
        self._next_pts += frame.samples
            
        return frame

    def add_audio(self, data: bytes, sample_rate: int = 24000):
        """Pushes raw PCM data as an AudioFrame into the track."""
        try:
            # Convert raw bytes (S16LE) to numpy array
            samples = np.frombuffer(data, dtype=np.int16)
            
            # Reshape for mono (1, samples)
            samples = samples.reshape(1, -1)
            
            # Create AudioFrame
            frame = AudioFrame.from_ndarray(samples, format='s16', layout='mono')
            frame.sample_rate = sample_rate
            frame.time_base = 1 / sample_rate
            
            self._queue.put_nowait(frame)
        except Exception as e:
            log.error("webrtc_add_audio_error", error=str(e))


@router.post("/offer")
async def offer(request: Request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    sid = params.get("sid")

    pc = RTCPeerConnection()
    
    # Store PC in session to prevent GC and allow cleanup
    session = _session(sid)
    
    # Close existing connection if any
    old_pc = session.get("webrtc_pc")
    if old_pc:
        await old_pc.close()
    
    session["webrtc_pc"] = pc

    # Create outgoing track for Rocky's voice
    outgoing_track = PipecatAudioTrack()
    session["webrtc_audio_track"] = outgoing_track
    pc.addTrack(outgoing_track)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        log.info("webrtc_connection_state", state=pc.connectionState, sid=sid)
        if pc.connectionState in ["failed", "closed"]:
            await pc.close()
            if session.get("webrtc_pc") == pc:
                session.pop("webrtc_pc", None)
                session.pop("webrtc_audio_track", None)

    @pc.on("track")
    def on_track(track: MediaStreamTrack):
        log.info("webrtc_track_received", kind=track.kind, sid=sid)
        if track.kind == "audio":
            asyncio.ensure_future(process_audio_track(track, sid))

    # Handle the offer
    await pc.setRemoteDescription(offer)
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return {
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type
    }

async def process_audio_track(track: MediaStreamTrack, sid: str):
    """
    Consumes the WebRTC audio track and pipes PCM chunks to the Pipecat Bridge.
    This replaces the WebSocket-based pcm-processor.
    """
    log.info("webrtc_audio_processor_started", sid=sid)
    
    session = _session(sid)
    bridge = session.get("pipecat_bridge")
    
    if not bridge:
        if sio_instance:
            log.info("webrtc_init_bridge", sid=sid)
            bridge = PipecatBridge(sio_instance)
            session["pipecat_bridge"] = bridge
            await bridge.start(sid)
        else:
            log.error("webrtc_bridge_fail_no_sio", sid=sid)
            return

    try:
        while True:
            frame = await track.recv()
            
            # Extract raw PCM data from incoming track (User -> Backend)
            # to_ndarray() returns (channels, samples)
            data = frame.to_ndarray().tobytes()
            
            if bridge:
                # Note: bridge is now a singleton manager, but we stored it in session for convenience
                # We could also just call PipecatBridge().send_audio(sid, data)
                await bridge.send_audio(sid, data)
                
    except Exception as e:
        # Expected when track ends or connection closes
        log.info("webrtc_audio_processor_stopped", sid=sid, reason=str(e))
