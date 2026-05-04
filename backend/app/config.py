from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LLM
    groq_api_key: str = ""
    nvidia_api_key: str = ""
    gemini_api_key: str = ""
    llm_model: str = ""

    # STT
    groq_stt_model: str = "whisper-large-v3"
    groq_stt_language: str = ""  # empty = auto-detect

    # Voice Engine (Consolidated synthesis + effects)
    voice_engine_url: str = ""  # e.g. http://127.0.0.1:8880


    # Frontend (used for CORS origin restriction)
    frontend_url: str = "http://127.0.0.1:5173"

    # Locale
    timezone: str = "UTC"  # e.g. Europe/Lisbon — used by get_datetime tool

    # Home Assistant
    ha_base_url: str = ""       # e.g. http://192.168.1.100:8123
    ha_access_token: str = ""   # Long-Lived Access Token from HA profile page

    # Redis
    redis_url: str = "redis://127.0.0.1:6379"

    # Auth
    secret_key: str = "change-me-in-production-use-openssl-rand-hex-32"
    admin_username: str = "admin"
    admin_password_hash: str = ""

    # Letta memory server
    letta_url: str = ""  # e.g. http://127.0.0.1:8283; empty = Letta disabled

    # Azure Speaker Recognition
    azure_speaker_key: str = ""     # Cognitive Services key
    azure_speaker_region: str = "westeurope"

    class Config:
        env_file = ".env"
        extra = "ignore"

    def get_llm_model(self) -> str:
        if self.llm_model:
            return self.llm_model
        if self.groq_api_key:
            return "groq/llama-3.3-70b-versatile"
        if self.gemini_api_key:
            return "gemini/gemini-2.0-flash"
        if self.nvidia_api_key:
            return "nvidia_nim/meta/llama-3.1-70b-instruct"
        return ""

    def has_llm(self) -> bool:
        return bool(self.groq_api_key or self.gemini_api_key or self.nvidia_api_key or self.llm_model)

    def has_stt(self) -> bool:
        return bool(self.groq_api_key)

    def has_tts(self) -> bool:
        return bool(self.voice_engine_url)

    def has_pipecat(self) -> bool:
        return bool(self.voice_engine_url)

    def has_letta(self) -> bool:
        return bool(self.letta_url)

    def has_speaker_id(self) -> bool:
        return bool(self.azure_speaker_key)


settings = Settings()
