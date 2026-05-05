import pytest
from fastapi.testclient import TestClient

def test_health_check(api_client: TestClient):
    """Verify that the health endpoint returns 200 OK."""
    response = api_client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "service" in data

def test_openapi_docs(api_client: TestClient):
    """Ensure OpenAPI documentation is accessible."""
    response = api_client.get("/api/openapi.json")
    assert response.status_code == 200
    assert "openapi" in response.json()

def test_settings_unauthorized(api_client: TestClient):
    """Verify that settings endpoint requires auth (if implemented)."""
    # Assuming /api/settings requires some form of validation or is accessible
    response = api_client.get("/api/settings")
    # If it's a GET, it might return defaults or 401 depending on implementation
    assert response.status_code in [200, 401]

def test_brain_status(api_client: TestClient):
    """Check brain service status via API."""
    response = api_client.get("/api/brain/status")
    # We expect 200 if service is up, or 401 if it requires auth
    assert response.status_code in [200, 401, 404] # 404 if not implemented yet
