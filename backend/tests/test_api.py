import pytest

@pytest.mark.asyncio
async def test_health_check(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "Rocky" in response.json()["message"]

@pytest.mark.asyncio
async def test_app_metadata(client):
    response = await client.get("/health")
    data = response.json()
    assert "version" in data
    assert data["version"] == "2.0.0-pro"
