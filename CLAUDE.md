# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All operations assume Docker is running. The stack is backend + frontend + valkey (Redis-compatible, port 6381) + voice_engine + letta.

```bash
make up          # Start core stack (backend + frontend + valkey)
make letta       # + Letta memory server + Postgres + Qdrant
make ha          # + Home Assistant MCP bridge
make full        # Everything
make dev         # Hot-reload via docker watch
make down        # Stop all

make lint        # ruff (backend) + eslint (frontend)
make typecheck   # mypy (backend) + tsc (frontend)
make test        # pytest (backend) + vitest (frontend)
make check       # Live system health check via scripts/system_check.py
make logs        # Tail all container logs
```

Run a single backend test:
```bash
docker compose exec backend pytest tests/unit/test_tools_executor.py -v
```

Run a single frontend test:
```bash
cd frontend && npm test -- --run --reporter=verbose src/lib/utils/__tests__/parserUtils.test.ts
```

Generate a bcrypt hash for `ADMIN_PASSWORD_HASH`:
```bash
make hash-password
```

## Architecture

Rocky is a **voice-first conversational AI** with long-term memory and home automation agency. The character is an Eridanian alien from Andy Weir's *Project Hail Mary*.

### Services

```
frontend (React/Vite :5173)
    ↕ Socket.IO + WebRTC
backend (FastAPI/Granian :8000)
    ↕ WebSocket
voice_engine (Pipecat :8881)
    ↕ REST/SSE
letta (MemGPT memory server :8283)
    ↕ pub/sub
valkey (:6381)   ← Redis-compatible; redis:// URLs work unchanged
```

### Request Flow

A voice message travels: Browser mic → WebRTC/Socket.IO → `PipecatBridge` (`bridges/pipecat_bridge.py`) → Voice Engine WebSocket → Pipecat pipeline (`services/voice_engine/app/pipeline.py`) → STT (Groq Whisper) → `RockyBrainProcessor` → Backend `/api/brain` → `socketio_handlers._chat()` → tool calling or Letta/LiteLLM → TTS (Kokoro ONNX, local) → audio back to browser.

Text messages skip the voice engine and go directly to `socketio_handlers._chat()`.

### Backend (`backend/app/`)

- **`api/socketio_handlers.py`** — central dispatch: receives all `chat` events, detects emotional state, checks semantic cache, routes to tools or Letta/LiteLLM, streams TTS chunks. The `_chat()` function is the core decision pipeline.
- **`api/skills.py`** — exposes tools to the LLM; skill enable/disable state is persisted in Valkey (`rocky:skills:override:{name}`). Call `get_active_tools()` to get the filtered tool list.
- **`bridges/letta_bridge.py`** — all Letta REST calls. On startup it auto-registers the HA MCP server, syncs tools, and creates the agent if missing. `send_message_stream()` is preferred for real-time responses.
- **`bridges/pipecat_bridge.py`** — singleton that manages per-`sid` WebSocket sessions to the Voice Engine with auto-reconnect and exponential backoff.
- **`core/semantic_cache.py`** — Redis-VL semantic cache backed by a local HuggingFace model. Checked before every LLM call; bypassed when tools are invoked.
- **`tools/definitions.py`** + **`tools/executor.py`** — tool registry and execution. `CRITICAL_TOOLS` require human-in-the-loop confirmation. `execute_python` runs in a sandboxed subprocess (128 MB RAM, no fork, env-stripped). Dynamic tools are discovered from the HA MCP server at startup.
- **`workers/`** — SAQ cron jobs: `diary_writer` (nightly 23:00) and `pattern_analyzer` (Sunday 04:00) both call `letta_bridge.send_message()` to update Rocky's archival memory.
- **`rocky/personality/`** — emotional state detection (`emotional_states.detect()` is async, calls LiteLLM with 5-min TTL cache, falls back to keyword matching), intimacy scaling, speech modes, system prompt builder.

### LLM / Model Selection

`settings.get_llm_model()` resolves in priority order: explicit `LLM_MODEL` env var → `GROQ_API_KEY` (llama-3.3-70b-versatile) → `GEMINI_API_KEY` (gemini-2.0-flash) → `NVIDIA_API_KEY`. All LLM calls go through `litellm`.

Letta is optional (`LETTA_URL` env var). When available, it handles long-term memory; otherwise the backend falls back to stateless LiteLLM with session history.

### Voice Engine (`services/voice_engine/app/`)

Pipecat pipeline order (matters for interruption handling):
```
transport.input → VoiceDebug → InputLogger → GroqSTT → UserAggregator
→ RockyBrainProcessor → JsonMessageRelay → DisfluencyInjector
→ KokoroTTS → JsonMessageRelay → VoiceEffectsProcessor → ErrorRelay
→ transport.output → AssistantAggregator
```

`VoiceEffectsProcessor` applies per-emotion `PitchShift` + `Reverb`/`Compressor`/`Chorus` via Spotify Pedalboard. All boards use `reset=False` to preserve state across streaming frames.

### Frontend (`frontend/src/`)

React 18 + TypeScript + Vite with React Compiler enabled. State is managed by Zustand (`store/useRockyStore.ts`). The audio pipeline lives in `hooks/useAudioPipeline.ts` (WebRTC) and `hooks/useAudioManager.ts`. Socket.IO events are handled in `hooks/useRockySockets.ts`. Wake-word detection is `hooks/useWakeWord.ts` (Silero VAD via `@ricky0123/vad-web`).

### Key Env Vars

| Var | Purpose |
|-----|---------|
| `GROQ_API_KEY` | LLM + STT (Whisper via Groq) |
| `LETTA_URL` | Letta memory server (optional) |
| `VOICE_ENGINE_URL` | Pipecat service URL |
| `HA_MCP_URL` | Home Assistant MCP bridge |
| `REDIS_URL` | Valkey connection (default: `redis://rocky-valkey:6381`) |
| `SECRET_KEY` | JWT signing key |
| `ADMIN_PASSWORD_HASH` | bcrypt hash — generate with `make hash-password` |

### Testing Layout

```
tests/unit/          ← fast, no I/O (pytest)
tests/functional/    ← requires running backend
tests/integration/   ← voice stress tests
tests/quality/       ← LLM evaluation via deepeval
tests/benchmarks/    ← latency battery
```
