#!/bin/bash

# Configuration
HOST="127.0.0.1"
PORT="10400" # OpenWakeWord
# PORT="10300" # Whisper (STT)

echo "Testing Wyoming Wake Word Service (OpenWakeWord) on $HOST:$PORT"
echo "Make sure the docker containers are running."
echo ""
echo "Recording 16kHz mono PCM from your default microphone..."
echo "Say 'Alexa' clearly!"
echo ""

# Record and pipe
arecord -r 16000 -c 1 -f S16_LE -t raw | python3 scripts/wyoming_sender.py $HOST $PORT
