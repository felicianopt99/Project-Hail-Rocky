# Architecture — Project Hail Rocky

## Overview

Project Hail Rocky is a self-hosted smart home AI assistant built around the personality of Rocky from *Project Hail Mary*. The guiding principle: **integrate, don't build** — use mature open-source frameworks as the foundation and focus effort on what makes this unique: Rocky's personality, the voice experience, and the integration layer.

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend  React 19 + TypeScript + Tailwind + Framer Motion │
│  WebRTC (Media) │ Socket.io (Events) │ Lucide │ Framer      │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebRTC + Socket.io + REST
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend  FastAPI + python-socketio + aiortc                │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ WebRTC      │  │ Rocky Brain  │  │ Tool Calling       │ │
│  │ & SocketIO  │  │ Personality  │  │ Lights / Weather / │ │
│  │ Handlers    │  │ EmotState    │  │ Timer / Wikipedia  │ │
│  │             │  │ Intimacy     │  │ Calculator / HA    │ │
│  └──────┬──────┘  └──────┬───────┘  └────────────────────┘ │
└─────────┼────────────────┼────────────────────────────────-─┘
          │                │
    ┌─────▼──────┐   ┌─────▼──────┐   ┌────────────────────┐
    │  Pipecat   │   │   Letta    │   │  Home Assistant    │
    │  Service   │   │  (memory)  │   │  (smart home hub)  │
    │            │   │            │   │                    │
    │ VAD (VAD)  │   │ Core mem.  │   │  Lights / Scenes   │
    │ Groq STT   │   │ Recall     │   │  2000+ devices     │
    │ Speaker ID │   │ Archival   │   │  (REST / MCP)      │
    │ Kokoro TTS │   │ (Qdrant)   │   │                    │
    │ PitchShift │   │ Postgres   │   │                    │
    │ Reverb     │   │            │   │                    │
    │ Compress.  │   │            │   │                    │
    └────────────┘   └────────────┘   └────────────────────┘
          │
    ┌─────▼──────┐   ┌────────────┐   ┌────────────────────┐
    │  LiteLLM   │   │   Redis    │   │   Wakeword         │
    │  Router    │   │            │   │   Detector         │
    │            │   │  Sessions  │   │   (Vosk, host)     │
    │ Groq fast  │   │  State     │   │   "Hey Rocky"      │
    │ NIM smart  │   │  Cache     │   │                    │
    │ Gemini vis │   │  Quotas    │   │                    │
    │ Ollama off │   │            │   │                    │
    └────────────┘   └────────────┘   └────────────────────┘
```

---

## Voice Pipeline

**Current state (WebRTC + Pipecat Pipeline):**
```
Browser mic → WebRTC AudioTrack → Backend → Pipecat
  Pipecat: Silero VAD → Azure Speaker ID → Groq Whisper STT
         → RockyBrainProcessor (Hallucination filter) → Letta (Persistent memory)
         → LiteLLM (Streaming tokens) → DisfluencyInjector
         → Kokoro TTS (Sentence-level aggregation)
         → VoiceEffectsProcessor (Pitch/Reverb/Compression per emotional state)
         → WebRTC AudioTrack → Frontend (Browser Speakers)
```

The pipeline is fully operational via WebRTC, providing ultra-low latency (~400ms start-to-speak). Speaker ID and voice effects are fully integrated.

---

## Voice Effects by Emotional State

Rocky's voice changes with emotional state via pedalboard (Spotify):

| State | Pitch | Reverb | Speed | Notes |
|-------|-------|--------|-------|-------|
| `neutral` | +2 semitones | light | 1.0× | Default alien timbre |
| `excited` | +3 semitones | medium | 1.1× | Energy peaks |
| `curious` | +2 semitones | light | 1.0× | Variable pitch |
| `tired` | +1 semitone | minimal | 0.85× | Brief, slow |
| `focused` | +2 semitones | none | 1.0× | Clean, precise |

---

## Personality System

Rocky's personality is built from several composable layers:

- **System prompt** — built dynamically at runtime from `rocky/personality/system_prompt.py`, incorporating emotional state, intimacy score, time of day, speech mode, and optional easter eggs
- **Emotional states** — detected heuristically from message content + time; persisted in Redis (30-min TTL)
- **Intimacy progression** — 0–100 score per speaker, persisted in Redis; shapes formality, easter egg frequency, personal references
- **Catchphrases** — "Yes?", "Good. Good.", "Amaze.", "Fist bump!" — injected probabilistically
- **Easter eggs** — references to Astrophage, Eridiani, Taumoeba, Beetles; keyed by conversation topic
- **Speech modes** — Technical / Formal / Casual — auto-detected from message content + intimacy level
- **Disfluency** — "Hmm. ", "Rocky think. " — injected via LLM instruction for natural rhythm

---

## Memory Architecture (Letta)

```
Core Memory (always in context)
├── Persona block — Rocky's full character description
├── Human block — user profile, preferences, patterns (edited by agent)
├── Emotional state — current state + reason
└── Intimacy score — relationship level

Recall Memory (recent conversations)
└── Last N messages, textual search

Archival Memory (Qdrant vector DB)
├── Important facts (score > 0.7)
├── Preferences, patterns, key events
└── Semantic search via bge-m3 embeddings
```

Background workers (APScheduler):
- **Daily 23:00 local** — diary entry: Rocky reflects on the day's conversations
- **Sunday 04:00 local** — pattern analysis: detect user habits, update Human block

---

## LLM Routing (LiteLLM)

| Alias | Model | Provider | Use case |
|-------|-------|----------|----------|
| `rocky-fast` | llama-3.3-70b-versatile | Groq | Default conversation |
| `rocky-smart` | llama-3.1-70b-instruct | NVIDIA NIM | Complex reasoning |
| `rocky-vision` | gemini-2.0-flash-exp | Google | Images, documents |
| `rocky-offline` | phi3:mini-4k-q4_K_M | Ollama | No internet fallback |

Fallback chain: `rocky-fast` → `rocky-smart` → `rocky-vision` → `rocky-offline`

---

## Tools (LLM Function Calling)

Rocky's capabilities are exposed as LLM tools via OpenAI function calling format:

| Tool | Description |
|------|-------------|
| `get_datetime` | Current date and time (timezone-aware) |
| `set_timer` | Countdown timer with label |
| `get_weather` | Current weather + forecast (Open-Meteo, no API key) |
| `search_wikipedia` | Wikipedia summaries |
| `calculate` | Safe math expression evaluator |
| `control_lights` | Turn lights on/off, set brightness/color via Home Assistant |
| `activate_scene` | Activate a Home Assistant scene |

Tools can be enabled/disabled per-session from the Skills page.

---

## Docker Compose Profiles

| Profile | Services | When to use |
|---------|----------|-------------|
| *(default)* | backend + frontend + redis | Minimal — text chat only |
| `voice` | + kokoro + pipecat | Full voice pipeline |
| `letta` | + postgres + qdrant + letta | Persistent memory |
| `ha` | + homeassistant | Smart home control |
| `offline` | + ollama | No-internet fallback |
| `full` | everything | Production |

---

## Roadmap

### In Progress
1. **MCP-compatible tool registry** — Transition to Model Context Protocol for more standardized tool discovery
2. **TypeScript socket event types** — Strengthen the bridge between React frontend and FastAPI backend
3. **AudioWorklet refactor** — Improve browser-side buffer management for smoother playback under load

### Recently Completed
- **Voice effects wiring** — Integrated Spotify Pedalboard into Pipecat pipeline
- **Speculative TTS** — Sentence-level streaming with natural break aggregation
- **Interruption handling** — Robust barge-in detection and TTS cancellation
- **Speaker ID** — Azure-based speaker identification and greeting logic

### Planned (Tier 0–2)
- CORS restriction + auth enforcement on destructive endpoints
- HTTP connection pooling (singleton `httpx.AsyncClient` per bridge)
- Redis session persistence with `orjson`
- Letta agent ID cache invalidation on 404
- OpenTelemetry distributed tracing + Prometheus metrics
- LiteLLM semantic response caching

### Planned (Tier 3–4)
- Scheduler timezone (use `TIMEZONE` env var)
- Pydantic-typed tool registry with enable/disable enforcement
- Better sentence boundary detection (abbreviations, decimals)
- TypeScript socket event types + AudioWorklet refactor
- Skill overrides persisted in Redis

### Frontier (Tier 5)
- Kokoro-82M neural TTS evaluation (potential Kokoro replacement)
- MCP-compatible tool registry
- Local embeddings for semantic cache
- mTLS between internal microservices

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Network edge | UFW (ports 22/80/443 only), Fail2ban |
| TLS | Let's Encrypt via Certbot, nginx reverse proxy |
| Auth | JWT (access 1h, refresh 7d), bcrypt passwords |
| CORS | Origin restricted to `FRONTEND_URL` |
| Secrets | `.env` with `chmod 0600`, never committed |
| Data at rest | Memories never leave the server (Letta + Qdrant local) |
| Prompts | Audio and chat sent to Groq for processing (not stored per ToS) |

---

## Hardware Target

| Component | Spec |
|-----------|------|
| CPU | Intel Core i3-6100 (2c/4t @ 3.7 GHz) |
| RAM | 12 GB DDR3 |
| Storage | 2 TB HDD |
| GPU | None (CPU-only inference) |
| OS | Ubuntu Server 22.04 LTS |

Implications: all ML models use ONNX/quantized formats (Silero VAD 2MB, Vosk ~50MB, Kokoro ~20MB). Cloud APIs (Groq) handle heavy lifting.
