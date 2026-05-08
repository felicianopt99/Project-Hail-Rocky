import pytest
import httpx
from unittest.mock import AsyncMock, patch
from app.main import app as fastapi_app
from app.core.security import create_access_token
from app.config import settings


def _auth_token(username: str | None = None) -> str:
    return create_access_token({"sub": username or settings.admin_username})


class TestLogin:
    async def test_login_success(self):
        with patch("app.api.auth.verify_password", return_value=True), \
             patch("app.api.auth.settings") as s:
            s.admin_username = "admin"
            s.admin_password_hash = "$2b$12$fakehash"
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/auth/login",
                    data={"username": "admin", "password": "secret"},
                )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert "refresh_token" in body
        assert body["token_type"] == "bearer"

    async def test_login_wrong_username(self):
        with patch("app.api.auth.settings") as s:
            s.admin_username = "admin"
            s.admin_password_hash = "$2b$12$fakehash"
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/auth/login",
                    data={"username": "hacker", "password": "secret"},
                )
        assert resp.status_code == 400
        assert "Incorrect" in resp.json()["detail"]

    async def test_login_wrong_password(self):
        with patch("app.api.auth.verify_password", return_value=False), \
             patch("app.api.auth.settings") as s:
            s.admin_username = "admin"
            s.admin_password_hash = "$2b$12$fakehash"
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/auth/login",
                    data={"username": "admin", "password": "wrong"},
                )
        assert resp.status_code == 400
        assert "Incorrect" in resp.json()["detail"]


class TestRefresh:
    async def test_refresh_returns_new_tokens(self):
        refresh_token = create_access_token({"sub": settings.admin_username})

        with patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/auth/refresh",
                    json={"refresh_token": refresh_token},
                )
        assert resp.status_code == 200
        body = resp.json()
        assert "access_token" in body
        assert "refresh_token" in body

    async def test_refresh_with_invalid_token(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.post(
                "/api/auth/refresh",
                json={"refresh_token": "not.a.valid.token"},
            )
        assert resp.status_code == 401

    async def test_refresh_with_blacklisted_token(self):
        refresh_token = create_access_token({"sub": settings.admin_username})

        with patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=True):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/auth/refresh",
                    json={"refresh_token": refresh_token},
                )
        assert resp.status_code == 401
        assert "revoked" in resp.json()["detail"].lower()


class TestLogout:
    async def test_logout_blacklists_token(self):
        token = _auth_token()

        with patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False), \
             patch("app.api.auth.blacklist_token", new_callable=AsyncMock) as mock_blacklist:
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/auth/logout",
                    headers={"Authorization": f"Bearer {token}"},
                )
        assert resp.status_code == 200
        assert "Logged out" in resp.json()["detail"]
        mock_blacklist.assert_called_once()

    async def test_logout_without_token_returns_401(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.post("/api/auth/logout")
        assert resp.status_code == 401


class TestMe:
    async def test_me_returns_username(self):
        token = _auth_token()

        with patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=False):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get(
                    "/api/auth/me",
                    headers={"Authorization": f"Bearer {token}"},
                )
        assert resp.status_code == 200
        assert resp.json()["username"] == settings.admin_username

    async def test_me_rejects_blacklisted_token(self):
        token = _auth_token()

        with patch("app.api.auth.is_blacklisted", new_callable=AsyncMock, return_value=True):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get(
                    "/api/auth/me",
                    headers={"Authorization": f"Bearer {token}"},
                )
        assert resp.status_code == 401

    async def test_me_rejects_invalid_token(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get(
                "/api/auth/me",
                headers={"Authorization": "Bearer bad.token"},
            )
        assert resp.status_code == 401
