import pytest
import httpx
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app as fastapi_app

client = TestClient(fastapi_app)


@pytest.mark.asyncio
async def test_brain_chat_cache_hit():
    """Cache hit path returns immediately without invoking _chat."""
    cache_result = {"response": "Yes, human?", "score": 0.99}
    with patch("app.api.brain.semantic_cache.check", new_callable=AsyncMock, return_value=cache_result):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post(
                "/api/brain/chat",
                json={"sid": "test-sid", "content": "Hello Rocky", "emotional_state": "neutral"},
            )
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    assert "Yes, human?" in response.text


@pytest.mark.asyncio
async def test_brain_chat_cache_miss_streams():
    """Cache miss path: _chat emits tokens via MockSio and they appear in the response."""
    async def fake_chat(sid, content, sio, language="en"):
        await sio.emit("chat_token", "Amaze!")
        await sio.emit("chat_response", {"text": "Amaze!"})

    with patch("app.api.brain.semantic_cache.check", new_callable=AsyncMock, return_value=None), \
         patch("app.api.socketio_handlers._chat", side_effect=fake_chat):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post(
                "/api/brain/chat",
                json={"sid": "test-sid", "content": "Hello Rocky"},
            )
    assert response.status_code == 200
    assert "Amaze!" in response.text


def test_brain_chat_validation_missing_content():
    """Pydantic validation: missing 'content' field → 422."""
    response = client.post("/api/brain/chat", json={"sid": "test"})
    assert response.status_code == 422


def test_brain_chat_validation_missing_sid():
    """Pydantic validation: missing 'sid' field → 422."""
    response = client.post("/api/brain/chat", json={"content": "hi"})
    assert response.status_code == 422


def test_brain_chat_empty_content():
    """Blank content string raises 400 before any service call."""
    response = client.post("/api/brain/chat", json={"sid": "test", "content": "   "})
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_brain_chat_tool_call_in_response():
    """When _chat streams a tool-call token it appears in the HTTP response body."""
    tool_token = "[Tool Call: ha-mcp:search_entities] "

    async def fake_chat_with_tool(sid, content, sio, language="en"):
        await sio.emit("chat_token", tool_token)
        await sio.emit("chat_token", "The lights are off.")
        await sio.emit("chat_response", {"text": tool_token + "The lights are off."})

    with patch("app.api.brain.semantic_cache.check", new_callable=AsyncMock, return_value=None), \
         patch("app.api.socketio_handlers._chat", side_effect=fake_chat_with_tool):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post(
                "/api/brain/chat",
                json={"sid": "test-mcp", "content": "Quais são as luzes da sala?"},
            )
    assert response.status_code == 200
    assert "ha-mcp:search_entities" in response.text
