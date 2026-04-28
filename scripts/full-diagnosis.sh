#!/bin/bash

# Full Audio Diagnosis - Automated End-to-End
# Runs synthetic audio test while monitoring Docker logs

set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOGFILE="diagnosis_${TIMESTAMP}.log"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║        🚀 FULL AUDIO DIAGNOSIS - AUTOMATED                    ║"
echo "║                                                                ║"
echo "║  This will test the entire audio pipeline automatically       ║"
echo "║  Results will be saved to: $LOGFILE            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if docker-compose is running
echo "🔍 Checking Docker services..."
if ! docker-compose ps | grep -q "rocky-assistant"; then
  echo "❌ ERROR: rocky-assistant container not running"
  echo "   Please run: docker-compose up -d"
  exit 1
fi
echo "✅ Docker services running"
echo ""

# Start monitoring logs in background
echo "📊 Starting log monitor..."
docker-compose logs -f app > "$LOGFILE" 2>&1 &
DOCKER_PID=$!
echo "   (PID: $DOCKER_PID)"
sleep 1
echo ""

# Function to stop monitoring on exit
cleanup() {
  echo ""
  echo "🛑 Stopping log monitor..."
  kill $DOCKER_PID 2>/dev/null || true
  wait $DOCKER_PID 2>/dev/null || true
}
trap cleanup EXIT

# Run synthetic audio test
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎵 STARTING SYNTHETIC AUDIO TEST"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

npx tsx scripts/test-audio-synthetic.ts 2>&1 | tee -a "$LOGFILE"

TEST_EXIT_CODE=$?

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 ANALYZING RESULTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Wait for logs to be written
sleep 2

# Check for key indicators
echo "🔎 Checking diagnostic markers..."
echo ""

if grep -q "\[COMMAND-ACCEPTED\]" "$LOGFILE"; then
  echo "✅ COMMAND-ACCEPTED found"
  grep "\[COMMAND-ACCEPTED\]" "$LOGFILE" | head -1
  echo ""
  echo "🎉 SUCCESS! Audio pipeline is working!"
  echo ""
  echo "Next steps:"
  echo "  1. Verify STT (Groq Whisper) is working"
  echo "  2. Check LLM responses"
  echo "  3. Test TTS (Kokoro/Piper)"
  exit 0
fi

if grep -q "\[CRITICAL-DISCARD\]" "$LOGFILE"; then
  echo "❌ CRITICAL-DISCARD found"
  echo ""
  grep "\[CRITICAL-DISCARD\]" "$LOGFILE" | head -1
  echo ""

  # Analyze why it was discarded
  if grep -q "ZERO_SPEECH_DETECTED" "$LOGFILE"; then
    echo "🔴 PROBLEM: VAD never detected speech"
    echo ""
    echo "   Possible causes:"
    echo "   1. VAD service not initialized (check openwakeword container)"
    echo "   2. Thresholds too high (speechProb never exceeds threshold)"
    echo "   3. Audio chunks are silent/empty"
    echo ""
    echo "   Diagnostics:"
    grep -E "\[DIAGNOSTIC-VAD\]|\[SPEECH-DETECTED\]" "$LOGFILE" | head -5
  elif grep -q "TOO_FAST" "$LOGFILE"; then
    echo "🔴 PROBLEM: Command ended too quickly (< 300ms)"
    echo "   The silence timeout might be too aggressive"
  elif grep -q "LOW_RATIO" "$LOGFILE"; then
    echo "🔴 PROBLEM: Low speech ratio (< 5% of buffer)"
    echo "   Very little speech detected compared to silence"
  fi
  exit 1
fi

if grep -q "\[DIAGNOSTIC-VAD\]" "$LOGFILE"; then
  echo "⚠️  DIAGNOSTIC-VAD found but no final result"
  echo ""
  echo "   VAD is running but command processing incomplete"
  echo "   This might be a timeout or network issue"
  echo ""
  echo "   VAD probabilities:"
  grep "\[DIAGNOSTIC-VAD\]" "$LOGFILE" | head -5
  exit 1
fi

echo "❓ No diagnostic markers found"
echo ""
echo "   Possible causes:"
echo "   1. Wake word never triggered (check openwakeword)"
echo "   2. Socket connection dropped"
echo "   3. Server crashed"
echo ""
echo "   Full log saved to: $LOGFILE"
exit 1
