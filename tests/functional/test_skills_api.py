import pytest
import httpx
from unittest.mock import AsyncMock, patch
from app.main import app as fastapi_app
from app.core.security import create_access_token
from app.config import settings

_BASE_TOOLS = [
    {"type": "function", "function": {"name": "get_weather", "description": "Weather", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "set_timer", "description": "Timer", "parameters": {"type": "object", "properties": {}}}},
]


def _token():
    return create_access_token({"sub": settings.admin_username})


class TestListSkills:
    async def test_list_skills_returns_array(self):
        with patch("app.api.skills.get_tools", new_callable=AsyncMock, return_value=_BASE_TOOLS), \
             patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=None):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/skills")
        assert resp.status_code == 200
        skills = resp.json()
        assert isinstance(skills, list)
        assert len(skills) == len(_BASE_TOOLS)

    async def test_list_skills_includes_metadata(self):
        with patch("app.api.skills.get_tools", new_callable=AsyncMock, return_value=_BASE_TOOLS), \
             patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=None):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/skills")
        skill = resp.json()[0]
        assert "id" in skill
        assert "name" in skill
        assert "enabled" in skill
        assert "category" in skill

    async def test_skills_enabled_by_default(self):
        with patch("app.api.skills.get_tools", new_callable=AsyncMock, return_value=_BASE_TOOLS), \
             patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=None):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/skills")
        for skill in resp.json():
            assert skill["enabled"] is True

    async def test_redis_override_disables_skill(self):
        import json
        mock_redis = AsyncMock()
        mock_redis.mget = AsyncMock(return_value=[json.dumps({"enabled": False}), None])

        with patch("app.api.skills.get_tools", new_callable=AsyncMock, return_value=_BASE_TOOLS), \
             patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/skills")
        skills = resp.json()
        assert skills[0]["enabled"] is False
        assert skills[1]["enabled"] is True


class TestToggleSkill:
    async def test_toggle_requires_auth(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.post("/api/skills/set_timer/toggle")
        assert resp.status_code == 401

    async def test_toggle_disables_enabled_skill(self):
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=None)
        mock_redis.set = AsyncMock()

        with patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/skills/set_timer/toggle",
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "set_timer"
        assert body["enabled"] is False

    async def test_toggle_re_enables_disabled_skill(self):
        import json
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=json.dumps({"enabled": False}))
        mock_redis.set = AsyncMock()

        with patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=mock_redis), \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/skills/set_timer/toggle",
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True


class TestGetSkillSettings:
    async def test_returns_empty_when_no_redis(self):
        with patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=None):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/skills/set_timer/settings")
        assert resp.status_code == 200
        assert resp.json() == {}

    async def test_returns_stored_settings(self):
        import json
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=json.dumps({"enabled": True, "custom": "value"}))

        with patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/skills/set_timer/settings")
        assert resp.status_code == 200
        assert resp.json()["custom"] == "value"


class TestUpdateSkillSettings:
    async def test_merges_settings_with_existing(self):
        import json
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value=json.dumps({"enabled": True}))
        mock_redis.set = AsyncMock()

        with patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.put(
                    "/api/skills/set_timer/settings",
                    json={"default_duration": 300},
                )
        assert resp.status_code == 200
        result = resp.json()
        assert result["enabled"] is True
        assert result["default_duration"] == 300


class TestGetActiveTools:
    async def test_filters_out_disabled_tools(self):
        import json
        from app.api.skills import get_active_tools

        mock_redis = AsyncMock()
        mock_redis.mget = AsyncMock(return_value=[json.dumps({"enabled": False}), None])

        with patch("app.api.skills.get_tools", new_callable=AsyncMock, return_value=_BASE_TOOLS), \
             patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=mock_redis):
            active = await get_active_tools()

        assert len(active) == 1
        assert active[0]["function"]["name"] == "set_timer"

    async def test_returns_all_when_none_disabled(self):
        from app.api.skills import get_active_tools

        with patch("app.api.skills.get_tools", new_callable=AsyncMock, return_value=_BASE_TOOLS), \
             patch("app.api.skills.get_redis", new_callable=AsyncMock, return_value=None):
            active = await get_active_tools()

        assert len(active) == len(_BASE_TOOLS)
