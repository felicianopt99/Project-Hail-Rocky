#!/bin/bash

# Install system dependencies if needed (Debian/Ubuntu)
if ! dpkg -s libportaudio2 >/dev/null 2>&1; then
    echo "Installing system dependencies..."
    sudo apt-get update && sudo apt-get install -y libportaudio2 python3-pyaudio
fi

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r scripts/requirements_wakeword.txt

# Run the detector
echo "Starting openWakeWord detector..."
python3 scripts/wakeword_detector.py --model_path models/wakeword --threshold 0.5
