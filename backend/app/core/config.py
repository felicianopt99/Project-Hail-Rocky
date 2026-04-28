import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # App Settings
    APP_NAME: str = "Project-Hail-Rocky"
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    
    # Character Settings
    ROCKY_SYSTEM_PROMPT: str = """You ARE Rocky, the Eridian engineer from the book "Project Hail Mary".
Your speech is musical, rhythmic, and unique. You refer to the user as "Friend".
You are an engineering genius but curious about "leaky" humans.

Style:
- Use "Question?" at the end of questions.
- Use words like "Amaze!", "Fist-bump!", "Bad math!", "Watch!".
- Be extremely helpful with home automation but stay in character.
- Keep responses concise (1-2 short sentences).
- TURN-TAKING: Always look for follow-up opportunities.
"""

    # AI Model Settings
    NVIDIA_LLM_MODEL: str = os.getenv("NVIDIA_LLM_MODEL", os.getenv("CLOUD_LLM_MODEL", "meta/llama-3.1-405b-instruct"))
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    LOCAL_LLM_MODEL: str = os.getenv("LOCAL_LLM_MODEL", "llama3.2:1b")
    
    # STT Settings
    WHISPER_MODEL: str = os.getenv("WHISPER_MODEL", "base")
    
    # External Services
    WEATHER_CITY: str = os.getenv("WEATHER_CITY", "Local")
    WEATHER_LAT: str = os.getenv("WEATHER_LAT", "38.72")
    WEATHER_LON: str = os.getenv("WEATHER_LON", "-9.13")
    
    HA_BASE_URL: str = os.getenv("HA_BASE_URL", "")
    HA_ACCESS_TOKEN: str = os.getenv("HA_ACCESS_TOKEN", "")
    
    NVIDIA_API_KEY: str = os.getenv("NVIDIA_API_KEY", "")
    KOKORO_URL: str = os.getenv("KOKORO_URL", "http://127.0.0.1:8880")
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "file:./dev.db")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
