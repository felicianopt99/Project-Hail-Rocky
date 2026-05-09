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
│  Backend  FastAPI + python-socketio + aiortc  (Python 3.13) │
│  ┌─────────────┐  ┌────    ┌─────▼──────┐   ┌─────▼──────┐   ┌────────────────────┐
    │  Pipecat   │   │   Letta    │   │  MCP Ecosystem     │
    │  Service   │   │  (memory)  │   │ (Dynamic Agency)   │
    │            │   │            │   │                    │
    │ VAD (VAD)  │   │ Core mem.  │   │ Home Assistant MCP │
    │ Groq STT   │   │ Recall     │   │ GitHub / Search MCP│
    │ CIL Layer  │   │ Archival   │   │ Python Sandbox (D) │
    │ Kokoro TTS │   │ (pgvector) │   │                    │
    └────────────┘   └────────────┘   └────────────────────┘
          │
    ┌─────▼──────┐   ┌────────────┐   ┌────────────────────┐
    │  LiteLLM   │   │   Valkey   │   │  Auto-Discovery    │
    │  Router    │   │            │   │  & Service Scan    │
    │            │   │  Sessions  │   │ (Ollama/Whisper)   │
    └────────────┘   └────────────┘   └────────────────────┘
```

---

## Voice Pipeline & Intelligence (CIL)

**Current state (WebRTC + Pipecat + CIL):**
```
Browser mic → WebRTC AudioTrack → Backend → Pipecat
  Pipecat: Silero VAD → Azure Speaker ID → Groq Whisper STT
         → CIL (Conversation Intelligence Layer): Backchannel vs Intent detection
         → RockyBrainProcessor (Hallucination filter & graph orchestration)
         → LiteLLM (Streaming tokens) → Natural Speech Pacing (Chunking)
         → Kokoro TTS → VoiceEffectsProcessor
         → WebRTC AudioTrack → Frontend
```

The **CIL** distinguishes between acknowledgments ("uh-huh", "ok") and actual interruptions. If a backchannel is detected while Rocky is speaking, the interruption is ignored. If a real intent is detected, Rocky issues a `CancelFrame` to stop the TTS and the current reasoning graph immediately.

---

## Tools & MCP (Model Context Protocol)

Rocky's capabilities are a hybrid of built-in functions and dynamic MCP skills:

| Category | Tool / Source | Description |
|----------|---------------|-------------|
| **Core** | `execute_python` | **Sandboxed:** Runs in an isolated Docker container with resource limits. |
| **MCP** | `Home Assistant` | Control IoT devices, read sensors, trigger scenes. |
| **MCP** | `Dynamic Registry`| Auto-discovered tools from servers configured in `mcp_config.json`. |
| **Built-in**| `get_weather` | Open-Meteo current forecast. |
| **Built-in**| `Wikipedia` | Summary lookup. |

### Isolated Sandbox (Option 1)
The `execute_python` tool utilizes a dedicated `rocky-sandbox` Docker image. The backend mounts the Docker socket to spawn these ephemeral containers, ensuring that untrusted code cannot access the host filesystem or network (`--network=none`).

---

## Roadmap

### Recently Completed
- **MCP Tool Registry** — Transitioned to Model Context Protocol for standardized tool discovery.
- **Smart Interruption (CIL)** — Implemented backchannel filtering and selective cancellation.
- **Isolated Code Sandbox** — Docker-based execution for Python tools.
- **Natural Speech Pacing** — Sentence grouping for better synthesis prosody.
- **Auto-Discovery** — Zero-config detection of local LLM and speech services.
are) |
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
| *(default)* | backend + frontend + valkey | Minimal — text chat only |
| `voice` | + voice_engine | Full voice pipeline |
| `letta` | + postgres (pgvector) + letta | Persistent memory |
| `ha` | + homeassistant + ha-mcp | Smart home control |
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
| Data at rest | Memories nunca saem do servidor (Letta + pgvector local) |
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
