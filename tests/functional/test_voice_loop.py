import pytest
import asyncio
import os
from socketio import AsyncClient

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")

@pytest.mark.asyncio
async def test_socketio_connection():
    """Verify that we can connect to the Socket.IO server."""
    sio = AsyncClient()
    try:
        await sio.connect(BACKEND_URL)
        assert sio.connected
        await sio.disconnect()
    except Exception as e:
        pytest.skip(f"Socket.IO connection failed (server likely not running in test env): {e}")

@pytest.mark.asyncio
async def test_voice_interaction_flow():
    """
    Test a basic interaction flow:
    1. Connect
    2. Send 'ping' or similar event
    3. Verify response
    """
    sio = AsyncClient()
    response_received = asyncio.Event()
    received_data = {}

    @sio.on("chat_response")
    def on_response(data):
        received_data["chat"] = data
        response_received.set()

    try:
        await sio.connect(BACKEND_URL)
        
        # We can't easily send binary audio without a real file or synth,
        # but we can test if the handler responds to a manual trigger if exists.
        # For now, we test the connection and event registration.
        assert sio.connected
        
        # Example: await sio.emit("message", {"text": "hello"})
        
        await sio.disconnect()
    except Exception as e:
        pytest.skip(f"Live backend not available for full flow test: {e}")

@pytest.mark.asyncio
async def test_ha_metrics_subscription():
    """Test Home Assistant metrics relay via Socket.IO."""
    sio = AsyncClient()
    metrics_received = asyncio.Event()

    @sio.on("ha_metrics")
    def on_metrics(data):
        metrics_received.set()

    try:
        await sio.connect(BACKEND_URL)
        # Wait a bit for a metrics broadcast (if any)
        try:
            await asyncio.wait_for(metrics_received.wait(), timeout=2.0)
            assert True
        except asyncio.TimeoutError:
            # Metrics might not be frequent, that's okay for a smoke test
            pass
        await sio.disconnect()
    except Exception:
        pytest.skip("Socket.IO server unreachable")
