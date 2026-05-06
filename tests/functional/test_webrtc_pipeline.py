import pytest
import asyncio
import httpx
import os
import json
import numpy as np
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from av import AudioFrame

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

class SineWaveAudioTrack(MediaStreamTrack):
    """
    A media stream track that generates a 440Hz sine wave.
    """
    kind = "audio"

    def __init__(self):
        super().__init__()
        self.sample_rate = 16000
        self.samples_per_frame = 320  # 20ms at 16kHz
        self.frequency = 440
        self.t = 0

    async def recv(self):
        pts, time_base = self.t, 1 / self.sample_rate
        
        # Generate 20ms of sine wave
        t_arr = np.arange(self.t, self.t + self.samples_per_frame) / self.sample_rate
        data = np.sin(2 * np.pi * self.frequency * t_arr)
        
        # Convert to 16-bit PCM
        samples = (data * 32767).astype(np.int16)
        
        # Create AudioFrame
        # Note: reshapre to (channels, samples)
        frame = AudioFrame.from_ndarray(samples.reshape(1, -1), format='s16', layout='mono')
        frame.pts = pts
        frame.time_base = time_base
        frame.sample_rate = self.sample_rate
        
        self.t += self.samples_per_frame
        return frame

@pytest.mark.asyncio
async def test_webrtc_pipeline_handshake():
    """
    Validates the WebRTC SDP handshake with the backend.
    """
    pc = RTCPeerConnection()
    track = SineWaveAudioTrack()
    pc.addTrack(track)

    # 1. Create Offer
    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    # 2. Send Offer via POST
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{BACKEND_URL}/api/webrtc/offer",
                json={
                    "sdp": pc.localDescription.sdp,
                    "type": pc.localDescription.type,
                    "sid": "test-webrtc-session"
                },
                timeout=10.0
            )
        except Exception as e:
            pytest.fail(f"Could not connect to backend at {BACKEND_URL}: {e}")

        # 3. Validate Response
        assert resp.status_code == 200, f"Expected 200 OK, got {resp.status_code}"
        answer_data = resp.json()
        assert answer_data["type"] == "answer", "Response should be an SDP answer"
        assert "sdp" in answer_data, "Response should contain SDP content"

        # 4. Set Remote Description (completes handshake)
        answer = RTCSessionDescription(sdp=answer_data["sdp"], type=answer_data["type"])
        await pc.setRemoteDescription(answer)

    # 5. Validate ICE Connection State
    # We expect the state to reach 'connected' or 'completed'
    connected_event = asyncio.Event()

    @pc.on("iceconnectionstatechange")
    async def on_iceconnectionstatechange():
        print(f"ICE Connection State: {pc.iceConnectionState}")
        if pc.iceConnectionState in ["connected", "completed"]:
            connected_event.set()

    try:
        # Wait up to 10s for connection. 
        # Note: In some restricted CI environments, this might stay 'new' or 'checking'
        # if there's no network path between test runner and container.
        await asyncio.wait_for(connected_event.wait(), timeout=10.0)
        assert pc.iceConnectionState in ["connected", "completed"]
    except asyncio.TimeoutError:
        # In case of timeout, we still consider the signaling part (steps 1-4) a success
        # if we reached this point, but the media path failed.
        print(f"Warning: ICE Connection timed out in state: {pc.iceConnectionState}")
        # Depending on strictness, we could fail here or just log.
        # Given the request "Valida se o estado ... muda", we assert.
        assert pc.iceConnectionState in ["connected", "completed"], f"ICE failed to connect. State: {pc.iceConnectionState}"
    finally:
        await pc.close()

@pytest.mark.asyncio
async def test_webrtc_offer_method_not_allowed():
    """
    Ensures that the /offer endpoint correctly rejects non-POST requests.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BACKEND_URL}/api/webrtc/offer")
        assert resp.status_code == 405
