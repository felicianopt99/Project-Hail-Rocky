# Project Hail Rocky - API Endpoint Map

This document provides a comprehensive list of all HTTP and WebSocket endpoints in the Rocky system.

## Backend Service (Port 8000)

| Method | Path | Summary |
|--------|------|---------|
| **Auth** | | |
| POST | `/api/auth/login` | Authenticate user and return tokens. |
| POST | `/api/auth/logout` | Invalidate the current access token. |
| GET | `/api/auth/me` | Get current user profile. |
| POST | `/api/auth/refresh` | Refresh access token using refresh token. |
| **Brain** | | |
| POST | `/api/brain/chat` | Direct text-to-Rocky interface (streams response). |
| **Dashboard** | | |
| GET | `/api/dashboard/health` | Detailed health status of all system components. |
| GET | `/api/dashboard/metrics` | System performance metrics (latency, usage). |
| **Memory** | | |
| POST | `/api/memory/forget-all` | Irreversibly reset Rocky's memory. |
| GET | `/api/memory/profile` | Rocky's core memory blocks (persona + human profile). |
| GET | `/api/memory/recent` | Most recent archival memories. |
| GET | `/api/memory/search` | Semantic search across Rocky's archival memories. |
| **Skills** | | |
| GET | `/api/skills` | List all available and active skills. |
| GET | `/api/skills/{skill_id}/settings` | Get specific settings for a skill. |
| PUT | `/api/skills/{skill_id}/settings` | Update settings for a skill. |
| POST | `/api/skills/{skill_id}/test` | Manually trigger a skill for testing. |
| POST | `/api/skills/{skill_id}/toggle` | Enable or disable a skill. |
| **Speaker** | | |
| GET | `/api/speaker/profiles` | List all enrolled speaker profiles. |
| POST | `/api/speaker/profiles` | Create a new speaker profile. |
| DELETE | `/api/speaker/profiles/{id}` | Remove a speaker profile. |
| POST | `/api/speaker/profiles/{id}/enroll` | Enroll voice samples for a speaker. |
| **System** | | |
| GET | `/api/health` | Basic service health check. |
| GET | `/api/settings` | Return runtime configuration and service status. |
| POST | `/api/wakeword/trigger` | Manually trigger a wakeword event. |
| GET | `/api/docs` | Interactive OpenAPI documentation. |

---

## Voice Engine Service (Port 8881)

| Method | Path | Summary |
|--------|------|---------|
| WS | `/voice` | Main Pipecat WebSocket (Audio Stream + Interruption). |
| POST | `/synthesize` | Legacy text-to-speech HTTP endpoint (returns audio stream). |
| GET | `/health` | Voice engine status and model availability. |
| GET | `/docs` | OpenAPI documentation for voice engine. |
