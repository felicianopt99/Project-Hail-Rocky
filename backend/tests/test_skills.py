import pytest
from unittest.mock import AsyncMock, patch
from app.skills.home_assistant import light_control
from app.skills.weather import get_weather

@pytest.mark.asyncio
async def test_weather_skill_success():
    # Mock httpx response
    mock_response = {
        "current": {
            "temperature_2m": 22.5,
            "weather_code": 0
        },
        "daily": {
            "temperature_2m_max": [25, 26],
            "temperature_2m_min": [15, 16],
            "weather_code": [0, 0]
        }
    }
    
    with patch("httpx.AsyncClient.get") as mock_get:
        mock_get.return_value = AsyncMock()
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = mock_response
        
        result = await get_weather("current")
        assert "22.5°C" in result
        assert "Clear Sky" in result

@pytest.mark.asyncio
async def test_light_control_no_config():
    with patch("app.core.config.settings.HA_BASE_URL", ""):
        result = await light_control("studio", "on")
        assert "Bad math!" in result
        assert "not configured" in result
