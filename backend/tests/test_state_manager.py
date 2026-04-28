import pytest
import asyncio
from unittest.mock import AsyncMock, patch
from app.services.state_manager import StateManager

@pytest.mark.asyncio
async def test_state_manager_weather_sync():
    sm = StateManager()
    sm._session = AsyncMock()
    
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.json.return_value = {
        "current": {
            "temperature_2m": 20,
            "weather_code": 0
        }
    }
    sm._session.get.return_value.__aenter__.return_value = mock_response
    
    await sm.sync_weather()
    assert sm.state["weather"]["temp"] == 20
    assert sm.state["weather"]["city"] == "Local"
