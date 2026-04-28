import urllib.request
import os

MODEL_DIR = "/usr/local/lib/python3.11/site-packages/openwakeword/resources/models"
os.makedirs(MODEL_DIR, exist_ok=True)

BASE_URL = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1"
MODELS = [
    "silero_vad.onnx",
    "melspectrogram.tflite",
    "embedding_model.tflite",
    "alexa_v0.1.tflite",
    "hey_mycroft_v0.1.tflite",
]

for filename in MODELS:
    dest = os.path.join(MODEL_DIR, filename)
    url = f"{BASE_URL}/{filename}"
    print(f"Downloading {filename}...")
    urllib.request.urlretrieve(url, dest)
    print(f"  -> {os.path.getsize(dest)} bytes")

print("All models downloaded.")
