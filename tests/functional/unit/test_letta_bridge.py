import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.bridges import letta_bridge


@pytest.fixture(autouse=True)
def reset_agent_id():
    """Isolate tests by clearing the cached agent ID."""
    original = letta_bridge._agent_id
    letta_bridge._agent_id = None
    yield
    letta_bridge._agent_id = original


# ── _url ──────────────────────────────────────────────────────────────────

def test_url_construction():
    with patch.object(letta_bridge.settings, "letta_url", "http://letta:8283"):
        assert letta_bridge._url("/v1/agents") == "http://letta:8283/v1/agents"


def test_url_strips_trailing_slash():
    with patch.object(letta_bridge.settings, "letta_url", "http://letta:8283/"):
        assert letta_bridge._url("/v1/agents") == "http://letta:8283/v1/agents"


# ── is_available ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_is_available_false_when_no_url():
    with patch.object(letta_bridge.settings, "letta_url", ""):
        assert await letta_bridge.is_available() is False


@pytest.mark.asyncio
async def test_is_available_true_on_200():
    mock_resp = MagicMock(status_code=200)
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch.object(letta_bridge.settings, "letta_url", "http://letta:8283"), \
         patch("app.bridges.letta_bridge._get_letta_client", return_value=mock_client):
        assert await letta_bridge.is_available() is True


@pytest.mark.asyncio
async def test_is_available_false_on_non_200():
    mock_resp = MagicMock(status_code=503)
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch.object(letta_bridge.settings, "letta_url", "http://letta:8283"), \
         patch("app.bridges.letta_bridge._get_letta_client", return_value=mock_client):
        assert await letta_bridge.is_available() is False


@pytest.mark.asyncio
async def test_is_available_false_on_exception():
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=Exception("refused"))

    with patch.object(letta_bridge.settings, "letta_url", "http://letta:8283"), \
         patch("app.bridges.letta_bridge._get_letta_client", return_value=mock_client):
        assert await letta_bridge.is_available() is False


# ── send_message_stream ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stream_yields_cached_response():
    with patch("app.bridges.letta_bridge.semantic_cache") as mock_cache:
        mock_cache.check = AsyncMock(return_value={"response": "Cached!", "score": 0.99})

        tokens = [t async for t in letta_bridge.send_message_stream("Hello")]
    assert tokens == ["Cached!"]


@pytest.mark.asyncio
async def test_stream_yields_nothing_without_agent():
    with patch("app.bridges.letta_bridge.semantic_cache") as mock_cache, \
         patch("app.bridges.letta_bridge.get_agent_id", new_callable=AsyncMock, return_value=None):
        mock_cache.check = AsyncMock(return_value=None)
        tokens = [t async for t in letta_bridge.send_message_stream("Hello")]
    assert tokens == []


@pytest.mark.asyncio
async def test_stream_yields_assistant_message_tokens():
    sse_lines = [
        'data: {"message_type": "assistant_message", "content": "Amaze"}',
        'data: {"message_type": "assistant_message", "content": "!"}',
        "data: [DONE]",
    ]

    async def aiter_lines():
        for line in sse_lines:
            yield line

    mock_resp = AsyncMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.aiter_lines = aiter_lines

    mock_stream_cm = AsyncMock()
    mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_stream_cm.__aexit__ = AsyncMock(return_value=None)

    mock_client = MagicMock()
    mock_client.stream.return_value = mock_stream_cm

    with patch("app.bridges.letta_bridge.semantic_cache") as mock_cache, \
         patch("app.bridges.letta_bridge._get_letta_client", return_value=mock_client), \
         patch("app.bridges.letta_bridge.get_agent_id", new_callable=AsyncMock, return_value="agent-1"):
        mock_cache.check = AsyncMock(return_value=None)
        mock_cache.store = AsyncMock()

        tokens = [t async for t in letta_bridge.send_message_stream("Hello Rocky")]

    assert tokens == ["Amaze", "!"]


@pytest.mark.asyncio
async def test_stream_includes_tool_call_token():
    sse_lines = [
        'data: {"message_type": "tool_call", "tool_call": {"name": "ha-mcp:search_entities"}}',
        'data: {"message_type": "assistant_message", "content": "Lights are off."}',
        "data: [DONE]",
    ]

    async def aiter_lines():
        for line in sse_lines:
            yield line

    mock_resp = AsyncMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.aiter_lines = aiter_lines

    mock_stream_cm = AsyncMock()
    mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_stream_cm.__aexit__ = AsyncMock(return_value=None)

    mock_client = MagicMock()
    mock_client.stream.return_value = mock_stream_cm

    with patch("app.bridges.letta_bridge.semantic_cache") as mock_cache, \
         patch("app.bridges.letta_bridge._get_letta_client", return_value=mock_client), \
         patch("app.bridges.letta_bridge.get_agent_id", new_callable=AsyncMock, return_value="agent-1"):
        mock_cache.check = AsyncMock(return_value=None)
        mock_cache.store = AsyncMock()

        tokens = [t async for t in letta_bridge.send_message_stream("Acende a luz")]

    assert any("ha-mcp:search_entities" in t for t in tokens)
    assert any("Lights are off" in t for t in tokens)


@pytest.mark.asyncio
async def test_stream_stores_to_cache_when_no_tools():
    sse_lines = [
        'data: {"message_type": "assistant_message", "content": "Good. Good."}',
        "data: [DONE]",
    ]

    async def aiter_lines():
        for line in sse_lines:
            yield line

    mock_resp = AsyncMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.aiter_lines = aiter_lines

    mock_stream_cm = AsyncMock()
    mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_stream_cm.__aexit__ = AsyncMock(return_value=None)

    mock_client = MagicMock()
    mock_client.stream.return_value = mock_stream_cm

    with patch("app.bridges.letta_bridge.semantic_cache") as mock_cache, \
         patch("app.bridges.letta_bridge._get_letta_client", return_value=mock_client), \
         patch("app.bridges.letta_bridge.get_agent_id", new_callable=AsyncMock, return_value="agent-1"):
        mock_cache.check = AsyncMock(return_value=None)
        mock_cache.store = AsyncMock()

        _ = [t async for t in letta_bridge.send_message_stream("Good?")]

    mock_cache.store.assert_called_once_with("Good?", "Good. Good.")


@pytest.mark.asyncio
async def test_stream_skips_cache_store_when_tool_used():
    sse_lines = [
        'data: {"message_type": "tool_call", "tool_call": {"name": "call_service"}}',
        'data: {"message_type": "assistant_message", "content": "Done."}',
        "data: [DONE]",
    ]

    async def aiter_lines():
        for line in sse_lines:
            yield line

    mock_resp = AsyncMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.aiter_lines = aiter_lines

    mock_stream_cm = AsyncMock()
    mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_resp)
    mock_stream_cm.__aexit__ = AsyncMock(return_value=None)

    mock_client = MagicMock()
    mock_client.stream.return_value = mock_stream_cm

    with patch("app.bridges.letta_bridge.semantic_cache") as mock_cache, \
         patch("app.bridges.letta_bridge._get_letta_client", return_value=mock_client), \
         patch("app.bridges.letta_bridge.get_agent_id", new_callable=AsyncMock, return_value="agent-1"):
        mock_cache.check = AsyncMock(return_value=None)
        mock_cache.store = AsyncMock()

        _ = [t async for t in letta_bridge.send_message_stream("Turn on light")]

    mock_cache.store.assert_not_called()
