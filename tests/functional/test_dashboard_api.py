import pytest
import httpx
from unittest.mock import patch, MagicMock
from app.main import app as fastapi_app


class TestDashboardMetrics:
    async def test_metrics_returns_expected_fields(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/api/dashboard/metrics")
        assert resp.status_code == 200
        body = resp.json()
        assert "cpu" in body
        assert "ram" in body
        assert "totalRam" in body
        assert "temp" in body

    async def test_metrics_cpu_is_numeric(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/api/dashboard/metrics")
        body = resp.json()
        assert isinstance(body["cpu"], float | int)
        assert 0 <= body["cpu"] <= 100

    async def test_metrics_ram_is_numeric(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/api/dashboard/metrics")
        body = resp.json()
        assert isinstance(body["ram"], float | int)
        assert 0 <= body["ram"] <= 100

    async def test_metrics_handles_no_temperature_sensors(self):
        with patch("app.api.dashboard.psutil.sensors_temperatures", return_value=None):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/dashboard/metrics")
        assert resp.status_code == 200
        assert resp.json()["temp"] == 0.0

    async def test_metrics_handles_sensor_exception(self):
        with patch("app.api.dashboard.psutil.sensors_temperatures",
                   side_effect=Exception("not supported")):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/dashboard/metrics")
        assert resp.status_code == 200
        assert resp.json()["temp"] == 0.0

    async def test_metrics_with_temperature_sensors(self):
        mock_entry = MagicMock()
        mock_entry.current = 55.5
        with patch("app.api.dashboard.psutil.sensors_temperatures",
                   return_value={"coretemp": [mock_entry]}):
            transport = httpx.ASGITransport(app=fastapi_app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
                resp = await ac.get("/api/dashboard/metrics")
        assert resp.json()["temp"] == 55.5


class TestDashboardHealth:
    async def test_health_returns_ok(self):
        transport = httpx.ASGITransport(app=fastapi_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/api/dashboard/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
