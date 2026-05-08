import pytest
from app.core.http_client import AsyncHTTPClient, get_http_client
import httpx


@pytest.fixture(autouse=True)
def reset_singleton():
    AsyncHTTPClient._instance = None
    yield
    # Clean up after test
    if AsyncHTTPClient._instance is not None:
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if not loop.is_closed():
                loop.run_until_complete(AsyncHTTPClient.close_client())
        except Exception:
            AsyncHTTPClient._instance = None


class TestAsyncHTTPClient:
    async def test_get_client_returns_httpx_async_client(self):
        client = await AsyncHTTPClient.get_client()
        assert isinstance(client, httpx.AsyncClient)

    async def test_get_client_returns_singleton(self):
        client1 = await AsyncHTTPClient.get_client()
        client2 = await AsyncHTTPClient.get_client()
        assert client1 is client2

    async def test_close_client_resets_singleton(self):
        await AsyncHTTPClient.get_client()
        assert AsyncHTTPClient._instance is not None
        await AsyncHTTPClient.close_client()
        assert AsyncHTTPClient._instance is None

    async def test_close_noop_when_no_client(self):
        assert AsyncHTTPClient._instance is None
        await AsyncHTTPClient.close_client()  # must not raise

    async def test_new_client_created_after_close(self):
        c1 = await AsyncHTTPClient.get_client()
        await AsyncHTTPClient.close_client()
        c2 = await AsyncHTTPClient.get_client()
        assert c1 is not c2


class TestGetHttpClientHelper:
    async def test_returns_client(self):
        client = await get_http_client()
        assert isinstance(client, httpx.AsyncClient)

    async def test_same_as_direct_call(self):
        c1 = await get_http_client()
        c2 = await AsyncHTTPClient.get_client()
        assert c1 is c2
