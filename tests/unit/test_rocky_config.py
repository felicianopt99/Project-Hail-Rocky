import pytest
import os
from app.config import Settings

# Helper to get clean settings
def get_clean_settings(**kwargs):
    # Clear ALL environment variables that might be in .env
    # We prefix with a list of common ones, but ideally we'd clear everything
    # that starts with certain prefixes or just everything temporarily.
    env_vars = [
        "GROQ_API_KEY", "NVIDIA_API_KEY", "GEMINI_API_KEY", "LLM_MODEL",
        "GROQ_STT_MODEL", "VOICE_ENGINE_URL", "LETTA_URL", "AZURE_SPEAKER_KEY",
        "REDIS_URL", "TIMEZONE", "FRONTEND_URL"
    ]
    old_values = {}
    for var in env_vars:
        old_values[var] = os.environ.get(var)
        if var in os.environ:
            del os.environ[var]
    
    try:
        # Pass _env_file=None to ignore local .env
        return Settings(_env_file=None, **kwargs)
    finally:
        # Restore env vars
        for var, val in old_values.items():
            if val is not None:
                os.environ[var] = val

def test_default_settings():
    settings = get_clean_settings()
    assert settings.groq_stt_model == "whisper-large-v3"
    assert settings.timezone == "UTC"
    assert "redis://" in settings.redis_url

def test_has_llm():
    # Only Groq
    settings = get_clean_settings(groq_api_key="sk-123", nvidia_api_key="", gemini_api_key="", llm_model="")
    assert settings.has_llm() is True
    
    # None
    settings = get_clean_settings(groq_api_key="", nvidia_api_key="", gemini_api_key="", llm_model="")
    assert settings.has_llm() is False

def test_get_llm_model_priority():
    # Model override
    settings = get_clean_settings(llm_model="custom/model")
    assert settings.get_llm_model() == "custom/model"
    
    # Groq priority
    settings = get_clean_settings(groq_api_key="g", gemini_api_key="m", nvidia_api_key="n", llm_model="")
    assert "groq" in settings.get_llm_model()
    
    # Gemini
    settings = get_clean_settings(gemini_api_key="m", groq_api_key="", nvidia_api_key="", llm_model="")
    assert "gemini" in settings.get_llm_model()
    
    # NVIDIA
    settings = get_clean_settings(nvidia_api_key="n", groq_api_key="", gemini_api_key="", llm_model="")
    assert "nvidia_nim" in settings.get_llm_model()

def test_service_flags():
    settings = get_clean_settings(voice_engine_url="http://voice:8881")
    assert settings.has_tts() is True
    assert settings.has_pipecat() is True
    
    settings = get_clean_settings(letta_url="http://letta:8283")
    assert settings.has_letta() is True
    
    settings = get_clean_settings(azure_speaker_key="key")
    assert settings.has_speaker_id() is True
