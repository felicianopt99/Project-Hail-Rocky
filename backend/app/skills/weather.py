import httpx
from app.core.config import settings
# from vision_agents import tool

# @tool
async def get_weather(period: str = "current") -> str:
    """
    Get real-time weather and forecasts.
    - period: 'current', 'tomorrow', or 'forecast'.
    """
    lat = settings.WEATHER_LAT
    lon = settings.WEATHER_LON
    city = settings.WEATHER_CITY
    
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto",
                timeout=5
            )
            res.raise_for_status()
            data = res.json()
        
        def get_desc(code):
            if code == 0:
                return "Clear Sky"
            if 1 <= code <= 3:
                return "Partly Cloudy"
            if 45 <= code <= 48:
                return "Fog"
            if 51 <= code <= 67:
                return "Light Rain"
            if 71 <= code <= 77:
                return "Snow"
            if 80 <= code <= 82:
                return "Showers"
            if code >= 95:
                return "Thunderstorm"
            return "Variable"

        if period == "tomorrow":
            temp_max = data["daily"]["temperature_2m_max"][1]
            temp_min = data["daily"]["temperature_2m_min"][1]
            desc = get_desc(data["daily"]["weather_code"][1])
            return f"Tomorrow in {city}: Highs of {temp_max}°C and lows of {temp_min}°C. Atmospheric state: {desc}. Watch!"

        temp = data["current"]["temperature_2m"]
        desc = get_desc(data["current"]["weather_code"])
        return f"Current readout for {city}: Temperature is {temp}°C. Visual spectrum indicates {desc}. Amaze!"
        
    except Exception as e:
        return f"Bad math! Weather data unavailable: {str(e)}. Fist-bump?"
