import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.tools.executor import run, _proxy_mcp_call, _set_timer, _weather_code, CRITICAL_TOOLS


# ── _weather_code ─────────────────────────────────────────────────────────

class TestWeatherCode:
    def test_clear_sky(self):
        assert _weather_code(0) == "clear sky"

    def test_thunderstorm(self):
        assert _weather_code(95) == "thunderstorm"

    def test_light_rain(self):
        assert _weather_code(61) == "light rain"

    def test_snow(self):
        assert _weather_code(73) == "snow"

    def test_unknown_code(self):
        assert _weather_code(999) == "code 999"


# ── run() — critical tool gate ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_critical_tools_return_pending_auth():
    for tool in CRITICAL_TOOLS:
        result = await run(tool, {}, bypass_auth=False)
        assert isinstance(result, dict), f"{tool} should return dict"
        assert result["status"] == "pending_auth"
        assert result["tool"] == tool


@pytest.mark.asyncio
async def test_critical_tool_with_bypass_executes():
    result = await run("execute_python", {"code": "print(42)"}, bypass_auth=True)
    assert "42" in result


@pytest.mark.asyncio
async def test_check_server_health_returns_string():
    result = await run("check_server_health", {})
    assert isinstance(result, str)
    assert len(result) > 0


@pytest.mark.asyncio
async def test_unknown_tool_without_mcp_url():
    with patch("app.tools.executor.settings") as mock_settings:
        mock_settings.ha_mcp_url = ""
        result = await run("nonexistent_tool", {})
    assert "Unknown tool" in result or "nonexistent_tool" in result


@pytest.mark.asyncio
async def test_unknown_tool_falls_through_to_mcp():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"content": [{"type": "text", "text": "done"}]}
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("app.tools.executor.settings") as mock_settings, \
         patch("app.tools.executor.get_http_client", new_callable=AsyncMock, return_value=mock_client):
        mock_settings.ha_mcp_url = "http://mcp:3000"
        result = await run("call_service", {"domain": "light", "service": "turn_on"}, bypass_auth=True)
    assert "done" in result


# ── _set_timer ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_timer_minutes_and_seconds():
    result = await _set_timer(90, label="pasta")
    assert "pasta" in result
    assert "1m" in result
    assert "30s" in result


@pytest.mark.asyncio
async def test_set_timer_hours_minutes_seconds():
    result = await _set_timer(3661, label="meeting")
    assert "1h" in result
    assert "1m" in result
    assert "1s" in result


@pytest.mark.asyncio
async def test_set_timer_only_seconds():
    result = await _set_timer(45, label="quick")
    assert "45s" in result
    assert "m" not in result.split("in ")[-1].split(".")[0]


@pytest.mark.asyncio
async def test_set_timer_emits_event_when_sio_given():
    import asyncio
    real_sleep = asyncio.sleep  # save before patching
    mock_sio = AsyncMock()
    with patch("app.tools.executor.asyncio.sleep", new_callable=AsyncMock):
        await _set_timer(1, label="instant", sio=mock_sio)
        await real_sleep(0.1)  # real sleep so event loop can run the task
    mock_sio.emit.assert_called_once_with("timer_fired", {"label": "instant"})


# ── _proxy_mcp_call ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_proxy_mcp_call_returns_text_on_200():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "content": [{"type": "text", "text": "light on"}]
    }
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("app.tools.executor.get_http_client", new_callable=AsyncMock, return_value=mock_client):
        result = await _proxy_mcp_call("http://mcp:3000", "call_service", {"domain": "light"})
    assert result == "light on"


@pytest.mark.asyncio
async def test_proxy_mcp_call_returns_none_on_404():
    mock_response = MagicMock()
    mock_response.status_code = 404
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("app.tools.executor.get_http_client", new_callable=AsyncMock, return_value=mock_client):
        result = await _proxy_mcp_call("http://mcp:3000", "unknown_tool", {})
    assert result is None


@pytest.mark.asyncio
async def test_proxy_mcp_call_returns_none_on_exception():
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=Exception("Connection refused"))

    with patch("app.tools.executor.get_http_client", new_callable=AsyncMock, return_value=mock_client):
        result = await _proxy_mcp_call("http://mcp:3000", "any_tool", {})
    assert result is None


@pytest.mark.asyncio
async def test_proxy_mcp_call_multiple_text_blocks():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "content": [
            {"type": "text", "text": "line 1"},
            {"type": "text", "text": "line 2"},
        ]
    }
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch("app.tools.executor.get_http_client", new_callable=AsyncMock, return_value=mock_client):
        result = await _proxy_mcp_call("http://mcp:3000", "some_tool", {})
    assert result == "line 1\nline 2"
