import asyncio
import structlog
from fastapi import APIRouter, Request
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import MediaStreamTrack

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

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        log.info("webrtc_connection_state", state=pc.connectionState, sid=sid)
        if pc.connectionState in ["failed", "closed"]:
            await pc.close()
            if session.get("webrtc_pc") == pc:
                session.pop("webrtc_pc", None)

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
            bridge = PipecatBridge(sid, sio_instance)
            session["pipecat_bridge"] = bridge
            await bridge.start()
        else:
            log.error("webrtc_bridge_fail_no_sio", sid=sid)
            return

    try:
        while True:
            frame = await track.recv()
            
            # AIORTC provides AudioFrame objects.
            # STT/Pipecat typically expects 16-bit PCM, 16kHz, Mono.
            # Note: Production systems should use an av.AudioResampler here if 
            # the browser sends a different sample rate.
            
            # Extract raw PCM data
            # to_ndarray() returns (channels, samples)
            data = frame.to_ndarray().tobytes()
            
            if bridge and bridge._running:
                await bridge.send_audio(data)
                
    except Exception as e:
        # Expected when track ends or connection closes
        log.info("webrtc_audio_processor_stopped", sid=sid, reason=str(e))
