# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Start dev server (Express + Vite in one process, hot-reload via tsx watch)
npm run dev                        # http://localhost:3005

# Type-check only (no test runner exists)
npm run lint                       # tsc --noEmit

# Production build (Vite only — server.ts is run directly)
npm run build && NODE_ENV=production npm run dev

# Docker (full stack: app + kokoro + piper + openwakeword + ollama + homeassistant)
docker-compose up --build

# Prisma — schema is at prisma/schema.prisma, DB is SQLite at dev.db
npx prisma db push                 # Apply schema changes
npx prisma studio                  # Browse data

# One-off scratch scripts (TypeScript utilities in scratch/)
npx tsx scratch/test_groq.ts
```

## Architecture

### Process Model
`server.ts` is the single entry point. It starts an Express HTTP server and embeds Vite as middleware (dev) or serves `dist/` (prod). Socket.io is mounted on the same HTTP server. There is no separate frontend build step for development.

### Request Flow (Voice)
```
Browser mic → AudioWorklet (pcm-processor.js, resamples to 16kHz PCM)
  → socket "audio_chunk" → OrchestratorService.handleAudioChunk()
    → VadService (Silero VAD v5 ONNX) decides if speech
    → if active command: buffer chunks
    → silence timeout (1200ms default) → processCommand()
      → GroqSttService (Whisper via Groq API) → transcript
      → LLMService.processChat() streaming tokens
        → sentence boundary detection → speak()
          → KokoroService (HTTP PCM stream, port 8880) → fallback PiperService (Wyoming TCP, port 10200)
      → socket "tts_chunk" ArrayBuffer → Web Audio API scheduled playback
```

### Wake Word Flow
```
Browser mic → socket "audio_chunk"
  → if NOT active command: WakeWordService.sendAudio()
    → TCP socket to openwakeword server (port 10400, Wyoming protocol)
    → "detection" event received → session.wwService emits "wake_word"
      → OrchestratorService.triggerWakeWord() → sets isCommandActive = true
```

### Key Files
| File | Purpose |
|---|---|
| `server.ts` | Entry point — Express + Vite + Socket.io bootstrap |
| `src/socket/handlers.ts` | All Socket.io event wiring, session lifecycle |
| `src/managers/SessionManager.ts` | Per-device Session objects (buffers, wake word service, state) |
| `src/managers/SystemStateManager.ts` | Home Assistant state, modes, protocols, weather — singleton |
| `src/services/orchestratorService.ts` | Core pipeline: VAD → STT → LLM → TTS sequencing |
| `src/services/vadService.ts` | Silero VAD v5 ONNX inference (models/silero_vad.onnx) |
| `src/services/wakeWordService.ts` | TCP client to Wyoming openWakeWord server |
| `src/services/groqSttService.ts` | Groq Whisper API (auto-detect language via `GROQ_STT_LANGUAGE`) |
| `src/services/kokoroService.ts` | Kokoro TTS HTTP client → raw PCM stream |
| `src/services/piperService.ts` | Piper TTS Wyoming TCP client → raw PCM stream |
| `src/services/llmService.ts` | NVIDIA NIM → Gemini → Ollama fallback chain |
| `src/skills/SkillManager.ts` | Tool-call registry (LightControl, Weather) |
| `public/pcm-processor.js` | AudioWorklet: resamples browser audio to 16kHz Int16 |
| `scripts/wakeword_detector.py` | Python Wyoming server wrapping openWakeWord |

### Session vs SystemState
- `Session` (SessionManager): per-device, holds audio buffers, wake word service instance, VAD state, TTS queue
- `SystemState` (SystemStateManager): global singleton, Home Assistant device state, modes, protocols — broadcast to all connected sockets

### Audio Protocol Details
- **Browser → Server**: raw Int16 PCM at 16kHz via Socket.io binary frames
- **Wake word**: Wyoming framing — JSON header line + `\n` + binary payload. Server sends `audio-start`, `audio-chunk` (with `payload_length`), `audio-stop`
- **TTS → Browser**: raw Int16 PCM chunks via `tts_chunk` events, preceded by `tts_start { sampleRate }`. Browser uses Web Audio API with jitter buffer scheduling
- **Kokoro**: `response_format: "pcm"` (raw, no WAV header) at 24kHz
- **Piper**: Wyoming response — `audio-chunk` events containing raw PCM at 22050Hz

### LLM Fallback Chain
NVIDIA NIM (5s timeout) → Gemini (if `GEMINI_API_KEY`) → Ollama local (`LOCAL_LLM_URL`, model `rocky`). Cloud failure is sticky per session (`session.cloudFailed`).

### Adding a Skill
1. Create `src/skills/MySkill/index.ts` extending `BaseSkill`
2. Implement `getDefinition()` (OpenAI function spec) and `execute(args)`
3. Register in `src/skills/SkillManager.ts` constructor

## Environment Variables
Copy `.env.example` to `.env.local`. Key variables:

| Variable | Default | Notes |
|---|---|---|
| `GROQ_API_KEY` | — | Required for STT |
| `GROQ_STT_LANGUAGE` | *(auto)* | Leave blank for multilingual auto-detect, `"pt"` for Portuguese, `"en"` for English |
| `KOKORO_URL` | `http://127.0.0.1:8880` | Primary TTS |
| `PIPER_HOST/PORT` | `127.0.0.1:10200` | Fallback TTS |
| `WAKEWORD_HOST/PORT` | `127.0.0.1:10400` | openWakeWord TCP |
| `NVIDIA_API_KEY` | — | Cloud LLM (optional) |
| `GEMINI_API_KEY` | — | Cloud LLM fallback |
| `LOCAL_LLM_URL` | `http://127.0.0.1:11434/v1` | Ollama endpoint |
| `HA_BASE_URL` / `HA_ACCESS_TOKEN` | — | Home Assistant |

## Wake Word Models
Custom `.tflite`/`.onnx` models go in `models/wakeword/`. The Python server auto-loads them plus built-in `amaze` and `hi_rocky`. Detection threshold is `0.5` (hardcoded in `wakeword_detector.py:83`).
