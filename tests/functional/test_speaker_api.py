import pytest
import httpx
from unittest.mock import AsyncMock, patch
from app.main import app as fastapi_app
from app.core.security import create_access_token
from app.config import settings


def _token():
    return create_access_token({"sub": settings.admin_username})


class TestListProfiles:
    async def test_returns_unavailable_when_no_speaker_key(self):
        with patch("app.api.speaker.settings") as s:
            s.has_speaker_id.return_value = False
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/speaker/profiles")
        assert resp.status_code == 200
        assert resp.json()["available"] is False

    async def test_returns_profiles_when_configured(self):
        fake_profiles = [{"profile_id": "p1", "name": "Alice"}]

        with patch("app.api.speaker.settings") as s, \
             patch("app.api.speaker.azure_speaker.list_profiles",
                   new_callable=AsyncMock, return_value=fake_profiles):
            s.has_speaker_id.return_value = True
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/speaker/profiles")
        assert resp.status_code == 200
        body = resp.json()
        assert body["available"] is True
        assert body["profiles"] == fake_profiles


class TestCreateProfile:
    async def test_create_requires_auth(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.post("/api/speaker/profiles", json={"name": "Alice"})
        assert resp.status_code == 401

    async def test_create_returns_503_when_not_configured(self):
        with patch("app.api.speaker.settings") as s, \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            s.has_speaker_id.return_value = False
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/speaker/profiles",
                    json={"name": "Alice"},
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 503

    async def test_create_profile_success(self):
        with patch("app.api.speaker.settings") as s, \
             patch("app.api.speaker.azure_speaker.create_profile",
                   new_callable=AsyncMock, return_value="pid-123"), \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            s.has_speaker_id.return_value = True
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/speaker/profiles",
                    json={"name": "Alice"},
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 200
        body = resp.json()
        assert body["profile_id"] == "pid-123"
        assert body["name"] == "Alice"
        assert body["status"] == "created"

    async def test_create_profile_returns_500_on_azure_failure(self):
        with patch("app.api.speaker.settings") as s, \
             patch("app.api.speaker.azure_speaker.create_profile",
                   new_callable=AsyncMock, return_value=None), \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            s.has_speaker_id.return_value = True
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/speaker/profiles",
                    json={"name": "Alice"},
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 500


class TestEnroll:
    async def test_enroll_returns_503_when_not_configured(self):
        with patch("app.api.speaker.settings") as s:
            s.has_speaker_id.return_value = False
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/speaker/profiles/pid-1/enroll",
                    content=b'\x00' * 100,
                )
        assert resp.status_code == 503

    async def test_enroll_returns_400_on_too_short_audio(self):
        with patch("app.api.speaker.settings") as s:
            s.has_speaker_id.return_value = True
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/speaker/profiles/pid-1/enroll",
                    content=b'\x00' * 100,  # Too short (< 8000 bytes)
                )
        assert resp.status_code == 400
        assert "short" in resp.json()["detail"].lower()

    async def test_enroll_success(self):
        fake_result = {"status": "Enrolling", "remaining_seconds": 15.0}

        with patch("app.api.speaker.settings") as s, \
             patch("app.api.speaker.azure_speaker.enroll",
                   new_callable=AsyncMock, return_value=fake_result):
            s.has_speaker_id.return_value = True
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/speaker/profiles/pid-1/enroll",
                    content=b'\x10' * 9000,  # Sufficient length
                )
        assert resp.status_code == 200
        assert resp.json()["status"] == "Enrolling"

    async def test_enroll_returns_500_on_azure_error(self):
        with patch("app.api.speaker.settings") as s, \
             patch("app.api.speaker.azure_speaker.enroll",
                   new_callable=AsyncMock,
                   return_value={"status": "error", "error": "Azure failed"}):
            s.has_speaker_id.return_value = True
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/speaker/profiles/pid-1/enroll",
                    content=b'\x10' * 9000,
                )
        assert resp.status_code == 500


class TestDeleteProfile:
    async def test_delete_requires_auth(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.delete("/api/speaker/profiles/pid-1")
        assert resp.status_code == 401

    async def test_delete_success(self):
        with patch("app.api.speaker.settings") as s, \
             patch("app.api.speaker.azure_speaker.delete_profile",
                   new_callable=AsyncMock, return_value=True), \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            s.has_speaker_id.return_value = True
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.delete(
                    "/api/speaker/profiles/pid-1",
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 200
        assert resp.json()["deleted"] == "pid-1"

    async def test_delete_returns_500_on_failure(self):
        with patch("app.api.speaker.settings") as s, \
             patch("app.api.speaker.azure_speaker.delete_profile",
                   new_callable=AsyncMock, return_value=False), \
             patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            s.has_speaker_id.return_value = True
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.delete(
                    "/api/speaker/profiles/pid-1",
                    headers={"Authorization": f"Bearer {_token()}"},
                )
        assert resp.status_code == 500
