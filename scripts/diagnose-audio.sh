#!/bin/bash

# Audio Flow Diagnostic Script
# Monitors Docker logs for audio processing and saves diagnostics

LOGFILE="audio-diagnosis-$(date +%s).log"
echo "🔍 Starting audio diagnosis... Logs will be saved to: $LOGFILE"
echo ""
echo "📋 Instructions:"
echo "  1. Click the mic button on the web app"
echo "  2. Say something clearly (e.g., 'hello test one two three')"
echo "  3. Wait 2 seconds of silence"
echo "  4. Script will capture logs and show results"
echo ""
echo "⏳ Waiting for audio input... (Ctrl+C to stop)"
echo ""

# Monitor Docker logs and save relevant lines
docker-compose logs -f app 2>&1 | while IFS= read -r line; do
  # Save ALL lines
  echo "$line" >> "$LOGFILE"

  # Print diagnostic lines to console
  if echo "$line" | grep -qE "\[DIAGNOSTIC\]|\[SPEECH\]|\[COMMAND\]|\[CRITICAL\]|\[AudioProcessor\]|\[Orchestrator\]|\[STT\]"; then
    echo "$line"
  fi

  # Stop if we see command accepted or discarded
  if echo "$line" | grep -qE "\[COMMAND-ACCEPTED\]|\[CRITICAL-DISCARD\]"; then
    echo ""
    echo "✅ Diagnosis captured. Stopping."
    sleep 2
    exit 0
  fi
done

echo ""
echo "📊 Full log saved to: $LOGFILE"
echo ""
echo "Analysis:"
if grep -q "\[CRITICAL-DISCARD\]" "$LOGFILE"; then
  echo "❌ PROBLEM FOUND: Command discarded before STT"
  echo ""
  grep "\[CRITICAL-DISCARD\]" "$LOGFILE"
elif grep -q "\[COMMAND-ACCEPTED\]" "$LOGFILE"; then
  echo "✅ Audio pipeline working! Command sent to STT"
  echo ""
  grep "\[COMMAND-ACCEPTED\]" "$LOGFILE"
elif grep -q "\[DIAGNOSTIC-VAD\]" "$LOGFILE"; then
  echo "⚠️  VAD is running but command not ready yet"
  echo ""
  grep "\[DIAGNOSTIC-VAD\]" "$LOGFILE"
else
  echo "⚠️  No diagnostic logs found. Check if wake word was triggered."
fi
