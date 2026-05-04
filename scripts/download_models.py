#!/usr/bin/env python3
"""
Download all models needed by Rocky.

Usage:
    python3 scripts/download_models.py
    python3 scripts/download_models.py vosk     # only Vosk
    python3 scripts/download_models.py silero   # only Silero VAD
"""
import os
import sys
import urllib.request
import zipfile

MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")

# ── Silero VAD ────────────────────────────────────────────────────────────

SILERO_URL  = "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
SILERO_DEST = os.path.join(MODELS_DIR, "silero_vad.onnx")


def download_silero():
    if os.path.exists(SILERO_DEST):
        print(f"[silero] Already exists: {SILERO_DEST}")
        return
    os.makedirs(MODELS_DIR, exist_ok=True)
    print("[silero] Downloading Silero VAD …")
    urllib.request.urlretrieve(SILERO_URL, SILERO_DEST)
    print(f"[silero] Saved {os.path.getsize(SILERO_DEST):,} bytes → {SILERO_DEST}")


# ── Vosk (wake word + offline STT) ───────────────────────────────────────

VOSK_MODEL_NAME = "vosk-model-small-en-us-0.15"
VOSK_URL  = f"https://alphacephei.com/vosk/models/{VOSK_MODEL_NAME}.zip"
VOSK_DEST = os.path.join(MODELS_DIR, "vosk", VOSK_MODEL_NAME)
VOSK_ZIP  = os.path.join(MODELS_DIR, "vosk", f"{VOSK_MODEL_NAME}.zip")


def _reporthook(block, block_size, total):
    downloaded = block * block_size
    if total > 0:
        pct = min(100, int(downloaded * 100 / total))
        mb = downloaded / 1024 / 1024
        print(f"\r  {pct:3d}%  {mb:.1f} MB", end="", flush=True)


def download_vosk():
    if os.path.isdir(VOSK_DEST):
        print(f"[vosk] Already exists: {VOSK_DEST}")
        return
    os.makedirs(os.path.join(MODELS_DIR, "vosk"), exist_ok=True)
    print(f"[vosk] Downloading {VOSK_MODEL_NAME} (~50 MB) …")
    urllib.request.urlretrieve(VOSK_URL, VOSK_ZIP, reporthook=_reporthook)
    print()
    print("[vosk] Extracting …")
    with zipfile.ZipFile(VOSK_ZIP, "r") as z:
        z.extractall(os.path.join(MODELS_DIR, "vosk"))
    os.remove(VOSK_ZIP)
    print(f"[vosk] Extracted → {VOSK_DEST}")


# ── Entry point ───────────────────────────────────────────────────────────

TARGETS = {
    "silero": download_silero,
    "vosk":   download_vosk,
}

if __name__ == "__main__":
    requested = sys.argv[1:] or list(TARGETS.keys())
    for name in requested:
        if name not in TARGETS:
            print(f"Unknown model: {name}. Options: {', '.join(TARGETS)}")
            sys.exit(1)
        TARGETS[name]()
    print("\nAll done.")
