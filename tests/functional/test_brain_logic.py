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
def test_brain_logic_scenarios(scenario):
    """
    Test various user scenarios against the brain logic.
    Supports both positive (200 OK) and negative (error) scenarios.
    """
    payload = {
        "sid": "test-sid",
        "content": scenario["input"],
        "emotional_state": "neutral"
    }
    
    expected_status = scenario.get("expected_status", 200)
    
    async def mock_chat_side_effect(sid, content, sio):
        await sio.emit("chat_token", "Hello")
        await sio.emit("chat_token", " world")
        await sio.emit("chat_response", {"text": "Hello world"})

    with patch("app.api.socketio_handlers._chat", side_effect=mock_chat_side_effect) as mock_chat:
        with patch("app.api.socketio_handlers._session", return_value={"history": [], "state": "neutral"}):
            
            # Special handling for malformed JSON testing
            if scenario.get("id") == "neg_002": 
                response = client.post(
                    "/api/brain/chat", 
                    content=scenario["input"], 
                    headers={"Content-Type": "application/json"}
                )
            else:
                response = client.post("/api/brain/chat", json=payload)
            
            assert response.status_code == expected_status
            
            if expected_status == 200:
                assert mock_chat.called
