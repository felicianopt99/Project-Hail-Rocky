# Task List - Project Hail Rocky Frontend Refactor

## Phase 1: Quick Wins (Foundation) ✅
- [x] **Setup Zustand**: Created `src/store/useRockyStore.ts` with FSM logic.
- [x] **Centralized Sockets**: Implemented `src/hooks/useRockySockets.ts` to manage all listeners.
- [x] **App Cleanup**: Removed prop-drilling and redundant state from `App.tsx`.
- [x] **Store Integration**: Refactored `MusicMode`, `CinemaMode`, and `SunsetMode` to use the store.

## Phase 2: Structural Refactor & Fluid UI ("Wow" Factor) 🏗️
- [x] **Organic Visualizer**: Hybrid rendering with Framer Motion (mood) + Canvas (audio data) + SVG Gooey Filter.
- [x] **Widget System**: Extracted rich content logic from `Chat.tsx` to `src/components/widgets/RichCard.tsx`.
- [x] **Neural Center**: Merged `ScenesMode` and `ProtocolsMode` into a unified command center.
- [x] **Design Refinement**: Upgraded `premium-glass` and glassmorphism utilities in `index.css`.
- [x] **Type Safety**: Verified all frontend files with `tsc`.

## Next Steps 🚀
- [x] Initial Research & Analysis
    - [x] Analyze `vision-agents` real-time orchestration patterns
    - [x] Map existing Rocky personality and system prompt
    - [x] Audit current service dependencies for removal

- [x] Infrastructure & Setup
    - [x] Create `backend/` directory structure
    - [x] Implement `backend/requirements.txt` and `backend/Dockerfile`
    - [x] Update `docker-compose.yml` with the new `rocky-backend` service

- [x] Python Backend Implementation
    - [x] Create `backend/main.py` with FastAPI and WebSocket endpoint
    - [x] Integrate `vision-agents` with Deepgram (STT/TTS) and NVIDIA NIM (LLM)
    - [x] Implement Rocky's Eridian persona in the Python orchestrator

- [x] Frontend & Bridge Refactoring
    - [x] Create `src/services/backendService.ts` for WebSocket communication
    - [x] Refactor `AudioProcessor.ts` to stream raw audio to the backend
    - [x] Update `server.ts` and `handlers.ts` to bridge client requests to the Python backend

- [x] Cleanup & Validation
    - [x] Systematically remove obsolete services (`vadService.ts`, `kokoroService.ts`, etc.)
    - [x] Remove unused dependencies from `package.json`
    - [x] Verify Docker Compose orchestration
