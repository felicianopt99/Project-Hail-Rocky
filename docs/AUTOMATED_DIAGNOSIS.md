# 🤖 Automated Audio Diagnosis

Two automated tests to diagnose the audio pipeline without manual intervention.

## Option A: Monitor Real Microphone Input (Recommended First)

### Step 1: Start the monitoring script
```bash
chmod +x scripts/diagnose-audio.sh
./scripts/diagnose-audio.sh
```

Script will print:
```
⏳ Waiting for audio input... (Ctrl+C to stop)
```

### Step 2: Trigger audio capture
1. Open browser at `http://localhost:3005`
2. Click the **mic button**
3. Say something clearly: **"hello test one two three"**
4. Wait **2 seconds of silence**

### Step 3: Check results
Script will automatically analyze and show:

**If working:**
```
✅ Audio pipeline working! Command sent to STT

[COMMAND-ACCEPTED] Command buffer ready to send to STT {
  audioBufferSize: 51200,
  speechFrames: 15,
  ratio: 0.850
}
```

**If broken:**
```
❌ PROBLEM FOUND: Command discarded before STT

[CRITICAL-DISCARD] Command discarded before STT {
  speechFrames: 0,
  reason: "ZERO_SPEECH_DETECTED"
}
```

---

## Option B: Synthetic Audio Test (Debug Without Microphone)

Generates a 1000 Hz test tone and sends it to the server automatically.

### Run test
```bash
npx tsx scripts/test-audio-synthetic.ts
```

Output will show:
```
✅ Connected to server
📤 Triggering wake word...
📤 Sending synthetic audio chunks (1000 Hz tone, 2 seconds)...
  📦 Sent chunk 0/40
  📦 Sent chunk 10/40
  📦 Sent chunk 20/40
  ...
🔇 Sending silence (2 seconds) to trigger STT...
✅ Silence sent

📝 STT Result: [text from Groq]
📊 Status update: processing_stt
📊 Status update: thinking_llm
🔊 TTS started: {sampleRate: 24000}
```

### If synthetic test works but microphone doesn't
→ Problem is in **browser audio capture** (AudioWorklet, MediaRecorder, or permissions)

### If synthetic test fails
→ Problem is in **server audio processing** (VAD, STT, LLM, or TTS)

---

## Full Diagnostic Flow

```
Test Synthetic Audio (Option B)
    ↓
    If WORKS → Microphone issue
    If FAILS → Server issue
         ↓
         Check [DIAGNOSTIC-VAD] logs
         ├─ speechProb low → VAD not working
         ├─ speechFrames 0 → Thresholds too high
         └─ audioBuffer 0 → Chunks not arriving
```

---

## Logs Location

After running tests, logs are saved to:
- **Diagnostic script:** `audio-diagnosis-{timestamp}.log`
- **Server logs:** `docker-compose logs app > server.log`

---

## What to provide if tests fail

```bash
# Capture server logs while test is running
docker-compose logs app > server-logs.txt

# Then run the test
npx tsx scripts/test-audio-synthetic.ts

# Share the output + server-logs.txt
```
