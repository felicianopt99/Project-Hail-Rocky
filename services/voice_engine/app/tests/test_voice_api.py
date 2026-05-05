import pytest
from fastapi.testclient import TestClient
from app.main import app

def test_health_check():
    # Use context manager to trigger lifespan (and model loading)
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        # If it still fails, it might be the models themselves, 
        # but at least we triggered the loading.
        data = response.json()
        assert "status" in data
        assert "engine" in data

def test_docs_reachable():
    with TestClient(app) as client:
        response = client.get("/docs")
        assert response.status_code == 200
