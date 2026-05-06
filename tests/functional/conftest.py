import pytest
import asyncio
from fastapi.testclient import TestClient
from socketio import AsyncClient
from app.main import app as fastapi_app, sio
from app.config import settings

@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for each test case."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    
    # Global Cleanup
    from app.bridges import letta_bridge
    if loop.is_running():
        loop.create_task(letta_bridge.close_client())
    else:
        loop.run_until_complete(letta_bridge.close_client())
        
    loop.close()

@pytest.fixture
def api_client():
    """FastAPI TestClient fixture."""
    with TestClient(fastapi_app) as client:
        yield client

@pytest.fixture
async def sio_client():
    """Socket.IO AsyncClient fixture."""
    client = AsyncClient()
    # In a real test, we might want to connect to a running test server
    # For now, we provide the client instance
    yield client
    if client.connected:
        await client.disconnect()

@pytest.fixture
def auth_headers():
    """Mock auth headers if needed."""
    return {"Authorization": "Bearer mock-token"}
