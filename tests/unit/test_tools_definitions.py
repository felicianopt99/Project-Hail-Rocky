import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.tools.definitions import BASE_TOOLS, get_tools


class TestBaseTools:
    def test_all_tools_have_required_fields(self):
        for tool in BASE_TOOLS:
            assert tool["type"] == "function", f"Tool missing 'function' type: {tool}"
            fn = tool["function"]
            assert "name" in fn
            assert "description" in fn
            assert "parameters" in fn

    def test_parameters_are_valid_json_schema(self):
        for tool in BASE_TOOLS:
            params = tool["function"]["parameters"]
            assert params["type"] == "object"
            assert "properties" in params

    def test_required_tools_present(self):
        names = {t["function"]["name"] for t in BASE_TOOLS}
        for expected in ["set_timer", "get_weather", "search_wikipedia", "execute_python",
                         "check_server_health", "add_to_list", "get_list", "remove_from_list"]:
            assert expected in names, f"Expected tool '{expected}' not found"

    def test_no_duplicate_tool_names(self):
        names = [t["function"]["name"] for t in BASE_TOOLS]
        assert len(names) == len(set(names)), "Duplicate tool names found"

    def test_set_timer_has_preset_enum(self):
        timer = next(t for t in BASE_TOOLS if t["function"]["name"] == "set_timer")
        props = timer["function"]["parameters"]["properties"]
        assert "preset" in props
        assert "enum" in props["preset"]
        assert "pasta" in props["preset"]["enum"]
        assert "chicken" in props["preset"]["enum"]

    def test_set_alarm_requires_datetime_iso(self):
        alarm = next(t for t in BASE_TOOLS if t["function"]["name"] == "set_alarm")
        required = alarm["function"]["parameters"].get("required", [])
        assert "datetime_iso" in required

    def test_get_weather_requires_city(self):
        weather = next(t for t in BASE_TOOLS if t["function"]["name"] == "get_weather")
        required = weather["function"]["parameters"].get("required", [])
        assert "city" in required


class TestGetTools:
    async def test_returns_base_tools_without_mcp_url(self):
        with patch("app.tools.definitions.settings") as s:
            s.ha_mcp_url = ""
            tools = await get_tools()
        assert tools == BASE_TOOLS

    async def test_merges_mcp_tools_on_success(self):
        mcp_payload = {
            "tools": [{
                "name": "control_lights",
                "description": "Turn lights on/off",
                "inputSchema": {"type": "object", "properties": {"entity_id": {"type": "string"}}},
            }]
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mcp_payload
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_resp)

        with patch("app.tools.definitions.settings") as s, \
             patch("app.tools.definitions.httpx.AsyncClient", return_value=mock_client):
            s.ha_mcp_url = "http://ha-mcp:3000"
            tools = await get_tools()

        names = [t["function"]["name"] for t in tools]
        assert "control_lights" in names
        assert len(tools) == len(BASE_TOOLS) + 1

    async def test_mcp_tool_converted_to_openai_format(self):
        mcp_payload = {
            "tools": [{
                "name": "search_entities",
                "description": "Search HA entities",
                "inputSchema": {"type": "object", "properties": {}},
            }]
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mcp_payload
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_resp)

        with patch("app.tools.definitions.settings") as s, \
             patch("app.tools.definitions.httpx.AsyncClient", return_value=mock_client):
            s.ha_mcp_url = "http://ha-mcp:3000"
            tools = await get_tools()

        mcp_tool = next(t for t in tools if t["function"]["name"] == "search_entities")
        assert mcp_tool["type"] == "function"
        assert mcp_tool["function"]["description"] == "Search HA entities"

    async def test_falls_back_to_base_tools_on_mcp_error(self):
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(side_effect=Exception("connection refused"))
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("app.tools.definitions.settings") as s, \
             patch("app.tools.definitions.httpx.AsyncClient", return_value=mock_client):
            s.ha_mcp_url = "http://ha-mcp:3000"
            tools = await get_tools()

        assert tools == BASE_TOOLS

    async def test_falls_back_on_mcp_non_200(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_resp)

        with patch("app.tools.definitions.settings") as s, \
             patch("app.tools.definitions.httpx.AsyncClient", return_value=mock_client):
            s.ha_mcp_url = "http://ha-mcp:3000"
            tools = await get_tools()

        assert tools == BASE_TOOLS
