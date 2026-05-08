import pytest
from unittest.mock import patch, MagicMock
from app.core import redis_client


@pytest.fixture(autouse=True)
def reset_pool():
    original = redis_client._pool
    redis_client._pool = None
    yield
    redis_client._pool = None


async def test_get_redis_returns_none_when_no_url():
    with patch.object(redis_client.settings, "redis_url", ""):
        result = await redis_client.get_redis()
    assert result is None


async def test_get_redis_creates_pool_on_first_call():
    mock_pool = MagicMock()
    with patch("app.core.redis_client.aioredis.ConnectionPool.from_url", return_value=mock_pool), \
         patch.object(redis_client.settings, "redis_url", "redis://localhost:6379"), \
         patch("app.core.redis_client.aioredis.Redis") as mock_redis_cls:
        await redis_client.get_redis()
    mock_redis_cls.assert_called_once_with(connection_pool=mock_pool)


async def test_get_redis_reuses_existing_pool():
    mock_pool = MagicMock()
    redis_client._pool = mock_pool
    with patch.object(redis_client.settings, "redis_url", "redis://localhost:6379"), \
         patch("app.core.redis_client.aioredis.Redis") as mock_redis_cls, \
         patch("app.core.redis_client.aioredis.ConnectionPool.from_url") as mock_from_url:
        await redis_client.get_redis()
        await redis_client.get_redis()
    mock_from_url.assert_not_called()
    assert mock_redis_cls.call_count == 2


async def test_get_redis_returns_none_on_pool_exception():
    with patch.object(redis_client.settings, "redis_url", "redis://localhost:6379"), \
         patch("app.core.redis_client.aioredis.ConnectionPool.from_url", side_effect=Exception("refused")):
        result = await redis_client.get_redis()
    assert result is None


async def test_get_redis_returns_client_instance():
    mock_pool = MagicMock()
    mock_client = MagicMock()
    with patch("app.core.redis_client.aioredis.ConnectionPool.from_url", return_value=mock_pool), \
         patch.object(redis_client.settings, "redis_url", "redis://localhost:6379"), \
         patch("app.core.redis_client.aioredis.Redis", return_value=mock_client):
        result = await redis_client.get_redis()
    assert result is mock_client
