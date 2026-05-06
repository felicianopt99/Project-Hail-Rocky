import pytest
import json
import asyncio
from pathlib import Path
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from app.main import fastapi_app

client = TestClient(fastapi_app)

def load_scenarios():
    base_path = Path(__file__).parent.parent.parent
    path = base_path / "scripts" / "test_scenarios.json"
    if not path.exists():
        path = base_path / "Project-Hail-Rocky" / "scripts" / "test_scenarios.json"
    
    with open(path, "r") as f:
        return json.load(f)["scenarios"]

@pytest.mark.parametrize("scenario", load_scenarios())
@pytest.mark.asyncio
async def test_brain_logic_scenarios(scenario):
    """
    Test various user scenarios against the brain logic.
    Mocks Letta to simulate MCP tool calls for smart home queries.
    """
    payload = {
        "sid": "test-sid",
        "content": scenario["input"],
        "emotional_state": "neutral"
    }
    
    expected_status = scenario.get("expected_status", 200)
    
    # Mock Letta Bridge to simulate MCP tool usage or normal chat
    async def mock_letta_stream(msg):
        if any(word in msg.lower() for word in ["luz", "light", "temp", "status"]):
            yield "Let me check that for you... "
            yield "[Tool Call: ha-mcp:search_entities] "
            yield "Found it. The state is active."
        else:
            yield "Rocky is thinking... "
            yield "I hear you!"

    with patch("app.api.socketio_handlers.letta_bridge.is_available", return_value=True), \
         patch("app.api.socketio_handlers.letta_bridge.send_message_stream", side_effect=mock_letta_stream), \
         patch("app.api.socketio_handlers.settings.has_letta", return_value=True), \
         patch("app.api.socketio_handlers._session", return_value={"history": [], "state": "neutral"}):
            
        # We use a real TestClient but it won't handle the stream automatically in one go 
        # unless we iterate it.
        response = client.post("/api/brain/chat", json=payload)
        assert response.status_code == expected_status
        
        if expected_status == 200:
            content = response.text
            # Verify that the response contains some expected keywords from the scenario
            # or at least our mock response
            assert len(content) > 0
            if any(word in scenario["input"].lower() for word in ["luz", "light", "temp"]):
                 assert "Tool Call" in content or "Found it" in content
