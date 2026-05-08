import asyncio
import structlog
import numpy as np
from math import gcd
from fastapi import APIRouter, Request
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import MediaStreamTrack, AudioStreamTrack
from av import AudioFrame
from scipy.signal import resample_poly

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
        self._queue = asyncio.Queue(maxsize=200)
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
        except asyncio.QueueFull:
            log.warning("webrtc_audio_queue_full_dropping_frame")
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

_TARGET_RATE = 16000  # Voice engine expects 16kHz mono int16


def _to_mono_16k(frame: AudioFrame) -> bytes:
    """Convert an aiortc AudioFrame to mono 16kHz int16 bytes.

    aiortc decodes Opus to different formats depending on the libav version:
      s16  — signed 16-bit interleaved, shape (1, samples*channels)
      s16p — signed 16-bit planar,      shape (channels, samples)
      fltp — float32 planar,            shape (channels, samples), values in [-1, 1]
      flt  — float32 packed,            shape (1, samples*channels), values in [-1, 1]

    Treating float32 as int16 directly produces near-zero values (silence), so we
    must scale to int16 range first.
    """
    fmt = frame.format.name
    src_rate = frame.sample_rate
    num_channels = len(frame.layout.channels)
    arr = frame.to_ndarray()

    if "flt" in fmt:
        # Float32 planar (fltp) or packed (flt): values in [-1.0, 1.0]
        arr_i16 = np.clip(arr * 32768.0, -32768, 32767).astype(np.int16)
        if arr_i16.ndim > 1 and arr_i16.shape[0] > 1:
            mono = arr_i16.mean(axis=0).astype(np.int16)
        else:
            mono = arr_i16.flatten()
    elif fmt == "s16p":
        # Int16 planar: shape (channels, samples)
        mono = arr.mean(axis=0).astype(np.int16) if arr.shape[0] > 1 else arr.flatten()
    else:
        # s16 interleaved: shape (1, samples*channels)
        flat = arr.flatten().astype(np.int16)
        mono = flat.reshape(-1, num_channels).mean(axis=1).astype(np.int16) if num_channels > 1 else flat

    # Resample using float32 to avoid clipping artefacts
    if src_rate != _TARGET_RATE:
        g = gcd(_TARGET_RATE, src_rate)
        resampled = resample_poly(mono.astype(np.float32), _TARGET_RATE // g, src_rate // g)
        mono = np.clip(resampled, -32768, 32767).astype(np.int16)

    return mono.tobytes()


async def process_audio_track(track: MediaStreamTrack, sid: str):
    """
    Consumes the WebRTC audio track, converts to 16kHz mono int16,
    and pipes PCM chunks to the Pipecat Bridge → Voice Engine.
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

    frames_seen = 0
    try:
        while True:
            frame = await track.recv()

            # One-shot diagnostic on the first frame: tells us if aiortc decoded
            # the Opus stream as s16, fltp, etc., and the actual amplitude range.
            if frames_seen == 0:
                arr = frame.to_ndarray()
                log.info(
                    "webrtc_first_frame_diagnostic",
                    sid=sid,
                    fmt=frame.format.name,
                    rate=frame.sample_rate,
                    channels=len(frame.layout.channels),
                    shape=str(arr.shape),
                    dtype=str(arr.dtype),
                    abs_max=float(np.abs(arr).max()),
                    abs_mean=float(np.abs(arr).mean()),
                )

            data = _to_mono_16k(frame)

            # Periodic amplitude check: if the audio is silence the int16 max
            # will hover around 0, otherwise it climbs into the thousands.
            if frames_seen % 200 == 0:
                samples = np.frombuffer(data, dtype=np.int16)
                log.info(
                    "webrtc_audio_amplitude",
                    sid=sid,
                    frame=frames_seen,
                    int16_abs_max=int(np.abs(samples).max()) if samples.size else 0,
                    int16_abs_mean=int(np.abs(samples).mean()) if samples.size else 0,
                )

            frames_seen += 1
            await bridge.send_audio(sid, data)

    except Exception as e:
        log.info("webrtc_audio_processor_stopped", sid=sid, reason=str(e))
