import pytest
import json
import asyncio
import httpx
import threading
import time
from fastapi import FastAPI, Request
from uvicorn import Config, Server
from unittest.mock import patch, AsyncMock
from app.main import app as fastapi_app
from app.config import settings
from app.bridges import letta_bridge

# --- Mock MCP Server ---
# This mimics the 'streamable_http' MCP server protocol that Letta expects
mcp_app = FastAPI()

@mcp_app.get("/tools")
async def list_tools():
    """Letta calls this to discover tools available on the MCP server."""
    return [
        {
            "name": "call_service",
            "description": "Call a Home Assistant service",
            "input_schema": {
                "type": "object",
                "properties": {
                    "domain": {"type": "string"},
                    "service": {"type": "string"},
                    "service_data": {"type": "object"}
                },
                "required": ["domain", "service"]
            }
        }
    ]

@mcp_app.post("/tools/call")
async def call_tool(req: Request):
    """Letta calls this to execute a tool."""
    body = await req.json()
    # Letta usually sends { "name": "...", "arguments": { ... } }
    name = body.get("name")
    
    if name == "call_service":
        return {
            "content": [{"type": "text", "text": "Success: light.kitchen turned on."}],
            "isError": False
        }
    return {"content": [{"type": "text", "text": "Unknown tool"}], "isError": True}

@mcp_app.get("/health")
async def health():
    return {"status": "ok"}

@pytest.fixture(scope="module", autouse=True)
def mcp_server():
    """Starts the mock MCP server in a background thread and ensures cleanup."""
    config = Config(app=mcp_app, host="0.0.0.0", port=3005, log_level="error")
    server = Server(config)
    
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    
    # Wait for server to be ready
    max_retries = 10
    for i in range(max_retries):
        try:
            with httpx.Client() as client:
                r = client.get("http://localhost:3005/health")
                if r.status_code == 200:
                    break
        except Exception:
            pass
        time.sleep(0.3)
    
    yield "http://localhost:3005"
    
    # Trigger shutdown
    server.should_exit = True
    thread.join(timeout=2)

# --- Integration Test ---

@pytest.mark.asyncio
async def test_letta_mcp_integration_real():
    """
    Integration test: Envia mensagem via httpx para o backend,
    passa pelo Letta (real) e verifica se ele tenta usar o tool call_service
    do nosso mock MCP.
    """
    
    # Check if Letta is available before running
    if not settings.letta_url:
        pytest.skip("LETTA_URL not configured")
        
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{settings.letta_url}/v1/health", timeout=2.0)
            if r.status_code != 200:
                pytest.skip(f"Letta server at {settings.letta_url} is not responding")
    except Exception as e:
        pytest.skip(f"Letta server connection failed: {e}")

    # Configure the test environment
    # We point HA_MCP_URL to our mock server. 
    # If running in Docker, we use the container hostname.
    import socket
    mcp_url = "http://localhost:3005"
    hostname = socket.gethostname()
    # In docker-compose.test.yml, the backend service is named 'backend-test'
    # but the container_name is 'rocky-backend-test'.
    if "backend" in hostname or "rocky" in hostname:
        mcp_url = f"http://{hostname}:3005"

    payload = {
        "sid": "integration-test-session",
        "content": "Acende a luz da cozinha",
        "emotional_state": "neutral"
    }

    # Patch settings and force a fresh agent state to ensure tool sync
    with patch("app.config.settings.ha_mcp_url", mcp_url), \
         patch("app.api.socketio_handlers._session", return_value={"history": [], "state": "neutral"}):
        
        # Reset Letta agent to ensure it picks up the new mock MCP tools
        await letta_bridge.forget_all()
        
        # Call the backend via httpx (mocking the network call but using the real app)
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            # We use a long timeout because Letta can be slow
            async with ac.stream("POST", "/api/brain/chat", json=payload, timeout=60.0) as response:
                assert response.status_code == 200
                
                full_text = ""
                found_tool_call = False
                
                async for chunk in response.aiter_text():
                    full_text += chunk
                    if "call_service" in chunk:
                        found_tool_call = True
                
                # Assertions
                # 1. Check if the intention to use call_service was detected
                assert found_tool_call or "call_service" in full_text, \
                    f"Letta did not indicate call_service tool use. Response: {full_text}"
                
                # 2. Check if the response makes sense
                assert "cozinha" in full_text.lower() or "luz" in full_text.lower(), \
                    "Response does not mention the kitchen or light."
                
                print(f"\nFinal response: {full_text}")

@pytest.mark.asyncio
async def test_brain_chat_endpoint_basic():
    """Brain chat endpoint streams a non-empty response (all services mocked)."""
    async def fake_chat(sid, content, sio, language="en"):
        await sio.emit("chat_token", "Rocky here. Yes?")
        await sio.emit("chat_response", {"text": "Rocky here. Yes?"})

    payload = {
        "sid": "simple-sid",
        "content": "Olá, quem és?",
        "emotional_state": "happy",
    }

    with patch("app.api.brain.semantic_cache.check", new_callable=AsyncMock, return_value=None), \
         patch("app.api.socketio_handlers._chat", side_effect=fake_chat):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post("/api/brain/chat", json=payload)

    assert response.status_code == 200
    assert len(response.text) > 0
    assert "Rocky" in response.text
