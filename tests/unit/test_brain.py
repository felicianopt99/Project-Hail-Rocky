import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app as fastapi_app

client = TestClient(fastapi_app)

@pytest.mark.asyncio
async def test_brain_chat_endpoint_structure():
    """Test that the /api/brain/chat endpoint handles requests and returns a stream."""
    # We mock the generate function inside brain.py or the socketio_handlers._chat it calls
    with patch("app.api.socketio_handlers._chat", new_callable=AsyncMock) as mock_chat:
        # Mocking the session to avoid Redis/Session errors
        with patch("app.api.socketio_handlers._session", return_value={"history": [], "state": "neutral"}):
            # We don't actually need to run the full generate loop in this unit test
            # but we check if the endpoint is reachable
            payload = {
                "sid": "test-session",
                "content": "Hello Rocky",
                "emotional_state": "happy"
            }
            
            # Since it's a StreamingResponse, we use stream=True or just check initial response
            response = client.post("/api/brain/chat", json=payload)
            
            assert response.status_code == 200
            assert response.headers["content-type"] == "text/plain; charset=utf-8"

@pytest.mark.asyncio
async def test_brain_chat_validation():
    """Test validation errors for /api/brain/chat."""
    # Missing content
    payload = {"sid": "test"}
    response = client.post("/api/brain/chat", json=payload)
    assert response.status_code == 422
    
    # Missing sid
    payload = {"content": "hi"}
    response = client.post("/api/brain/chat", json=payload)
    assert response.status_code == 422

@pytest.mark.asyncio
async def test_brain_mcp_tool_trigger():
    """
    Unit test to verify that asking about smart home status triggers
    the expected tool call simulation in our mock.
    """
    from app.api.brain import BrainRequest
    
    payload = {
        "sid": "test-mcp",
        "content": "Quais são as luzes da sala?",
        "emotional_state": "neutral"
    }

    async def mock_letta_stream(msg):
        yield "Checking Home Assistant... "
        yield "[Tool Call: ha-mcp:search_entities] "
        yield "The lights are off."

    with patch("app.api.socketio_handlers.settings.letta_url", "http://mock-letta"), \
         patch("app.api.socketio_handlers.letta_bridge.is_available", return_value=True), \
         patch("app.api.socketio_handlers.letta_bridge.send_message_stream", side_effect=mock_letta_stream), \
         patch("app.api.socketio_handlers._session", return_value={"history": [], "state": "neutral"}):
            
        response = client.post("/api/brain/chat", json=payload)
        assert response.status_code == 200
        assert "ha-mcp:search_entities" in response.text
