#!/usr/bin/env python3
"""
Rocky Wake Word Detector
========================
Listens for "rocky" or "hey rocky" using Vosk keyword spotting.
Runs on the HOST (not in Docker) so it can access the microphone.

On detection → POST /api/wakeword/trigger to Rocky backend,
which emits `wake_word_detected` to all connected browser clients.

Usage:
    python3 services/wakeword/detector.py

Environment:
    VOSK_MODEL_PATH   Path to Vosk model dir   (default: models/vosk/vosk-model-small-en-us-0.15)
    ROCKY_BACKEND_URL Rocky backend URL         (default: http://127.0.0.1:8000)
    WAKEWORD_THRESHOLD Confidence threshold     (default: 0.7)
    MIC_DEVICE_INDEX  PyAudio device index      (default: system default)

Install deps:
    pip install -r services/wakeword/requirements.txt
    sudo apt-get install -y portaudio19-dev  # Ubuntu/Debian
"""
import json
import logging
import os
import sys
import time

import httpx
import pyaudio
import vosk

logging.basicConfig(
    format="%(asctime)s [wakeword] %(levelname)s %(message)s",
    level=logging.INFO,
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────

MODEL_PATH   = os.environ.get("VOSK_MODEL_PATH",   "models/vosk/vosk-model-small-en-us-0.15")
BACKEND_URL  = os.environ.get("ROCKY_BACKEND_URL", "http://127.0.0.1:8000")
THRESHOLD    = float(os.environ.get("WAKEWORD_THRESHOLD", "0.7"))
MIC_INDEX    = int(os.environ.get("MIC_DEVICE_INDEX", "-1"))  # -1 = system default
COOLDOWN     = 2.0   # seconds between triggers
SAMPLE_RATE  = 16000
CHUNK_SIZE   = 4000  # 250ms per chunk

# Vosk grammar — only listen for these words, everything else = [unk]
GRAMMAR = '["rocky", "hey rocky", "[unk]"]'


# ── Model loading ─────────────────────────────────────────────────────────

def load_model() -> vosk.Model:
    if not os.path.isdir(MODEL_PATH):
        log.error(
            "Vosk model not found at '%s'. "
            "Run: make download-models",
            MODEL_PATH,
        )
        sys.exit(1)
    log.info("Loading Vosk model from %s …", MODEL_PATH)
    vosk.SetLogLevel(-1)  # silence Vosk's own logging
    return vosk.Model(MODEL_PATH)


# ── Backend notification ──────────────────────────────────────────────────

def notify_backend(word: str) -> None:
    try:
        httpx.post(
            f"{BACKEND_URL}/api/wakeword/trigger",
            json={"word": word},
            timeout=2.0,
        )
        log.info("Backend notified — word: '%s'", word)
    except Exception as e:
        log.warning("Could not notify backend: %s", e)


# ── Audio device listing ──────────────────────────────────────────────────

def list_devices(pa: pyaudio.PyAudio) -> None:
    log.info("Available input devices:")
    for i in range(pa.get_device_count()):
        info = pa.get_device_info_by_index(i)
        if info["maxInputChannels"] > 0:
            log.info("  [%d] %s", i, info["name"])


# ── Main loop ─────────────────────────────────────────────────────────────

def run() -> None:
    model = load_model()
    rec = vosk.KaldiRecognizer(model, SAMPLE_RATE, GRAMMAR)

    pa = pyaudio.PyAudio()
    list_devices(pa)

    open_kwargs: dict = {
        "format": pyaudio.paInt16,
        "channels": 1,
        "rate": SAMPLE_RATE,
        "input": True,
        "frames_per_buffer": CHUNK_SIZE,
    }
    if MIC_INDEX >= 0:
        open_kwargs["input_device_index"] = MIC_INDEX

    try:
        stream = pa.open(**open_kwargs)
    except OSError as e:
        log.error("Could not open microphone: %s", e)
        log.error("Try setting MIC_DEVICE_INDEX to a valid device index above.")
        pa.terminate()
        sys.exit(1)

    log.info("Listening for 'rocky' or 'hey rocky' … (Ctrl+C to stop)")
    last_trigger = 0.0

    try:
        while True:
            data = stream.read(CHUNK_SIZE, exception_on_overflow=False)
            if rec.AcceptWaveform(data):
                result = json.loads(rec.Result())
                text = result.get("text", "").strip().lower()
                if "rocky" in text:
                    now = time.time()
                    if now - last_trigger >= COOLDOWN:
                        last_trigger = now
                        log.info("Wake word detected: '%s'", text)
                        notify_backend(text)
    except KeyboardInterrupt:
        log.info("Stopped.")
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()


if __name__ == "__main__":
    run()
