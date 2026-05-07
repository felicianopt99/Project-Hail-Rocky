import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).parent.parent
MODELS_DIR = BASE_DIR
WAKE_WORD_MODEL_PATH = str(MODELS_DIR / "models" / "wakeword" / "hey_rocky.onnx")
ASSETS_DIR = Path(__file__).parent / "assets"
BEEP_PATH = str(ASSETS_DIR / "beep.wav")

# Audio Settings
FORMAT = 16  # pyaudio.paInt16
CHANNELS = 1
RATE = 16000
CHUNK = 1280  # 80ms for openWakeWord and VAD

# Wake Word Settings
WAKE_WORD_THRESHOLD = 0.5

# VAD Settings
VAD_AGGRESSIVENESS = 3  # 0 to 3
SILENCE_TIMEOUT = 1.5  # Seconds of silence to stop recording

# STT Settings
STT_MODEL = "google"  # "google" or "whisper"
GOOGLE_LANGUAGE = "pt-BR"

# LLM Settings
LLM_PROVIDER = "ollama"  # "ollama" or "openai"
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# TTS Settings
TTS_PROVIDER = "edge-tts"  # "edge-tts" or "pyttsx3"
EDGE_VOICE = "pt-BR-AntonioNeural"  # or "pt-BR-FranciscaNeural"
