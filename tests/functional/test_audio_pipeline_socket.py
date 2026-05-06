import pytest
import asyncio
import socketio
import numpy as np
import time
import os

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

@pytest.mark.integration
@pytest.mark.audio
@pytest.mark.asyncio
async def test_audio_pipeline_e2e():
    """
    Functional test that sends a synthetic audio chunk to the backend
    and expects a transcript and chat response.
    """
    sio = socketio.AsyncClient()
    events = []
    
    @sio.on("*")
    async def catch_all(event, data):
        events.append((event, data))

    try:
        # 1. Connect
        try:
            await asyncio.wait_for(sio.connect(BACKEND_URL), timeout=5)
        except (asyncio.TimeoutError, Exception):
            pytest.skip(f"Backend at {BACKEND_URL} not reachable")

        # 2. Setup
        transcript_received = asyncio.Event()
        chat_received = asyncio.Event()

        @sio.on("transcript_result")
        async def on_transcript(data):
            if data:
                transcript_received.set()

        @sio.on("chat_token")
        async def on_token(data):
            chat_received.set()
        
        @sio.on("chat_response")
        async def on_response(data):
            chat_received.set()

        # 3. Activation
        await sio.emit("manual_activation")
        await asyncio.sleep(0.2)

        # 4. Generate & Send Audio
        duration = 1.0
        sample_rate = 16000
        t = np.linspace(0, duration, int(sample_rate * duration), False)
        tone = np.sin(440 * t * 2 * np.pi)
        pcm_data = (tone * 32767).astype(np.int16).tobytes()

        # Send in chunks
        chunk_size = 2048
        for i in range(0, len(pcm_data), chunk_size):
            await sio.emit("audio_chunk", pcm_data[i:i+chunk_size])
            await asyncio.sleep(0.02) # Faster for testing

        # 5. Stop
        await sio.emit("manual_stop")

        # 6. Wait for results
        try:
            # We wait up to 15s for the pipeline to finish
            await asyncio.wait_for(
                asyncio.gather(transcript_received.wait(), chat_received.wait()),
                timeout=15
            )
        except asyncio.TimeoutError:
            event_names = [e[0] for e in events]
            pytest.fail(f"Audio pipeline timed out. Events received: {event_names}")

    finally:
        if sio.connected:
            await sio.disconnect()

@pytest.mark.integration
@pytest.mark.audio
@pytest.mark.asyncio
async def test_socket_connection():
    """Simple test to verify socket connection to backend."""
    sio = socketio.AsyncClient()
    try:
        await asyncio.wait_for(sio.connect(BACKEND_URL), timeout=5)
        assert sio.connected
    except (asyncio.TimeoutError, Exception):
        pytest.skip(f"Backend at {BACKEND_URL} not reachable")
    finally:
        if sio.connected:
            await sio.disconnect()
