import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient


def test_health_check(api_client: TestClient):
    """Health endpoint returns 200 with status ok."""
    response = api_client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "service" in data


def test_openapi_docs(api_client: TestClient):
    """OpenAPI schema is accessible."""
    response = api_client.get("/api/openapi.json")
    assert response.status_code == 200
    assert "openapi" in response.json()


def test_settings_get(api_client: TestClient, mocker):
    """Settings GET returns 200 with JSON body."""
    mock_redis = AsyncMock()
    mock_redis.ping.return_value = True
    mocker.patch("app.api.settings_api.get_redis", new_callable=AsyncMock, return_value=mock_redis)

    response = api_client.get("/api/settings")
    assert response.status_code == 200
    assert isinstance(response.json(), dict)


def test_system_health_check(api_client: TestClient, mocker):
    """System health endpoint returns all expected keys with services mocked."""
    # Mock Redis
    mock_redis = AsyncMock()
    mock_redis.ping.return_value = True
    mocker.patch(
        "app.api.system.redis_client.get_redis",
        new_callable=AsyncMock,
        return_value=mock_redis,
    )

    # Mock Letta (async function)
    mocker.patch(
        "app.api.system.letta_bridge.is_available",
        new_callable=AsyncMock,
        return_value=True,
    )

    # Mock httpx.AsyncClient used for MCP check
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_http_client = AsyncMock()
    mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
    mock_http_client.__aexit__ = AsyncMock(return_value=None)
    mock_http_client.get = AsyncMock(return_value=mock_response)
    mocker.patch("app.api.system.httpx.AsyncClient", return_value=mock_http_client)

    response = api_client.get("/api/system/health")
    assert response.status_code == 200
    data = response.json()

    assert data["redis"] == "online"
    assert data["letta"] == "healthy"
    assert "mcp" in data
    assert "hardware" in data
    assert isinstance(data["redis"], str)
    assert isinstance(data["letta"], str)
    assert isinstance(data["mcp"], str)


def test_system_health_redis_offline(api_client: TestClient, mocker):
    """When Redis is unreachable the health check reports offline, not a 500."""
    mocker.patch(
        "app.api.system.redis_client.get_redis",
        new_callable=AsyncMock,
        side_effect=Exception("connection refused"),
    )
    mocker.patch(
        "app.api.system.letta_bridge.is_available",
        new_callable=AsyncMock,
        return_value=False,
    )
    mock_http_client = AsyncMock()
    mock_http_client.__aenter__ = AsyncMock(side_effect=Exception("no mcp"))
    mock_http_client.__aexit__ = AsyncMock(return_value=None)
    mocker.patch("app.api.system.httpx.AsyncClient", return_value=mock_http_client)

    response = api_client.get("/api/system/health")
    assert response.status_code == 200
    data = response.json()
    assert data["redis"] == "offline"
    assert data["letta"] == "unreachable"
