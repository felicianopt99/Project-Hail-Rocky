import pytest
import httpx
from unittest.mock import AsyncMock, patch
from app.main import app as fastapi_app
from app.core.security import create_access_token
from app.config import settings


def _token():
    return create_access_token({"sub": settings.admin_username})


class TestGetProfile:
    async def test_returns_memory_when_letta_available(self):
        fake_memory = {"persona": "Rocky", "human": "Feli"}

        with patch("app.api.memory.letta_bridge.get_core_memory",
                   new_callable=AsyncMock, return_value=fake_memory):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/memory/profile")

        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is True
        assert body["memory"] == fake_memory

    async def test_returns_unavailable_when_letta_not_running(self):
        with patch("app.api.memory.letta_bridge.get_core_memory",
                   new_callable=AsyncMock, return_value=None):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/memory/profile")

        assert resp.status_code == 200
        assert resp.json()["available"] is False


class TestUpdateProfile:
    async def test_update_requires_auth(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.patch("/api/memory/profile", json={"persona": "Updated"})
        assert resp.status_code == 401

    async def test_update_succeeds_with_auth(self):
        with patch("app.api.memory.letta_bridge.update_core_memory",
                   new_callable=AsyncMock, return_value=True), \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.patch(
                    "/api/memory/profile",
                    json={"persona": "Rocky v2", "human": "Feli"},
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    async def test_update_returns_503_when_letta_unavailable(self):
        with patch("app.api.memory.letta_bridge.update_core_memory",
                   new_callable=AsyncMock, return_value=False), \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.patch(
                    "/api/memory/profile",
                    json={"persona": "Rocky v2"},
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 503


class TestSearchMemories:
    async def test_search_returns_results(self):
        fake_results = [{"id": "m1", "text": "Rocky loves amaze"}]

        with patch("app.api.memory.letta_bridge.search_archival",
                   new_callable=AsyncMock, return_value=fake_results):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/memory/search?q=amaze")

        assert resp.status_code == 200
        body = resp.json()
        assert body["query"] == "amaze"
        assert body["count"] == 1
        assert body["results"] == fake_results

    async def test_search_requires_min_2_chars(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/api/memory/search?q=a")
        assert resp.status_code == 422

    async def test_search_missing_query_returns_422(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/api/memory/search")
        assert resp.status_code == 422


class TestGetRecentMemories:
    async def test_returns_recent_list(self):
        fake_memories = [{"id": "m1"}, {"id": "m2"}]

        with patch("app.api.memory.letta_bridge.get_recent_memories",
                   new_callable=AsyncMock, return_value=fake_memories):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/memory/recent")

        assert resp.status_code == 200
        assert resp.json()["memories"] == fake_memories


class TestForgetAll:
    async def test_forget_all_requires_auth(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.post("/api/memory/forget-all", json={"confirm": "YES_FORGET_EVERYTHING"})
        assert resp.status_code == 401

    async def test_forget_all_requires_exact_confirmation(self):
        with patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/memory/forget-all",
                    json={"confirm": "wrong string"},
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 400

    async def test_forget_all_succeeds_with_correct_confirmation(self):
        mock_redis = AsyncMock()
        mock_redis.keys = AsyncMock(return_value=["rocky:key1"])
        mock_redis.delete = AsyncMock()

        with patch("app.api.memory.letta_bridge.forget_all", new_callable=AsyncMock, return_value=True), \
             patch("app.api.memory.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/memory/forget-all",
                    json={"confirm": "YES_FORGET_EVERYTHING"},
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    async def test_forget_all_returns_503_when_letta_fails(self):
        mock_redis = AsyncMock()
        mock_redis.keys = AsyncMock(return_value=[])

        with patch("app.api.memory.letta_bridge.forget_all", new_callable=AsyncMock, return_value=False), \
             patch("app.api.memory.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/memory/forget-all",
                    json={"confirm": "YES_FORGET_EVERYTHING"},
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 503
