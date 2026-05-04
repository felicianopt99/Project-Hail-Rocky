# Project Rocky 🛸

**A Privacy-First, Personality-Driven AI Smart Home Companion**

Project Rocky is a sophisticated, self-hosted AI assistant designed to live on your local hardware. Inspired by the engineer alien Rocky from Andy Weir's *Project Hail Mary*, this assistant combines advanced voice processing, long-term memory, and smart home integration into a single, cohesive experience.

![Portfolio Showcase](https://img.shields.io/badge/Focus-Privacy--First-blueviolet)
![Tech Stack](https://img.shields.io/badge/Stack-FastAPI%20%7C%20React%20%7C%20Pipecat-blue)
![Architecture](https://img.shields.io/badge/Architecture-Microservices-green)

---

## 🌟 Key Features

- **Immersive Personality**: Full implementation of Rocky's unique character, including emotional states, catching phrases, and evolving intimacy levels.
- **Real-Time Voice Pipeline**: Ultra-low latency voice interaction using Pipecat (VAD → STT → LLM → TTS).
- **Hierarchical Memory**: Powered by Letta (formerly MemGPT), allowing Rocky to remember past interactions, user preferences, and "learn" over time.
- **Smart Home Command**: Native integration with Home Assistant to control lights, appliances, and automated routines.
- **Cyberpunk UI**: A reactive, futuristic dashboard built with React 19 and Framer Motion, featuring real-time audio visualization.

## 🛠️ Technical Highlights

### Backend Architecture
- **FastAPI Core**: A high-performance Python backend leveraging asynchronous processing and Pydantic v2 for robust data validation.
- **Pipecat Integration**: Orchestrates the complex audio pipeline, handling everything from Silence Detection to Voice Effects (Pitch shifting, reverb).
- **LiteLLM Gateway**: Intelligent routing between multiple LLM providers (Groq, NVIDIA NIM, Gemini) with automated failover.

### Frontend Excellence
- **React 19 & TypeScript**: A modern, type-safe frontend architecture.
- **Reactive State**: Zustand-powered state management for seamless UI updates.
- **Real-time Communication**: Low-latency WebSocket integration via Socket.io for audio streaming and system events.

### Infrastructure
- **Dockerized Environment**: Fully containerized services with optimized profiles for different hardware capabilities.
- **Redis Caching**: High-speed state and session management.
- **Vector Database**: Semantic search capabilities for archival memory.

---

## 🏗️ System Architecture

Detailed technical documentation can be found in the [`docs/`](docs/) directory:
- [Technical Specification](docs/project_specification.md)
- [Architecture Deep Dive](docs/ARCHITECTURE.md)
- [Personality Design](docs/PERSONALITY.md)

---

## 🚀 Quick Start (Development)

1. **Environment Setup**:
   ```bash
   cp .env.example .env
   # Configure your API keys (Groq, etc.)
   ```

2. **Launch Services**:
   ```bash
   # Start the core stack
   docker compose up
   
   # Or use the Makefile for convenience
   make up
   ```

---

## 👤 Author

**Feli** - [GitHub](https://github.com/felicianopt99)

*This project was developed as a showcase of full-stack engineering, AI integration, and systems architecture.*
