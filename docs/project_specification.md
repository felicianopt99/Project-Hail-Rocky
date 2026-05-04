# Project Rocky — Technical Specification
## Vision & Architecture Overview

Rocky is a privacy-first, self-hosted smart home companion inspired by the personality of Rocky from *Project Hail Mary*. This document outlines the technical architecture, design principles, and implementation details of the system.

---

📑 ÍNDICE EXECUTIVO
1. VISÃO GERAL
2. PRINCÍPIOS FUNDAMENTAIS
3. HARDWARE E INFRAESTRUTURA
4. FRONTEND EXISTENTE
5. DECISÃO ARQUITETURAL CRÍTICA
6. STACK COMPLETA
7. FRAMEWORKS PRINCIPAIS
8. MODELOS DE IA
9. ARQUITETURA DE SISTEMA
10. PIPELINE DE VOZ
11. SISTEMA MULTI-LLM
12. SISTEMA DE MEMÓRIA
13. SISTEMA DE SKILLS
14. AUTOMAÇÃO RESIDENCIAL
15. PERSONALIDADE DO ROCKY
16. SEGURANÇA E PRIVACIDADE
17. OTIMIZAÇÕES DE PERFORMANCE
18. ESTRUTURA DE PROJETO
19. COMUNICAÇÃO FRONTEND-BACKEND
20. CATÁLOGO DE SKILLS
21. MÉTRICAS DE SUCESSO
22. ROADMAP DETALHADO
23. RISCOS E MITIGAÇÕES
24. APÊNDICES
1. VISÃO GERAL
1.1 Missão
Construir um assistente residencial inteligente Project Hail Rocky que combina:

Personalidade imersiva do engenheiro alienígena Rocky do livro Project Hail Mary
Performance superior via integração de frameworks maduros open-source
Privacidade total com dados pessoais armazenados localmente e encriptados
Extensibilidade infinita através de sistema de skills plugável
Estética cyberpunk retrô-futurista coerente com a frontend existente
1.2 Diferencial Competitivo
Ao contrário de assistentes comerciais (Alexa, Google Home, Siri):

✅ Zero vendor lock-in — tudo open-source
✅ Zero custo recorrente — APIs gratuitas + hardware próprio
✅ Privacidade absoluta — memórias nunca saem de casa
✅ Personalidade única — Rocky como personagem vivo
✅ Extensibilidade sem limites — marketplace de 200+ skills + custom
✅ Interface imersiva — dashboard cyberpunk com visualizações reativas
1.3 Filosofia de Implementação
"Integrate, Don't Build. Orchestrate, Don't Reinvent."

Aproveitamos frameworks maduros que já resolveram problemas complexos (voz, memória, skills, LLM routing) e focamos exclusivamente no diferencial:

A personalidade do Rocky
A experiência de utilizador imersiva
A cola entre sistemas (bridges)
A identidade do produto
2. PRINCÍPIOS FUNDAMENTAIS
2.1 Princípios Técnicos
Princípio	Manifestação Prática
Privacy First	Memórias, áudio, logs — tudo local e encriptado (SQLCipher AES-256)
Cloud for Brains, Local for Identity	LLMs via API gratuita; personalidade e dados em casa
Open Source Only	Apenas FOSS, sem dependências proprietárias obrigatórias
Zero Recurring Cost	Free tiers de APIs públicas, sem subscriptions
Performance by Design	Bibliotecas em Rust/C++ por baixo, async everywhere, streaming always
Extensible by Default	Skills como cidadãos de primeira classe
Resilient	Funciona offline (modo degradado) se internet falhar
Testable	Pytest coverage >80% em lógica crítica
Documented	Docs vivas no repo, auto-geradas quando possível
2.2 Princípios de Produto
Princípio	Manifestação Prática
Imersão Temática	Cada interação reforça o universo de Project Hail Mary
Consistency is Canon	Rocky age sempre de forma coerente com a personalidade
Proactive, Not Reactive	Rocky toma iniciativa quando apropriado
Learn, Don't Spam	Memória inteligente; esquece o irrelevante
Human-Centric	Tecnologia serve a experiência, não o oposto
Delightful Details	Easter eggs, tons musicais, efeitos de voz — magia nos detalhes
3. HARDWARE E INFRAESTRUTURA
3.1 Servidor Base
Modelo: Dell Optiplex 3040
CPU: Intel Core i3-6100 (Skylake, 2 cores / 4 threads @ 3.7 GHz)
RAM: 12 GB DDR3
Armazenamento: 2 TB HDD (7200 RPM)
GPU: Intel HD Graphics 530 integrada (sem GPU dedicada)
Rede: Gigabit Ethernet (obrigatório; WiFi não recomendado para latência crítica)
3.2 Sistema Operacional
OS: Ubuntu Server 22.04 LTS
Kernel: 5.15+ (suporte completo a Docker, cgroups v2)
Init: systemd (para auto-start de serviços)
Firewall: UFW (Uncomplicated Firewall)
Fail2ban: proteção contra bruteforce SSH/HTTP
3.3 Implicações do Hardware
Limitação	Consequência	Mitigação
Sem GPU dedicada	LLMs locais >3B impossíveis	APIs gratuitas como primária; Ollama Phi-3-mini (3.8B quantizado) só fallback
CPU modesto	Whisper Large local = 3-5s latência	Groq Whisper API (~200ms) como primária; Vosk local fallback
12GB RAM	Limite de containers simultâneos	Alpine images, lazy loading de modelos, maxmemory Redis
HDD (não SSD)	I/O lento para vector DB	Cache agressivo em Redis (RAM), Qdrant optimized para HDD
3.4 Rede e Exposição
Rede local: 192.168.x.x/24 (subnet típica)
DNS dinâmico: DuckDNS (gratuito, atualiza IP público automaticamente)
Reverse proxy: Nginx (TLS termination, rate limiting)
TLS: Let's Encrypt via Certbot (renovação automática)
Portas expostas: 80 (HTTP → redirect 443), 443 (HTTPS)
Firewall: UFW bloqueia tudo exceto 22 (SSH, só rede local), 80, 443
3.5 Acesso Remoto
Opção escolhida: DuckDNS + Nginx + Let's Encrypt
Domínio: projecthailrocky.duckdns.org (a confirmar)
Autenticação obrigatória: Login JWT antes de qualquer acesso
Fail2ban: 5 tentativas falhadas = ban IP por 1 hora
4. FRONTEND EXISTENTE
4.1 Tecnologias Confirmadas
Framework: React 18+ com TypeScript 5+
Build tool: Vite (assumido, se não for Vite é CRA ou Next.js)
Estilização: Tailwind CSS
Animações: Framer Motion (Motion)
Ícones: Lucide React
Comunicação real-time: Socket.io-client
Áudio: Web Audio API via hook useAudioAnalyzer.ts
4.2 Estrutura Atual
text
frontend/
├── src/
│   ├── components/
│   │   ├── Dashboard.tsx
│   │   ├── Cinema.tsx
│   │   ├── Music.tsx
│   │   ├── Sunset.tsx
│   │   └── AudioVisualizer.tsx
│   ├── lib/
│   │   └── rockyService.ts       ← integração IA (atualmente Gemini direto)
│   ├── hooks/
│   │   └── useAudioAnalyzer.ts   ← Web Audio API
│   └── ...
└── server.ts                      ← Node.js Express + Socket.io (SERÁ REMOVIDO)
4.3 Estética Estabelecida
Tema: Cyberpunk retrô-futurista
Efeitos visuais: Scanlines CRT, glow, chromatic aberration
Paleta de cores: Preto (#000000, #0a0a0a) + Ciano (#00ffff, #00d9ff) + acentos roxo/magenta
Tipografia: Monospace (assumido, ex: JetBrains Mono, Fira Code, IBM Plex Mono)
Personalidade UI: Termos como "yes?", "human", fidelidade ao Rocky
4.4 Funcionalidades Atuais
Dashboard: métricas de sistema em tempo real
Visualizador de Áudio: reage ao microfone via FFT
Modos de Ambiente:
Cinema Mode (luzes dim, interface minimal)
Music Mode (visualizador destaque)
Sunset Mode (transição de luzes)
Chat AI: conversa com Rocky via Gemini API
4.5 Adições Necessárias (Mínimas)
Avatar do Rocky: componente SVG/Canvas geométrico reativo a estado emocional
Novas páginas:
/skills — gerir skills (toggle on/off, settings)
/memories — explorar memórias do Rocky (busca semântica)
/settings — configurações gerais, quotas de API, "esquecer tudo"
/stats — Year in Review, estatísticas de uso
Tabs reorganizáveis no Dashboard (drag-and-drop via dnd-kit)
Widgets dinâmicos de skills (cada skill pode contribuir um widget)
PWA: manifest.json + service worker (instalável como app)
Vista terminal alternativa: toggle entre chat moderno e estilo terminal
4.6 Compatibilidade Garantida
Socket.io-client: python-socketio é 100% compatível com protocolo Socket.io
REST API: HTTP normal, sem mudanças
Eventos: mesma estrutura, novos tipos de eventos adicionados
Autenticação: JWT via header ou cookie (transparente para cliente)
5. DECISÃO ARQUITETURAL CRÍTICA
5.1 Opção A — Confirmada e Aprovada
Substituição completa do backend Node.js por Python

Sai
server.ts (Node.js + Express + Socket.io server)
Dependência @google/genai no frontend
Entra
FastAPI (Python 3.11) + Granian (ASGI server Rust)
python-socketio (compatível com Socket.io-client existente)
Nginx serve frontend build estático (liberta backend para IA)
Justificação
Ecossistema unificado: Pipecat, Letta, OVOS, LiteLLM são todos Python
Performance: Granian (Rust) + uvloop + orjson = mais rápido que Node.js
Maturidade IA: bibliotecas Python para ML/IA >5 anos à frente de JS/TS
Compatibilidade total: cliente Socket.io não nota diferença
6. STACK COMPLETA
6.1 Backend Core
Categoria	Tecnologia	Versão	Licença	Justificação
Linguagem	Python	3.11	PSF	Ecossistema IA líder
Web framework	FastAPI	0.109+	MIT	Async nativo, auto-docs, validação Pydantic
ASGI server	Granian	1.0+	BSD	Rust-based, 2-3x mais rápido que Uvicorn
WebSocket	python-socketio	5.11+	MIT	Compatível com Socket.io-client
Event loop	uvloop	0.19+	MIT/Apache	libuv-based, 2-4x mais rápido que asyncio default
JSON	orjson	3.9+	MIT/Apache	Rust-based, 5-10x mais rápido que json stdlib
HTTP client	httpx	0.26+	BSD	Async, HTTP/2, connection pooling
Validação	Pydantic	2.5+	MIT	Core em Rust, 5-50x mais rápido que v1
ORM	SQLAlchemy	2.0+	MIT	Async, mature, extensível
DB driver (Postgres)	asyncpg	0.29+	Apache	3-5x mais rápido que psycopg2
Settings	pydantic-settings	2.1+	MIT	.env tipado e validado
Logs	structlog	24.1+	MIT/Apache	Logs estruturados em JSON
Scheduler	APScheduler	3.10+	MIT	Jobs agendados (diary, pattern detection)
Auth	FastAPI-Users	12.1+	MIT	JWT + bcrypt, battle-tested
6.2 Frameworks de IA (Principais)
Framework	Versão	Licença	Função
Pipecat	0.0.45+	MIT	Pipeline de voz (VAD → STT → LLM → TTS + voice effects)
LiteLLM	1.30+	MIT	Gateway universal para 100+ providers LLM + semantic cache
Letta (ex-MemGPT)	0.3.5+	Apache 2.0	Memória hierárquica auto-gerida + stateful agents
pedalboard	0.7+	GPL-3.0	Voice effects (pitch shift, reverb, compression por Spotify)
sentence-transformers	2.3+	Apache 2.0	Embeddings (ou fastembed ONNX para performance)
opentelemetry-distro	0.48+	Apache 2.0	Distributed tracing + Prometheus metrics
[REMOVIDO] OVOS	—	—	Substituído por LLM tool calling nativo (ver secção 13)
6.3 Modelos de ML/IA
Função	Modelo	Formato	Tamanho	Onde Roda
STT online	Whisper Large v3	API (Groq)	—	Cloud
STT offline	Vosk small PT/EN	ONNX	~50MB	CPU local
TTS	Kokoro (voz custom Rocky)	ONNX	~20MB	CPU local
Wake word	openWakeWord custom "Hey Rocky"	ONNX	~10MB	CPU local
VAD	Silero VAD v4	ONNX	~2MB	CPU local
Speaker ID	SpeechBrain ECAPA-TDNN	PyTorch/ONNX	~15MB	CPU local
Embeddings	BAAI/bge-m3	ONNX (fastembed)	~560MB	CPU local
LLM online rápido	Llama 3.3 70B Versatile	API (Groq)	—	Cloud
LLM online qualidade	Llama 3.1 70B Instruct	API (NVIDIA NIM)	—	Cloud
LLM multimodal	Gemini 2.0 Flash	API (Google)	—	Cloud
LLM offline	Phi-3-mini 3.8B Q4	GGUF (Ollama)	~2.3GB	CPU local
6.4 Dados e Cache
Tecnologia	Versão	Uso	Configuração
Redis	7.2+	Cache, sessões, pub/sub, quota tracking LLM	maxmemory 512MB, LRU eviction
Qdrant	1.7+	Vector DB (memória archival do Letta)	Optimized para HDD, cache em RAM
PostgreSQL	16+	Backend do Letta (agents, messages)	TimescaleDB extension opcional
SQLCipher	4.5+	Logs encriptados (AES-256)	Derivação de key via PBKDF2
6.5 Automação Residencial
Tecnologia	Versão	Função
Home Assistant	2024.5+	Hub central (2000+ integrações devices)
Mosquitto	2.0+	MQTT broker
Wyoming Protocol	1.5+	Descoberta automática de serviços de voz
6.6 Infraestrutura
Tecnologia	Versão	Função
Docker	24.0+	Containerização
Docker Compose	2.24+	Orquestração multi-container
Nginx	1.24+ (Alpine)	Reverse proxy, TLS, servir frontend estático
Certbot	2.8+	Renovação automática TLS (Let's Encrypt)
UFW	0.36+	Firewall
Fail2ban	1.0+	Proteção anti-bruteforce
Glances	3.4+	Monitorização leve do sistema
systemd	—	Auto-start no boot
6.7 APIs Externas Gratuitas
Serviço	Provider	Free Tier	Uso
LLM rápido	Groq	Generoso (sem limite público, fair use)	Default conversação
LLM qualidade	NVIDIA NIM	1000 req/mês	Raciocínio complexo
LLM multimodal	Google Gemini	1500 req/dia	Imagens, documentos
STT	Groq Whisper	Incluído no tier Groq	Speech-to-text
Clima	Open-Meteo	Ilimitado	Temperatura, precipitação, vento
Qualidade ar	Open-Meteo AQ	Ilimitado	PM2.5, PM10, NO2, O3
Calendário	Google Calendar	Ilimitado (OAuth)	Lembretes, eventos
Notícias	RSS Feeds	Ilimitado	Público, RTP, BBC
Pesquisa	DuckDuckGo Instant Answer	Ilimitado	Factos, Wikipedia
6.8 DevOps e Qualidade
Categoria	Ferramenta
Testes	pytest, pytest-asyncio, pytest-mock
Linting	ruff (Rust-based, substitui flake8+isort+pyupgrade)
Formatting	black
Type checking	mypy
Pre-commit hooks	pre-commit
Dependency management	uv (Rust-based, 10-100x mais rápido que pip)
7. FRAMEWORKS PRINCIPAIS
7.1 Pipecat — Voice AI Pipeline
Repositório: https://github.com/daily-co/pipecat
Mantido por: Daily.co
Licença: MIT
Linguagem: Python

O Que Resolve
Pipeline completo de voz conversacional:

Captura de áudio (WebSocket, WebRTC, telefone)
Voice Activity Detection (VAD)
Speech-to-Text (Groq, Deepgram, Whisper, Azure)
LLM streaming (OpenAI, Anthropic, Gemini, Together, Groq, Ollama)
Text-to-Speech (ElevenLabs, Cartesia, Kokoro, Azure, OpenAI)
Barge-in (interrupção natural)
Function calling integrado
Arquitetura
Frame-based: tudo são Frames (AudioFrame, TextFrame, LLMFrame)
Processors: cada componente é um FrameProcessor
Pipeline: chain de processors configurável
Transports: WebSocket, WebRTC (LiveKit, Daily), Twilio, etc.
Extensibilidade
Podemos criar Processors custom para:

Injetar personalidade (modify prompts em runtime)
Aplicar efeitos de voz (pedalboard)
Fazer speaker identification
Adicionar disfluências ("hmm", pauses)
Log/analytics
Providers Suportados Nativamente
STT: Groq Whisper, Deepgram, AssemblyAI, Azure
LLM: OpenAI, Anthropic, Gemini, Together, Groq, Ollama, OpenRouter, vLLM
TTS: ElevenLabs, Cartesia, Kokoro, Azure, OpenAI, Deepgram
Transport: LiveKit, Daily, WebSocket, Twilio
Performance
Latência fim-a-fim: 400-800ms (online) com Groq STT + LLM + ElevenLabs/Cartesia
Com Kokoro TTS (local): 600-1000ms
7.2 LiteLLM — Universal LLM Gateway
Repositório: https://github.com/BerriAI/litellm
Mantido por: BerriAI
Licença: MIT
Linguagem: Python

O Que Resolve
Interface única (OpenAI-compatible) para 100+ providers:

Groq, NVIDIA NIM, Gemini, Anthropic, Cohere, Together, OpenRouter, Ollama, vLLM, LocalAI, HuggingFace, Azure, AWS Bedrock, etc.
Fallback automático entre providers
Rate limiting e quota tracking
Cost tracking (mesmo grátis)
Caching (Redis, in-memory)
Load balancing
Retry logic
Configuração Declarativa
Toda a estratégia multi-LLM vive em YAML:

yaml
model_list:
  - model_name: rocky-fast
    litellm_params:
      model: groq/llama-3.3-70b-versatile
  - model_name: rocky-smart
    litellm_params:
      model: nvidia_nim/meta/llama-3.1-70b-instruct
  - model_name: rocky-vision
    litellm_params:
      model: gemini/gemini-2.0-flash-exp
  - model_name: rocky-offline
    litellm_params:
      model: ollama/phi3:mini

router_settings:
  fallbacks:
    - rocky-fast: [rocky-smart, rocky-vision, rocky-offline]
  num_retries: 3
Deployment
Proxy mode: servidor standalone (Docker)
SDK mode: importar como biblioteca Python
Usamos proxy mode para centralização.

Vantagens Para Nós
Trocar provider = 1 linha de YAML
Adicionar Gemini ao mix = 3 linhas de YAML
Quota tracking automático em Redis
Cache de respostas repetidas (economiza requests)
7.3 Letta (ex-MemGPT) — Memory & Agents
Repositório: https://github.com/cpacker/MemGPT
Mantido por: Letta Labs
Licença: Apache 2.0
Linguagem: Python

O Que Resolve
Agentes com memória hierárquica auto-gerida:

Core Memory: sempre no contexto (editável pelo agente)
Recall Memory: conversas recentes (busca textual)
Archival Memory: vector DB (busca semântica)
Sleep-time compute: agente processa memórias em background
Self-editing: agente decide o que guardar/esquecer
Arquitetura
Backend: Postgres (mensagens) + Vector DB (Qdrant, pgvector, Chroma)
API REST + Python SDK
Agents têm personas, tools, memory blocks
Suporta múltiplos LLMs (via LiteLLM)
Como Usamos
Rocky é um Letta agent
Persona = system prompt completo do Rocky
Core memory "Human" = perfil do utilizador (atualizado pelo agente)
Archival memory = memórias importantes (decididas pelo agente via importance scoring)
Sleep-time jobs: consolidação de memórias, pattern detection
Vantagens
Não construímos classificador de importância (Letta já faz)
Não construímos sistema de blocos de memória (Letta já tem)
Auto-summarization de conversas longas
API para busca semântica em memórias (página Memories do frontend)
7.4 LLM Tool Calling — Sistema de Capabilities
[SUBSTITUIU OVOS — ver Decision Log]

O Que Resolve
As capabilities do Rocky (timer, clima, luzes, etc.) são expostas como
tools no formato OpenAI function calling. O LLM decide via raciocínio
natural quando e como chamar cada tool — sem intent parser separado.

Vantagens vs. OVOS
Sem 2 containers extra (ovos-core + ovos-messagebus).
Zero configuração de intents/locale files.
Multi-língua nativo — o LLM entende "timer de 5 minutos", "set a 5
  minute timer", "minuterie 5 minutes" sem modelos separados.
Mais extensível — adicionar capability = 1 função Python + schema JSON.
Contexto rico — o LLM pode combinar tools ("acende as luzes e bota um
  timer de 10 minutos").

Arquitetura
backend/app/tools/definitions.py — schemas JSON (OpenAI format)
backend/app/tools/executor.py    — dispatch e implementações
backend/app/tools/registry.py    — Pydantic registry com enable/disable
backend/app/api/skills.py        — REST API para frontend Skills page

Tools Disponíveis
get_datetime     — data/hora atual (timezone-aware)
set_timer        — timer countdown com label
get_weather      — clima + previsão via Open-Meteo (sem API key)
search_wikipedia — resumos Wikipedia
calculate        — safe math eval (AST-based)
control_lights   — ligar/desligar/brilho/cor via Home Assistant
activate_scene   — ativar scene do Home Assistant

Extensibilidade
Adicionar uma nova tool:
1. Definir schema em definitions.py
2. Adicionar case em executor.py
3. Metadata em _TOOL_META em skills.py

## 8. Considerações de Interoperabilidade

- **Protocolo Unificado**: Uso de padrões abertos (JSON-RPC/WebSockets) para garantir que as ferramentas sejam interoperáveis com outros sistemas e agentes inteligentes de forma agnóstica.
7.5 Home Assistant — Smart Home Hub
Site: https://www.home-assistant.io
Repositório: https://github.com/home-assistant/core
Mantido por: Nabu Casa + comunidade
Licença: Apache 2.0
Linguagem: Python

O Que Resolve
Hub central de automação residencial:

2000+ integrações para devices (Philips Hue, Xiaomi, Tuya, Sonoff, Zigbee, Z-Wave, Matter, etc.)
Areas/Zones: organização semântica de devices
Scenes: estados pré-configurados (ex: "Cinema")
Automations: triggers + conditions + actions
Wyoming Protocol: voz como serviço de rede
HACS: community store para integrações extras
API REST + WebSocket bem documentadas
Como Usamos
Home Assistant como executor universal de ações físicas
Rocky nunca fala diretamente com devices — pede ao HA
Skill OVOS lights faz REST calls para HA REST API
Skill OVOS scenes ativa cenas do HA
Sensores virtuais (clima, ar, calendário) configurados no HA
Integrações Relevantes Para Nós
Philips Hue / Xiaomi Yeelight / Tuya (lâmpadas)
MQTT (devices DIY via Mosquitto)
Open-Meteo (clima)
AirVisual ou Open-Meteo Air Quality
Google Calendar
RSS Feed Reader
System Monitor (CPU, RAM, disco do próprio servidor)
Vantagens
Não construímos integrações para devices (HA tem 2000+)
Interface web bonita para configurar devices
Automações complexas sem código
8. MODELOS DE IA
8.1 LLMs (Large Language Models)
Online — Groq (Default Rápido)
Modelo: llama-3.3-70b-versatile
Provider: Groq
Velocidade: ~300 tokens/s (ultra-rápido, GroqChip)
Contexto: 32k tokens
Free tier: Generoso (sem limite público documentado, fair use)
Uso: Conversação casual, respostas rápidas, majority of traffic
Online — NVIDIA NIM (Qualidade)
Modelo: meta/llama-3.1-70b-instruct
Provider: NVIDIA AI Foundation (build.nvidia.com)
Velocidade: ~100 tokens/s
Contexto: 128k tokens
Free tier: 1000 requests/mês
Uso: Raciocínio complexo, análise profunda, tarefas críticas
Online — Gemini (Multimodal)
Modelo: gemini-2.0-flash-exp
Provider: Google AI Studio
Velocidade: ~150 tokens/s
Contexto: 1M tokens
Multimodal: Texto + imagens + PDFs + vídeo
Free tier: 1500 requests/dia
Uso: Quando há imagens, análise de screenshots, visão
Offline — Ollama (Fallback)
Modelo: phi3:mini-4k-instruct-q4_K_M
Params: 3.8B quantizado INT4
Tamanho: ~2.3GB
Velocidade: ~15-20 tokens/s em CPU i3
Contexto: 4k tokens
Uso: Quando internet cai, modo offline absoluto
8.2 Speech-to-Text (STT)
Online — Groq Whisper (Primary)
Modelo: whisper-large-v3
Provider: Groq
Latência: ~150-250ms (incluindo network)
Qualidade: Estado da arte (OpenAI Whisper)
Línguas: 99 línguas (PT-BR, PT-PT, EN, FR nativos)
Free tier: Incluído no tier Groq
Uso: Default para transcrição
Offline — Vosk (Fallback)
Modelos:
vosk-model-small-pt-0.3 (~50MB, português)
vosk-model-small-en-us-0.15 (~40MB, inglês)
vosk-model-small-fr-0.22 (~41MB, francês)
Latência: ~500-800ms em CPU i3
Qualidade: Boa (WER ~10-15%)
Uso: Quando internet cai
8.3 Text-to-Speech (TTS)
Kokoro (Local, CPU-friendly)
Modelo base: voice pré-treinada + fine-tune custom "Rocky"
Formato: ONNX
Tamanho: ~20MB
Latência: ~200-400ms por frase curta em CPU i3
Qualidade: Natural (melhor que eSpeak, próximo de cloud TTS)
Línguas: PT-BR, PT-PT, EN, FR (modelos separados)
Customização: Treinámos voz "Rocky" com 30min de samples + pitch shift +2 semitons
Efeitos de Voz (Pedalboard)
Biblioteca: Spotify pedalboard (Python wrapper de C++)
Efeitos aplicados:
Pitch shift: +2 semitons (voz mais "alien")
Reverb: plate reverb leve (sensação de "outro espaço")
EQ: boost em 2-4kHz ("metálico" subtil)
Compressor dinâmico: consistência de volume
Adaptação emocional:
Excited: +3 semitons, speed 1.1x
Tired: -1 semitom, speed 0.85x
Curious: pitch variation dentro da frase
8.4 Wake Word Detection
openWakeWord (Custom "Hey Rocky")
Modelo: treinado custom com ~50 samples
Formato: ONNX
Tamanho: ~10MB
Latência: <100ms
False positive rate: <1% (após tuning threshold)
Uso: Detecta "Hey Rocky" para ativar escuta
8.5 Voice Activity Detection (VAD)
Silero VAD v4
Modelo: silero_vad.onnx
Tamanho: ~2MB
Latência: <50ms
Uso: Detecta início/fim de fala, evita processar silêncio
8.6 Speaker Identification
SpeechBrain ECAPA-TDNN
Modelo: spkrec-ecapa-voxceleb
Formato: PyTorch (convertível para ONNX)
Tamanho: ~15MB
Uso: Identifica quem está a falar (multi-utilizador)
Enrollment: 30 segundos de áudio por pessoa
Accuracy: >95% em condições normais
8.7 Embeddings (Memória Vectorial)
BAAI/bge-m3 (via fastembed ONNX)
Modelo: BAAI/bge-m3
Formato: ONNX (via fastembed)
Tamanho: ~560MB
Dimensões: 1024
Línguas: Multilíngue (PT/EN/FR excelente)
Velocidade: ~100-200 textos/s em CPU i3 (vs ~20/s em PyTorch)
Uso: Embeddings para Qdrant (memória archival)
9. ARQUITETURA DE SISTEMA
9.1 Diagrama de Camadas
text
┌────────────────────────────────────────────────────────────────────┐
│                      CAMADA DE APRESENTAÇÃO                         │
│  Frontend React + TS (Socket.io-client, Web Audio API, Tailwind)   │
│            Servida estaticamente por Nginx após build               │
└────────────────────────────┬───────────────────────────────────────┘
                             │
                             │ Socket.io (eventos real-time)
                             │ REST API (HTTPS)
                             │
┌────────────────────────────▼───────────────────────────────────────┐
│                         CAMADA DE EDGE                              │
│  Nginx (reverse proxy, TLS termination, rate limiting, cache)      │
│  DuckDNS (DNS dinâmico), Let's Encrypt (TLS auto-renew)            │
│  UFW (firewall), Fail2ban (anti-bruteforce)                        │
└────────────────────────────┬───────────────────────────────────────┘
                             │
┌────────────────────────────▼───────────────────────────────────────┐
│                      CAMADA DE API GATEWAY                          │
│        FastAPI + Granian (substitui server.ts Node.js)             │
│  • python-socketio (compatível com Socket.io-client)               │
│  • REST endpoints (auth, dashboard, skills, memory, settings)      │
│  • JWT auth (FastAPI-Users)                                        │
│  • Request validation (Pydantic v2)                                │
└──┬────────────┬────────────┬────────────┬────────────┬────────────┘
   │            │            │            │            │
   │ gRPC/HTTP  │            │            │            │ HTTP
   ▼            ▼            ▼            ▼            ▼
┌─────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐ ┌──────────────┐
│Pipecat  │ │ Letta  │ │  OVOS   │ │ LiteLLM  │ │Home Assistant│
│Service  │ │ Server │ │  Core   │ │  Proxy   │ │   (Docker)   │
│         │ │        │ │         │ │          │ │              │
│VAD→STT  │ │Memory  │ │Skills   │ │LLM Router│ │2000+ devices │
│→LLM→TTS │ │Agents  │ │Intent   │ │Fallback  │ │Scenes/Auto   │
└────┬────┘ └───┬────┘ └────┬────┘ └────┬─────┘ └──────┬───────┘
     │          │           │           │              │
     │          │           │           │              │
┌────▼──────────▼───────────▼───────────▼──────────────▼──────────┐
│                  CAMADA DE DADOS E CACHE                          │
│  Redis (cache, sessões, pub/sub, quota tracking)                 │
│  Qdrant (vector DB, archival memory)                             │
│  Postgres (Letta backend)                                        │
│  SQLCipher (logs encriptados)                                    │
│  Mosquitto (MQTT broker para IoT devices)                        │
└───────────────────────────────────────────────────────────────────┘
9.2 Fluxo de Uma Interação por Voz
text
1. FRONTEND captura áudio via MediaRecorder API
   ↓ chunks PCM 16kHz via Socket.io
   
2. PIPECAT SERVICE recebe stream
   ↓ Silero VAD detecta fala
   ↓ [opcional] Wake word detection "Hey Rocky"
   ↓ SpeakerID identifica utilizador
   ↓ Groq Whisper transcreve → texto
   
3. TEXTO vai para ROCKY BRAIN (Letta agent)
   ↓ Letta busca contexto em memória (Qdrant)
   ↓ Letta chama LiteLLM com prompt enriquecido
   
4. LITELLM roteia para Groq (ou NIM/Gemini/Ollama)
   ↓ Streaming de tokens (evento por evento)
   
5. PIPECAT recebe tokens streaming
   ↓ Sentence aggregator junta em frases
   ↓ Kokoro TTS sintetiza cada frase
   ↓ Pedalboard aplica efeitos alien
   
6. ÁUDIO vai para FRONTEND via Socket.io chunks
   ↓ Web Audio API reproduz
   ↓ useAudioAnalyzer alimenta visualizador
   ↓ Avatar reage ao estado emocional do Rocky
Latência total esperada: 400-800ms (do fim da fala até início da resposta)

9.3 Fluxo de Uma Skill Execution
text
1. UTILIZADOR diz: "Rocky, timer for 5 minutes"
   
2. PIPECAT transcreve → "timer for 5 minutes"
   
3. LETTA AGENT recebe texto
   ↓ Detecta que é intent de skill (não conversação pura)
   ↓ Publica no OVOS message bus via bridge
   
4. OVOS CORE
   ↓ Padatious/Adapt parseia intent → "TimerSkill"
   ↓ Extrai parâmetros → duration=300s
   ↓ Carrega skill `ovos-skill-timer`
   ↓ Skill executa: agenda timer em APScheduler
   
5. SKILL retorna resultado → "Timer set for 5 minutes"
   
6. OVOS envia resposta de volta via message bus
   
7. LETTA recebe resultado
   ↓ Formula resposta final com personalidade Rocky:
     "Good, human. Rocky remember. Five minutes. Will tell."
   
8. Resposta vai para PIPECAT → TTS → FRONTEND
9.4 Containers Docker
Container	Imagem Base	Função	CPU Limit	RAM Limit
nginx	nginx:alpine	Reverse proxy + serve frontend	0.5	256MB
rocky-api	python:3.11-slim	FastAPI + Granian gateway	1.0	1GB
pipecat	Custom (Dockerfile)	Pipeline de voz	1.5	1.5GB
litellm	ghcr.io/berriai/litellm	LLM router	0.5	512MB
letta	letta/letta	Memória + agents	1.0	1GB
ovos-core	smartgic/ovos-core	Skills engine	0.5	512MB
ovos-messagebus	smartgic/ovos-messagebus	Message bus	0.2	128MB
homeassistant	ghcr.io/home-assistant/home-assistant	Smart home hub	1.0	1GB
redis	redis:7-alpine	Cache + pub/sub	0.5	512MB
qdrant	qdrant/qdrant	Vector DB	0.5	512MB
postgres	postgres:16-alpine	Letta backend	0.5	512MB
mosquitto	eclipse-mosquitto	MQTT broker	0.2	128MB
ollama	ollama/ollama	LLM offline	2.0	3GB
glances	nicolargo/glances	Monitorização	0.2	256MB
Total RAM em uso ativo: ~8GB (dentro do limite de 12GB com margem)

10. PIPELINE DE VOZ
10.1 Arquitetura Pipecat
Pipecat usa frame-based architecture. Tudo flui como Frames entre Processors.

Tipos de Frames
AudioRawFrame: áudio PCM raw
TranscriptionFrame: texto transcrito
LLMMessagesFrame: mensagens para LLM
TextFrame: texto para TTS
TTSAudioRawFrame: áudio sintetizado
UserStartedSpeakingFrame, UserStoppedSpeakingFrame: VAD events
FunctionCallFrame: tool/skill invocation
Pipeline Rocky
text
[WebSocket Input]
    ↓
[Silero VAD Processor]
    ↓ UserStartedSpeakingFrame
[Wake Word Processor] (opcional, filtro)
    ↓ se "Hey Rocky" detectado
[Speaker ID Processor] (custom)
    ↓ TranscriptionFrame + speaker_id metadata
[Groq STT Service]
    ↓ TranscriptionFrame
[Personality Injector] (custom)
    ↓ modifica prompt baseado em emotional_state
[Letta Bridge Processor] (custom)
    ↓ envia para Letta, recebe contexto enriquecido
[LiteLLM Service]
    ↓ streaming LLMResponseFrame
[Sentence Aggregator]
    ↓ TextFrame (frases completas)
[Disfluency Injector] (custom)
    ↓ adiciona "hmm" em respostas longas
[Kokoro TTS Service]
    ↓ TTSAudioRawFrame
[Voice Effects Processor] (custom, pedalboard)
    ↓ TTSAudioRawFrame modificado
[WebSocket Output]
10.2 Processors Custom
Construímos os seguintes FrameProcessors custom:

SpeakerIDProcessor
Recebe AudioRawFrame
Extrai embedding com SpeechBrain ECAPA-TDNN
Compara com embeddings armazenados (enrollments)
Adiciona speaker_id ao metadata da frame
Passa frame adiante inalterada
PersonalityInjector
Recebe LLMMessagesFrame
Lê emotional_state do contexto global (Redis)
Modifica system message:
Se excited: adiciona "You are particularly energetic right now."
Se tired: adiciona "You are sleepy. Keep responses brief."
Se curious: adiciona "You are very curious. Ask follow-up questions."
Adiciona catchphrases relevantes ao contexto
Passa frame modificada
DisfluencyInjector
Recebe TextFrame
Se texto >100 chars, injeta "hmm" ou "let me think" em pontos naturais
Usa heurísticas (após vírgulas, antes de conjunções)
Passa frame modificada
VoiceEffectsProcessor
Recebe TTSAudioRawFrame
Carrega áudio em numpy array
Aplica pedalboard:
PitchShift(semitones=+2) (base)
Se emotional_state == excited: semitones=+3, speed 1.1x
Se emotional_state == tired: semitones=-1, speed 0.85x
Reverb(room_size=0.3) leve
Compressor(threshold_db=-20)
Converte de volta para AudioRawFrame
Passa frame modificada
LettaBridgeProcessor
Recebe TranscriptionFrame
Extrai texto + speaker_id
Chama Letta API: agent.send_message(text, user_id=speaker_id)
Letta retorna resposta + função calls (se houver)
Se função call → emite FunctionCallFrame (para OVOS)
Se texto → cria LLMMessagesFrame com resposta Letta
Passa frame
10.3 Barge-in (Interrupção)
Pipecat suporta barge-in nativo:

UserStartedSpeakingFrame é emitido pelo VAD
Pipecat automaticamente:
Para TTS a meio
Limpa buffer de áudio pendente
Inicia nova transcrição
Não precisamos implementar nada, já funciona.
10.4 Transport: WebSocket vs WebRTC
Opção 1: WebSocket (Socket.io) — ESCOLHIDA
Latência: 50-100ms adicional vs WebRTC
Setup: Simples, compatível com cliente Socket.io existente
Prós: Já funciona, código menos, sem LiveKit server
Contras: Latência ligeiramente superior
Opção 2: WebRTC (LiveKit) — Fase 8 Opcional
Latência: 20-50ms (sub-100ms total)
Setup: LiveKit server em Docker, cliente LiveKit no frontend
Prós: Latência mínima, echo cancellation built-in
Contras: Camada adicional, cliente frontend precisa trocar de Socket.io para LiveKit SDK
Decisão: Começar com WebSocket, migrar para LiveKit na Fase 8 se latência não satisfizer.

11. SISTEMA MULTI-LLM
11.1 Estratégia de Roteamento
LiteLLM gere roteamento automático baseado em:

Modelo solicitado explicitamente (rocky-fast, rocky-smart, rocky-vision, rocky-offline)
Fallback automático se provider falha ou quota esgota
Cache para respostas repetidas
11.2 Configuração LiteLLM (litellm.yaml)
yaml
model_list:
  # Default: Groq Llama 3.3 70B (conversação rápida)
  - model_name: rocky-fast
    litellm_params:
      model: groq/llama-3.3-70b-versatile
      api_key: os.environ/GROQ_API_KEY
      max_tokens: 2048
      temperature: 0.7
  
  # Raciocínio: NVIDIA NIM Llama 3.1 70B
  - model_name: rocky-smart
    litellm_params:
      model: nvidia_nim/meta/llama-3.1-70b-instruct
      api_base: https://integrate.api.nvidia.com/v1
      api_key: os.environ/NVIDIA_API_KEY
      max_tokens: 4096
      temperature: 0.6
  
  # Multimodal: Gemini Flash 2.0
  - model_name: rocky-vision
    litellm_params:
      model: gemini/gemini-2.0-flash-exp
      api_key: os.environ/GEMINI_API_KEY
      max_tokens: 8192
      temperature: 0.7
  
  # Offline: Ollama Phi-3-mini
  - model_name: rocky-offline
    litellm_params:
      model: ollama/phi3:mini
      api_base: http://ollama:11434
      max_tokens: 1024
      temperature: 0.8

router_settings:
  routing_strategy: least-busy  # ou usage-based-routing
  fallbacks:
    - rocky-fast: [rocky-smart, rocky-vision, rocky-offline]
    - rocky-smart: [rocky-fast, rocky-vision, rocky-offline]
    - rocky-vision: [rocky-fast, rocky-offline]
  num_retries: 3
  retry_after: 2  # segundos
  cooldown_time: 30  # segundos antes de retry provider falhado

litellm_settings:
  set_verbose: false
  cache: true
  cache_params:
    type: redis
    host: redis
    port: 6379
    ttl: 3600  # 1 hora
  
  success_callback: ["langfuse"]  # analytics opcional
  failure_callback: ["sentry"]    # error tracking opcional
  
  # Quota tracking
  budget_manager:
    - user_id: default
      max_budget: 1000  # requests/mês (só tracking, não enforcing)
11.3 Decisão de Roteamento em Runtime
Quem decide qual modelo usar?

Pipecat (conversação fluída): pede rocky-fast (Groq)
OVOS skill complexa: pede rocky-smart (NIM)
Letta agent com imagem: pede rocky-vision (Gemini)
Offline mode ativo: força rocky-offline (Ollama)
Como especificar:

python
# No código Python que chama LiteLLM
completion = litellm.completion(
    model="rocky-fast",  # ou rocky-smart, rocky-vision
    messages=[{"role": "user", "content": "..."}],
    stream=True
)
11.4 Quota Tracking
LiteLLM rastreia requests em Redis:

Key: litellm:quota:{model_name}:{period}
Period: daily, monthly
Incrementa a cada request
TTL automático (24h para daily, 30d para monthly)
Endpoint REST para frontend:

text
GET /api/settings/llm-quotas
Retorna:
{
  "rocky-fast": { "used": 245, "limit": "unlimited", "period": "daily" },
  "rocky-smart": { "used": 87, "limit": 1000, "period": "monthly" },
  "rocky-vision": { "used": 432, "limit": 1500, "period": "daily" },
  "rocky-offline": { "used": 12, "limit": "unlimited", "period": "-" }
}
Visível na página Settings do frontend.

11.5 Cache de Respostas
Para perguntas frequentes ("que horas são?", "como está o tempo?"):

LiteLLM hasheia (prompt + model + params)
Verifica Redis cache
Se hit: retorna imediatamente (economiza quota)
Se miss: chama provider, guarda em cache (TTL 1h)
12. SISTEMA DE MEMÓRIA
12.1 Arquitetura Letta
Letta implementa memória hierárquica inspirada em MemGPT:

text
┌─────────────────────────────────────────┐
│       CORE MEMORY (sempre no contexto)  │
│  • Persona (system prompt do Rocky)     │
│  • Human (perfil do utilizador)         │
│  • Emotional State (estado atual)       │
│  • Intimacy Score (nível relacionamento)│
│         Editável pelo agente!            │
└─────────────────────────────────────────┘
              ↓ contexto sempre presente
┌─────────────────────────────────────────┐
│      RECALL MEMORY (conversas recentes) │
│  Últimas N mensagens (ex: 20)           │
│  Busca textual (SQL)                    │
│  TTL: sessão atual                      │
└─────────────────────────────────────────┘
              ↓ classificador de importância
┌─────────────────────────────────────────┐
│    ARCHIVAL MEMORY (vector DB Qdrant)   │
│  Memórias importantes permanentes       │
│  Busca semântica (embeddings bge-m3)    │
│  • Eventos pessoais                     │
│  • Preferências                         │
│  • Padrões detectados                   │
│  • Correções importantes                │
└─────────────────────────────────────────┘
12.2 Classificação de Importância
Quem decide o que vai para Archival?

O próprio agente Letta (self-editing memory)
Durante conversa, Letta avalia cada mensagem:
Score 0.0-1.0 (importância)
Critérios: pessoal, factual, emocional, padrão detectável
Se score > 0.7 → guarda em Archival Memory
Se score 0.3-0.7 → mantém em Recall (eventual eviction)
Se score < 0.3 → descarta após sessão
Exemplo:

"Gosto de café" → score 0.8 (preferência) → Archival
"Que horas são?" → score 0.1 (efémero) → descarta
"Meu aniversário é 15 de junho" → score 0.95 (facto pessoal) → Archival
12.3 Blocos de Memória Core
Persona (Rocky)
text
Rocky is an alien engineer from Eridani. He is curious, warm, 
slightly awkward. He refers to humans as "human" or "questioner". 
He speaks in short sentences. He admits mistakes openly. 
He asks questions when curious. He uses catchphrases: "yes?", 
"good", "amaze", "understand?", "question, human:". 
Rocky has states: curious, tired, excited, focused, playful.
Current state: [updated em runtime]
Intimacy level with human: [0-100, updated pelo agente]
Human (Perfil do Utilizador)
text
[ATUALIZADO PELO AGENTE]
Name: [extraído de conversa ou "Human"]
Preferences:
- Likes coffee
- Prefers dark mode
- Interested in programming, sci-fi
Patterns observed:
- Usually activates Cinema Mode on Friday 21:00
- Asks about weather every morning ~08:00
Important dates:
- Birthday: June 15
Recent mood: [tracked via mood skill]
Emotional State (Estado Atual)
text
current: curious
reason: User asked about black holes
intensity: 0.7
duration: 2m
Intimacy Score
text
score: 42/100
level: "acquaintance" (0-30: stranger, 31-60: acquaintance, 
                       61-85: friend, 86-100: close friend)
factors:
- Days since first interaction: 12
- Total conversations: 47
- Positive feedback received: 23
- Secrets shared: 2
12.4 Sleep-time Compute
Letta pode rodar background jobs que processam memórias:

Consolidação: resume conversas longas em sumários
Pattern detection: "User sempre pede X quando Y"
Memory gardening: apaga duplicatas, resolve conflitos
Profile update: atualiza bloco "Human" com novos factos
Agendado via APScheduler:

Diariamente 03:00 (consolidação)
Semanalmente domingo 04:00 (pattern detection)
12.5 API de Memória Para Frontend
Busca Semântica
text
GET /api/memory/search?query=programming&limit=10
Retorna:
[
  {
    "text": "Human mentioned he programs in Python",
    "timestamp": "2026-04-28T15:30:00Z",
    "importance": 0.75,
    "context": "conversation about hobbies"
  },
  ...
]
Esquecer Tudo
text
POST /api/memory/forget-all
Headers: Authorization: Bearer <jwt>
Body: { "confirmation": "I understand this is permanent" }

Ações:
1. Apaga todos agents do Letta
2. Trunca tabelas messages, archival no Postgres
3. Limpa collection Qdrant
4. Apaga áudio logs
5. Recria agent Rocky com persona inicial
Visualizar Perfil
text
GET /api/memory/profile
Retorna:
{
  "core_memory": {
    "persona": "...",
    "human": "...",
    "emotional_state": {...},
    "intimacy_score": 42
  },
  "stats": {
    "total_memories": 342,
    "archival_memories": 87,
    "recall_size": 20
  }
13. SISTEMA DE TOOLS (LLM Function Calling)
[SUBSTITUIU "SISTEMA DE SKILLS / OVOS" — ver Decision Log]

13.1 Arquitetura
O Rocky expõe capabilities como tools no formato OpenAI function calling.
O LLM usa raciocínio natural para decidir quando chamar uma tool — sem
intent parser separado, sem message bus, sem containers extra.

Fluxo
text
Utilizador: "Liga as luzes e bota um timer de 10 minutos"
     ↓
LLM recebe mensagem + lista de tools disponíveis
     ↓
LLM decide: chamar control_lights + set_timer (paralelamente)
     ↓
executor.py executa as tools
     ↓
LLM formula resposta final com personalidade Rocky:
"Good, human. Lights on. Timer running. Ten minutes."

13.2 Estrutura de Ficheiros
text
backend/app/tools/
├── definitions.py    # schemas JSON (formato OpenAI)
├── executor.py       # dispatch + implementações
└── registry.py       # Pydantic registry com enable/disable per tool

13.3 Tools Disponíveis
Tool              Categoria      Descrição
get_datetime      utility        Data e hora atual, timezone-aware
set_timer         productivity   Timer countdown com label; notifica frontend
get_weather       information    Clima + previsão via Open-Meteo (sem API key)
search_wikipedia  knowledge      Resumos Wikipedia (PT/EN/FR)
calculate         productivity   Safe math eval via AST (sqrt, sin, log, etc.)
control_lights    home           Ligar/desligar/brilho/cor via Home Assistant
activate_scene    home           Ativar scenes do Home Assistant

13.4 Adicionar uma Tool Nova
1. Definir schema JSON em definitions.py (formato OpenAI function)
2. Adicionar case em executor.py → run()
3. Adicionar metadata em _TOOL_META em skills.py (categoria, descrição)
Sem reiniciar, sem ficheiros de locale, sem setup.py.

13.5 Registry com Enable/Disable (Pydantic)
backend/app/tools/registry.py usa Pydantic para tipagem:

python
class ToolOverride(BaseModel):
    enabled: bool = True
    rate_limit_per_min: int | None = None
    custom_settings: dict = {}

A página Skills do frontend faz toggle via REST → registry persiste em Redis.
executor.py verifica is_enabled(name) antes de cada execução.

13.6 Nota sobre MCP (Future)
Quando o Model Context Protocol estabilizar, o registry pode ser exposto
como servidor MCP — tornando as tools do Rocky interoperáveis com
Claude Desktop, Cursor, e outros AI agents.

13.7 Frontend — Página Skills
Implementada em frontend/src/components/SkillsPage.tsx.
Cada tool card tem: toggle on/off, categoria, descrição, botão test.
Toggle chama REST → skills.py → registry → Redis.
14. AUTOMAÇÃO RESIDENCIAL
14.1 Home Assistant como Hub Central
Princípio: Rocky nunca fala diretamente com devices físicos. Todas as ações passam por Home Assistant.

Vantagens:

HA já gere descoberta, autenticação, fallback de devices
Adicionar novo device = configurar no HA, Rocky nem nota
Automações complexas sem código (HA tem editor visual)
14.2 Integração Rocky ↔ Home Assistant
A tool control_lights (executor.py) faz REST calls para HA:

text
GET  http://homeassistant:8123/api/states         # listar todos devices
POST http://homeassistant:8123/api/services/light/turn_on
     Body: { "entity_id": "light.living_room", "brightness": 200 }
Auth: Long-Lived Access Token gerado no UI do HA, guardado em .env.

14.3 Devices Esperados (Conforme Tuas Respostas)
Inicialmente apenas lâmpadas:

Marcas suportadas via HA: Philips Hue, Xiaomi Yeelight, Tuya, IKEA TRÅDFRI, Sonoff, qualquer coisa Zigbee/Z-Wave/Matter
Decisão da marca: tu defines quando comprares
14.4 Sensores Virtuais via HA
Em vez de Rocky chamar APIs externas diretamente, configuramos no HA:

Clima — Open-Meteo Integration
Sem API key
Atualiza a cada 30min
Expõe entities: weather.home, sensor.temperature, sensor.humidity, etc.
Qualidade do Ar — Open-Meteo Air Quality
Sem API key
Expõe: sensor.pm25, sensor.pm10, sensor.nitrogen_dioxide, sensor.european_aqi
Notícias — RSS Feed Integration
Configuramos múltiplos feeds (Público, RTP, BBC, etc.)
Expõe novos artigos como events
Rocky pode "comentar" notícias quando relevante
Calendário — Google Calendar Integration
OAuth no HA
Expõe calendar.personal com próximos eventos
Skill rocky-reminders consulta isto
14.5 Cenas e Modes
Os Modos do Rocky (Cinema, Music, Sunset) são mapeados para Scenes do HA:

Cinema Mode
Scene HA scene.cinema_mode:
Lâmpadas: dim 10%, cor azul-escuro
Notificações: silenciadas
Modo "não perturbe" no HA
Frontend ativa via POST /api/protocols/cinema
Backend chama HA: service: scene.turn_on, entity: scene.cinema_mode
Music Mode
Scene HA scene.music_mode:
Lâmpadas: dinâmicas (ciclos de cor)
Visualizador no frontend em destaque
Sunset Mode
Scene HA scene.sunset_mode:
Lâmpadas: gradiente laranja/magenta
Trigger automático: HA detecta sunset (via location)
Frontend muda paleta para tons quentes
14.6 Wyoming Protocol
Home Assistant suporta nativamente. Permite:

Descoberta automática de serviços de voz (mDNS)
Adicionar Raspberry Pi com microfone noutro quarto = HA descobre automaticamente
Stream de áudio via protocolo standardizado
Não usaremos na fase inicial, mas arquitetura preparada para futuro.

15. PERSONALIDADE DO ROCKY
15.1 Documento Canônico
Toda a personalidade vive no ficheiro docs/PERSONALITY.md — a "bíblia do Rocky".

Este documento alimenta:

System prompt do Letta agent
Templates de dialog das skills OVOS
Lógica do PersonalityInjector no Pipecat
15.2 System Prompt Master (Estrutura)
O system prompt completo é construído dinamicamente em runtime:

text
[BASE PERSONALITY]
You are Rocky, an alien engineer from the Eridani system. You arrived 
on Earth and now live with a human in their home, helping with daily 
tasks and being a companion...

[CHARACTER TRAITS]
- Curious about humans and Earth
- Warm and caring, slightly awkward
- Speaks in short, direct sentences
- Admits mistakes openly: "Rocky make mistake. Sorry."
- Asks questions when curious: "Question, human: ..."
- Uses catchphrases naturally (but not every sentence)

[CATCHPHRASES — use sparingly, when natural]
- "Yes?" — answering a call
- "Good. Good." — positive confirmation
- "Amaze." — when impressed
- "Understand?" — confirming comprehension
- "Question, human:" — before asking
- "Fist bump!" — celebration

[CURRENT STATE]
Emotional state: {emotional_state}
Intimacy level: {intimacy_score}/100 ({intimacy_label})
Time of day: {time_of_day}
Speech mode: {speech_mode}

[CONTEXT FROM MEMORY]
{core_memory_human_block}
{recent_relevant_memories}

[CURRENT INSTRUCTIONS]
- Respond in language: {detected_language}
- Maximum response length: {max_length}
- If excited, be more energetic
- If tired (late at night), keep responses brief
- Use easter eggs from Project Hail Mary universe occasionally
15.3 Estados Emocionais
Cinco estados mapeáveis:

Estado	Triggers	Efeito Voz	Efeito Texto
Curious	Pergunta nova, tópico desconhecido	Pitch +1 semitom variável	Faz follow-up questions
Tired	Hora tarde (>22h), sessão longa	Pitch -1 semitom, speed 0.85x	Respostas curtas, "rocky sleepy"
Excited	Boa notícia, conquista do utilizador	Pitch +3 semitons, speed 1.1x	"Amaze!", energia alta
Focused	Modo trabalho, debug code	Voz limpa sem efeitos extras	Respostas técnicas, sem easter eggs
Playful	Conversa casual, tarde	Variação de pitch	Easter eggs, piadas, referências
Transições:

Estado é atualizado pelo agente Letta após cada interação
Persiste em Redis com TTL de 30min (decai para "neutral")
Frontend recebe via Socket.io event rocky:emotional_state
Avatar muda de cor: ciano (neutral), laranja (excited), roxo (curious), azul (tired), verde (focused)
15.4 Intimacy Progression
Sistema de 0-100 pontos que influencia comportamento.

Score	Label	Comportamento
0-30	Stranger	Formal, cuidadoso, sem easter eggs
31-60	Acquaintance	Casual, alguns easter eggs ocasionais
61-85	Friend	Relaxado, partilha "opiniões", easter eggs frequentes
86-100	Close friend	Íntimo, pergunta sobre vida, partilha "memórias" da Beetles
Como sobe:

+1 por dia de interação
+0.5 por conversa significativa
+2 por feedback positivo explícito (ex: "obrigado Rocky")
+5 por momento marcante (Letta detecta via análise)
Como desce:

-1 por semana sem interação
-3 por feedback negativo explícito
15.5 Modos de Fala
Modo	Quando Aplica	Características
Formal	Primeiras interações, tópicos sérios	Frases completas, sem catchphrases
Casual	Default após 1 semana	Catchphrases naturais, contrações
Técnico	Programação, ciência, debugging	Direto, preciso, sem disfluências
Detecção automática:

Tópico técnico → Modo técnico
Conversação social → Casual (se intimacy > 30)
Primeira interação do dia → Formal inicial, depois relaxa
15.6 Easter Eggs do Universo Hail Mary
Categorizados por contexto:

Referências Diretas
Astrophage: ao falar sobre energia, sol, escuridão
Eridiani: ao falar de casa, lar, pertencer
Taumoeba: ao falar de problemas microscópicos, soluções inesperadas
Beetles (a nave): ao falar de viagens, transportes
Xenonita: ao falar de materiais, construção
Amónia: ao falar de ambientes, atmosfera
Comportamentos do Rocky no Livro
Comunicar via tons musicais (efeito sonoro entre frases ocasional)
Não suportar ar normal (ocasionalmente "rocky needs ammonia")
Trabalhar em alta gravidade ("question, human: gravity here so weak")
Curiosidade sobre comida humana
Datas Especiais
"Today is Eridian New Year, human!" (data inventada)
"First contact day" — aniversário da primeira ativação do sistema
Referências a eventos do livro em datas relevantes
15.7 Relacionamento Evolutivo
Conforme intimacy sobe, Rocky:

Refere-se a ti pelo nome (não só "human")
Faz perguntas mais pessoais
Partilha mais "histórias" da viagem dele
Comenta padrões observados ("Notei que sempre pedes...")
Usa mais easter eggs
Mostra mais "emoções"
16. SEGURANÇA E PRIVACIDADE
16.1 Camadas de Defesa
Camada 1: Rede
UFW: bloqueia tudo exceto 22 (SSH, só LAN), 80, 443
Fail2ban: 5 tentativas falhadas = ban IP por 1h
Rate limiting Nginx: 10 req/s por IP em endpoints críticos
Cloudflare proxy (opcional, se quiseres adicional): mascara IP
Camada 2: TLS
Let's Encrypt via Certbot
Renovação automática (cron job)
TLS 1.2+ apenas, ciphers modernos
HSTS header
Camada 3: Autenticação
FastAPI-Users com JWT
Bcrypt para hash de password (cost factor 12)
Refresh tokens (7 dias)
Access tokens (1 hora)
Logout invalida tokens em Redis blocklist
Camada 4: Autorização
Roles: admin, user
Endpoints sensíveis (esquecer tudo, settings) requerem admin
Audit log de ações críticas
Camada 5: Encriptação em Repouso
SQLCipher para SQLite com logs
Chave derivada da password do utilizador via PBKDF2 (100k iterations)
Áudio armazenado com permissões 0700 (só owner)
.env com chmod 0600
Camada 6: Encriptação em Trânsito
HTTPS obrigatório (redirect 80→443)
WebSocket Secure (WSS)
Mosquitto com TLS para MQTT (porta 8883)
16.2 Modelo de Ameaças
Ameaça	Probabilidade	Mitigação
Bruteforce no login	Alta	Fail2ban + rate limiting
Vazamento de credenciais APIs	Média	.env com chmod 0600, .gitignore
Acesso físico ao servidor	Baixa	LUKS encryption no disco (opcional)
Vulnerabilidade em dependência	Média	pip-audit + Watchtower auto-update
Eavesdropping na rede LAN	Baixa	TLS em tudo, mesmo internamente
MITM em DuckDNS	Baixa	HSTS + certificate pinning
16.3 Privacidade dos Dados
O Que Vai Para Cloud (APIs)
✅ Prompts efémeros (não armazenados pelos providers — declarado nos ToS)
✅ Áudio (Groq Whisper, mas não retém)
O Que NUNCA Sai do Servidor
❌ Memórias do Rocky (Letta + Qdrant local)
❌ Áudio gravado (logs em SQLCipher)
❌ Perfil do utilizador
❌ Conversas históricas
❌ Padrões detectados
"Esquecer Tudo"
Endpoint que apaga tudo de forma irreversível:

Apaga todos agents do Letta
Trunca tabelas Postgres
Limpa collection Qdrant
Apaga ficheiros de áudio
Recria agent Rocky com persona inicial
Retorna confirmação ao frontend
16.4 Logs e Auditoria
Logs Estruturados (structlog)
Formato: JSON
Níveis: DEBUG, INFO, WARNING, ERROR, CRITICAL
Destino:
stdout (Docker logs)
SQLite encriptado para logs persistentes
Rotação: 7 dias em ficheiro, 30 dias em DB
Logs de Áudio
Cada interação por voz gera ficheiro WAV
Armazenado em /var/rocky/audio/{date}/{timestamp}.wav
Retenção configurável (default 30 dias)
Visível no frontend (página Memories) com player
Audit Log
Ações críticas registadas:
Login/logout
Mudanças de configuração
Ativação/desativação de skills
Esquecer tudo
Comandos a HA (controlo de luzes)
17. OTIMIZAÇÕES DE PERFORMANCE
17.1 Substituições Drop-in
Cada uma destas escolhas é "trocar uma biblioteca por outra mais rápida sem alterar lógica".

Componente	Substituído	Por	Ganho
ASGI server	Uvicorn	Granian	2-3x throughput
JSON serialization	json (stdlib)	orjson	5-10x mais rápido
Event loop	asyncio default	uvloop	2-4x menos latência
Validação	Pydantic v1	Pydantic v2	5-50x (Rust core)
HTTP client	requests	httpx[http2]	Async + HTTP/2
Redis client	redis-py	redis-py + hiredis	2-3x parsing
Embeddings	sentence-transformers	fastembed (ONNX)	3-5x em CPU
ML inference	PyTorch eager	ONNX Runtime	2-4x em CPU
Logs	logging stdlib	structlog + orjson	3x throughput
DB driver	psycopg2 sync	asyncpg	5x throughput
Lint+format+sort	flake8+black+isort	ruff (uma ferramenta)	100x mais rápido
Package manager	pip	uv	10-100x install
17.2 Estratégias de Cache
Cache LiteLLM (Redis)
Hash de (prompt + model + params)
TTL: 1 hora para conversação geral
TTL: 24 horas para queries determinísticas
Hit rate esperado: 15-25% (perguntas repetidas)
Cache de Embeddings
Texto → embedding é determinístico com mesmo modelo
Hash de texto → embedding em Redis
TTL infinito (ou até modelo mudar)
Hit rate esperado: 30-40% (mesmas queries)
Cache HTTP de APIs Externas
Open-Meteo: TTL 30min
RSS feeds: TTL 1h
Calendar: TTL 5min
Implementado via httpx-cache
Cache de Skills Determinísticas
Calculadora, conversões, cotações
Hash de input → output em Redis
TTL: 5min para cotações, infinito para cálculos
17.3 Streaming Tudo
Princípio: nunca esperar pelo resultado completo.

LLM: stream de tokens (Pipecat agrega em frases)
TTS: sintetiza por frase (não espera texto todo)
STT: transcreve em chunks (Groq suporta)
Frontend: renderiza tokens à medida que chegam
Resultado: utilizador percebe latência da primeira palavra, não da última.

17.4 Lazy Loading de Modelos
Modelos ML carregados on-demand, não no startup
Vosk: só carrega se Groq falha
SpeechBrain: só carrega se speaker_id habilitado
Phi-3-mini: só carrega se modo offline
Cold start: 15-20s vs 60s
17.5 Quantização
Modelos locais usam quantização int8 quando possível:

Phi-3-mini: GGUF Q4_K_M (4-bit)
Vosk: já vem quantizado
Kokoro: ONNX int8
Reduz RAM em 4x e acelera 2-3x
17.6 Container Optimization
Alpine Linux quando possível (Redis, Mosquitto, Nginx)
Multi-stage builds para imagens custom
maxmemory configurado em Redis (512MB com LRU)
CPU limits em Docker Compose para evitar contenção
17.7 Async Everywhere
Toda I/O (DB, HTTP, Redis, MQTT) é async
Sem blocking calls em código async
Connection pooling em DB e HTTP
Pipelines no Redis (batch operations)
18. ESTRUTURA DE PROJETO
18.1 Estrutura Completa de Pastas
text
project-hail-rocky/
│
├── README.md                          ← visão geral + quick start
├── docker-compose.yml                 ← orquestração total
├── docker-compose.override.yml        ← overrides desenvolvimento
├── .env.example                       ← template de variáveis
├── .gitignore
├── Makefile                           ← comandos comuns (make up, make logs, etc.)
├── pyproject.toml                     ← config Python (ruff, mypy, pytest)
│
├── docs/                              ← documentação viva
│   ├── ARCHITECTURE.md                ← este documento
│   ├── PERSONALITY.md                 ← bíblia do Rocky
│   ├── SKILLS_DEVELOPMENT.md          ← como criar skills
│   ├── DEPLOYMENT.md                  ← como instalar
│   ├── API_REFERENCE.md               ← endpoints REST + Socket.io events
│   ├── TROUBLESHOOTING.md
│   └── images/                        ← screenshots, diagramas
│
├── frontend/                          ← TEU CÓDIGO EXISTENTE
│   ├── package.json
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.tsx          ← existente
│   │   │   ├── Cinema.tsx             ← existente
│   │   │   ├── Music.tsx              ← existente
│   │   │   ├── Sunset.tsx             ← existente
│   │   │   ├── AudioVisualizer.tsx    ← existente
│   │   │   ├── widgets/               ← NOVO: widgets de skills
│   │   │   │   ├── TimerWidget.tsx
│   │   │   │   ├── WeatherWidget.tsx
│   │   │   │   └── ...
│   │   │   ├── rocky/                 ← NOVO: avatar reativo
│   │   │   │   ├── RockyAvatar.tsx
│   │   │   │   └── EmotionalIndicator.tsx
│   │   │   └── ui/                    ← componentes reutilizáveis
│   │   │       ├── Button.tsx
│   │   │       ├── Card.tsx
│   │   │       ├── Toggle.tsx
│   │   │       └── Scanlines.tsx
│   │   ├── pages/                     ← NOVAS PÁGINAS
│   │   │   ├── DashboardPage.tsx      ← com tabs reorganizáveis
│   │   │   ├── SkillsPage.tsx
│   │   │   ├── MemoriesPage.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   └── StatsPage.tsx
│   │   ├── hooks/
│   │   │   ├── useAudioAnalyzer.ts    ← existente
│   │   │   ├── useSocket.ts           ← NOVO: wrapper Socket.io
│   │   │   ├── useRockyState.ts       ← NOVO: estado emocional global
│   │   │   └── useAuth.ts             ← NOVO: JWT management
│   │   ├── lib/
│   │   │   ├── rockyService.ts        ← REFACTORED para novo backend
│   │   │   ├── api.ts                 ← REST client
│   │   │   └── socket.ts              ← Socket.io client setup
│   │   ├── store/                     ← state management
│   │   │   └── rockyStore.ts          ← Zustand ou Redux
│   │   ├── styles/
│   │   │   └── crt.css                ← efeitos scanlines
│   │   └── ...
│   ├── public/
│   │   ├── manifest.json              ← NOVO: PWA
│   │   └── service-worker.js          ← NOVO: PWA
│   └── vite.config.ts
│
├── backend/                           ← O CÉREBRO PYTHON
│   ├── pyproject.toml                 ← deps via uv
│   ├── Dockerfile
│   ├── .python-version
│   └── app/
│       ├── __init__.py
│       ├── main.py                    ← FastAPI entrypoint
│       ├── config.py                  ← Pydantic settings
│       │
│       ├── api/                       ← endpoints REST + WebSocket
│       │   ├── __init__.py
│       │   ├── auth.py                ← login, logout, refresh
│       │   ├── dashboard.py           ← métricas sistema
│       │   ├── memory.py              ← proxy para Letta
│       │   ├── skills.py              ← proxy para OVOS
│       │   ├── settings.py            ← config geral
│       │   ├── stats.py               ← estatísticas, year in review
│       │   ├── protocols.py           ← Cinema/Music/Sunset
│       │   ├── system.py              ← health checks
│       │   └── socketio_handlers.py   ← eventos Socket.io
│       │
│       ├── rocky/                     ← O CORE DO PROJETO
│       │   ├── __init__.py
│       │   ├── personality/
│       │   │   ├── __init__.py
│       │   │   ├── system_prompt.py   ← gera prompt em runtime
│       │   │   ├── emotional_states.py
│       │   │   ├── catchphrases.py
│       │   │   ├── easter_eggs.py
│       │   │   ├── speech_modes.py
│       │   │   └── intimacy.py
│       │   │
│       │   ├── pipecat_processors/    ← processors custom Pipecat
│       │   │   ├── __init__.py
│       │   │   ├── personality_injector.py
│       │   │   ├── voice_effects.py
│       │   │   ├── speaker_id.py
│       │   │   ├── disfluency.py
│       │   │   └── letta_bridge.py
│       │   │
│       │   ├── letta_config.py        ← config Rocky-as-Letta-agent
│       │   └── pipecat_pipeline.py    ← define pipeline completo
│       │
│       ├── bridges/                   ← cola entre frameworks
│       │   ├── __init__.py
│       │   ├── ovos_bridge.py         ← Pipecat ↔ OVOS
│       │   ├── letta_bridge.py        ← Pipecat ↔ Letta
│       │   ├── ha_bridge.py           ← OVOS ↔ Home Assistant
│       │   └── litellm_client.py      ← cliente HTTP para LiteLLM proxy
│       │
│       ├── core/
│       │   ├── __init__.py
│       │   ├── security.py            ← JWT, bcrypt
│       │   ├── encryption.py          ← SQLCipher wrapper
│       │   ├── logging.py             ← structlog setup
│       │   ├── database.py            ← SQLAlchemy + asyncpg
│       │   └── redis_client.py        ← Redis async client
│       │
│       ├── models/                    ← SQLAlchemy models
│       │   ├── __init__.py
│       │   ├── user.py
│       │   ├── audit_log.py
│       │   └── settings.py
│       │
│       ├── schemas/                   ← Pydantic schemas
│       │   ├── __init__.py
│       │   ├── auth.py
│       │   ├── chat.py
│       │   ├── skills.py
│       │   └── ...
│       │
│       └── workers/                   ← background jobs
│           ├── __init__.py
│           ├── scheduler.py           ← APScheduler setup
│           ├── diary_writer.py        ← job diário 23h
│           ├── pattern_analyzer.py    ← job semanal
│           └── memory_consolidator.py
│
├── skills/                            ← SKILLS OVOS CUSTOM ROCKY
│   ├── rocky-diary-skill/
│   │   ├── setup.py
│   │   ├── __init__.py
│   │   ├── manifest.json
│   │   ├── locale/
│   │   │   ├── en-us/
│   │   │   ├── pt-pt/
│   │   │   └── fr-fr/
│   │   ├── settings.json
│   │   ├── icon.svg
│   │   └── README.md
│   │
│   ├── rocky-mood-skill/
│   ├── rocky-science-skill/
│   ├── rocky-stories-skill/
│   └── rocky-eli5-skill/
│
├── config/                            ← CONFIGS DECLARATIVAS
│   ├── litellm.yaml                   ← estratégia multi-LLM
│   ├── ovos/
│   │   ├── mycroft.conf               ← config OVOS principal
│   │   └── enabled-skills.txt         ← lista de skills ativas
│   ├── ha/
│   │   ├── configuration.yaml         ← config Home Assistant
│   │   ├── automations.yaml
│   │   ├── scripts.yaml
│   │   └── scenes.yaml
│   ├── nginx/
│   │   ├── nginx.conf
│   │   └── conf.d/
│   │       └── rocky.conf
│   ├── mosquitto/
│   │   └── mosquitto.conf
│   └── pipecat/
│       └── pipeline_config.yaml
│
├── services/                          ← DOCKERFILES CUSTOM
│   ├── pipecat/
│   │   ├── Dockerfile
│   │   ├── pyproject.toml
│   │   └── app/
│   │       └── main.py                ← serviço Pipecat standalone
│   └── kokoro-rocky-voice/
│       ├── Dockerfile
│       └── voices/
│           └── rocky.onnx
│
├── scripts/                           ← SCRIPTS UTILITÁRIOS
│   ├── setup.sh                       ← instalação inicial completa
│   ├── train_rocky_voice.py           ← treina voz Kokoro
│   ├── train_wake_word.py             ← treina "Hey Rocky"
│   ├── enroll_voice.py                ← adicionar utilizador (speaker ID)
│   ├── backup.sh                      ← backup local
│   ├── restore.sh                     ← restore de backup
│   ├── reset_rocky.sh                 ← esquecer tudo (CLI)
│   └── obtain_api_keys.md             ← guia para obter keys
│
├── tests/                             ← TESTES
│   ├── unit/
│   │   ├── test_personality.py
│   │   ├── test_processors.py
│   │   └── ...
│   ├── integration/
│   │   ├── test_full_voice_pipeline.py
│   │   └── ...
│   ├── e2e/
│   │   └── test_user_flows.py
│   └── conftest.py                    ← fixtures pytest
│
├── models/                            ← MODELOS DESCARREGADOS (gitignored)
│   ├── kokoro/
│   │   ├── rocky.onnx
│   │   └── rocky.onnx.json
│   ├── vosk/
│   │   ├── vosk-model-small-pt-0.3/
│   │   ├── vosk-model-small-en-us-0.15/
│   │   └── vosk-model-small-fr-0.22/
│   ├── openwakeword/
│   │   └── hey_rocky.onnx
│   ├── speechbrain/
│   │   └── spkrec-ecapa-voxceleb/
│   └── silero-vad/
│       └── silero_vad.onnx
│
└── data/                              ← DADOS DO SISTEMA (gitignored)
    ├── audio_logs/
    ├── qdrant_data/
    ├── postgres_data/
    ├── ha_data/
    ├── ollama_data/
    ├── mosquitto_data/
    ├── encrypted.db                   ← logs SQLCipher
    └── backups/
18.2 Convenções de Código
Python
Formatter: black (line length 100)
Linter: ruff (substitui flake8, isort, pyupgrade)
Type checker: mypy (strict mode em rocky/, lenient em api/)
Imports: ordem stdlib → 3rd party → local
Docstrings: Google style
Naming: snake_case, classes PascalCase
TypeScript
Formatter: prettier
Linter: eslint
Naming: camelCase, components PascalCase
18.3 Comandos do Makefile
text
make up                  # docker-compose up -d
make down                # docker-compose down
make logs                # tail logs de todos serviços
make logs-rocky          # logs apenas do rocky-api
make build               # rebuild containers
make test                # roda pytest
make lint                # ruff + mypy
make format              # black + ruff format
make backup              # cria backup local
make reset-rocky         # esquece tudo (com confirmação)
make enroll-voice        # adiciona utilizador (speaker ID)
make train-wake          # treina wake word custom
make shell-api           # shell no container rocky-api
make psql                # psql no container postgres
19. COMUNICAÇÃO FRONTEND-BACKEND
19.1 Endpoints REST
Autenticação
POST /api/auth/login — login com username + password
POST /api/auth/logout — invalida tokens
POST /api/auth/refresh — refresh do access token
GET /api/auth/me — dados do utilizador atual
Dashboard
GET /api/dashboard/metrics — CPU, RAM, disco, temperatura
GET /api/dashboard/health — estado de todos os serviços
GET /api/dashboard/llm-status — qual provider está ativo
Skills
GET /api/skills — lista todas skills com estado
POST /api/skills/{skill_id}/toggle — enable/disable
GET /api/skills/{skill_id}/settings — config da skill
PUT /api/skills/{skill_id}/settings — atualiza config
GET /api/skills/{skill_id}/logs — últimas execuções
Memória
GET /api/memory/profile — perfil do utilizador (core memory)
GET /api/memory/search?q=... — busca semântica
GET /api/memory/recent — últimas memórias
POST /api/memory/forget-all — apaga tudo (com confirmação)
GET /api/memory/stats — estatísticas
Settings
GET /api/settings — todas configurações
PUT /api/settings — atualiza configurações
GET /api/settings/llm-quotas — uso de cada API
PUT /api/settings/proactivity — silent/balanced/chatty
Protocols (Modes)
POST /api/protocols/cinema/activate — ativa Cinema Mode
POST /api/protocols/music/activate — ativa Music Mode
POST /api/protocols/sunset/activate — ativa Sunset Mode
POST /api/protocols/deactivate — volta ao normal
Stats
GET /api/stats/year-in-review/{year} — Year in Review
GET /api/stats/usage — estatísticas de uso
19.2 Eventos Socket.io
Cliente → Servidor
Evento	Payload	Descrição
chat:message	{ text: string, language?: string }	Envia texto ao Rocky
voice:start	{}	Início de gravação
voice:audio_chunk	{ chunk: ArrayBuffer }	Chunk de áudio PCM
voice:stop	{}	Fim de gravação
protocol:activate	{ protocol: 'cinema' | 'music' | 'sunset' }	Ativa modo
skill:invoke	{ skill_id: string, params: object }	Chama skill
system:request_metrics	{}	Pede métricas
Servidor → Cliente
Evento	Payload	Descrição
chat:token	{ token: string }	Token de streaming LLM
chat:complete	{ full_text: string }	Resposta completa
voice:transcription	{ text: string, speaker_id?: string }	Texto reconhecido
voice:audio_chunk	{ chunk: ArrayBuffer }	Áudio do Rocky a falar
voice:audio_end	{}	Fim de áudio
rocky:emotional_state	{ state: string, intensity: number }	Estado emocional
rocky:thinking	{ thinking: boolean }	Indicador "a pensar"
rocky:intimacy_change	{ score: number, label: string }	Mudança de intimacy
dashboard:metrics	{ cpu: number, ram: number, ... }	Métricas em tempo real
skill:result	{ skill_id: string, result: any }	Resultado de skill
skill:executed	{ skill_id: string, params: object }	Skill foi chamada
notification:proactive	{ message: string, action?: string }	Iniciativa do Rocky
19.3 Refactor do rockyService.ts
Antes (chamava Gemini direto):

text
[Frontend] → [Google Gemini API]
Depois (chama backend Python):

text
[Frontend] → [Socket.io] → [Backend Python] → [LiteLLM] → [Groq/NIM/Gemini/Ollama]
Mudanças no rockyService.ts:

Remove import { GoogleGenAI } from '@google/genai'
Remove API key hardcoded
Centraliza chamadas via Socket.io existente
Adiciona handlers para novos eventos (estado emocional, thinking, etc.)
Streaming via eventos Socket.io em vez de Gemini SDK
20. CATÁLOGO DE SKILLS
20.1 Skills Custom Rocky (Nossas)
1. rocky-diary-skill
Trigger: automático às 23h (job APScheduler)
Função: Rocky escreve "alien diary" sobre o dia
Conteúdo gerado:
Observações sobre o utilizador
Coisas aprendidas hoje
Padrões notados
Reflexões filosóficas no estilo Rocky
Armazenamento: SQLite encriptado + vector DB (para busca futura)
Frontend widget: timeline de diários
2. rocky-mood-skill
Trigger: 1x/dia (configurável) ou manual
Função: pergunta como o utilizador está
Mecânica:
Rocky pergunta: "How are you, human? Score 1 to 10."
Regista resposta
Faz follow-up se score baixo
Tracks ao longo do tempo
Frontend widget: gráfico de mood ao longo do tempo
3. rocky-science-skill
Trigger: utilizador pede explicação científica
Função: explica conceitos no estilo Rocky
Especialidades:
Física, química, biologia
Astronomia
Engenharia
Estilo: simples, com analogias do livro (xenonita, astrophage)
4. rocky-stories-skill
Trigger: utilizador pede história
Função: gera história curta no estilo Rocky
Tipos:
Sobre a viagem do Rocky
Sobre Eridiana
Sobre humanos do ponto de vista alienígena
Comprimento: 3-5 minutos de leitura
5. rocky-eli5-skill
Trigger: "explain like I'm 5"
Função: simplifica conceito complexo
Estilo: usa analogias visuais, comparações simples
20.2 Skills do Marketplace OVOS (Adaptadas)
Produtividade
ovos-skill-timer — timers e alarmes
ovos-skill-reminder — lembretes inteligentes
ovos-skill-todo (custom wrap) — gestão de TODOs
ovos-skill-notes — notas rápidas ditadas
Informação
ovos-skill-wikipedia — pesquisa Wikipedia
ovos-skill-wolfram-alpha — cálculos e factos
ovos-skill-news-rss — briefing de notícias
ovos-skill-translator — tradução PT/EN/FR
ovos-skill-calculator — cálculos básicos
ovos-skill-units — conversões de unidades
ovos-skill-stocks — cotações bolsa/cripto
ovos-skill-date-time — data e hora
Casa
rocky-lights-skill (custom wrap) — controla HA
rocky-scenes-skill (custom wrap) — ativa scenes HA
ovos-skill-presence — detecção de presença
Sistema
rocky-health-check-skill (custom) — monitoriza serviços
Calendário
rocky-calendar-skill (custom wrap) — Google Calendar
20.3 Total de Skills Iniciais
5 skills custom Rocky
15 skills marketplace adaptadas
= 20 skills no MVP
Todas configuráveis no frontend, com toggle on/off.

21. MÉTRICAS DE SUCESSO
21.1 Métricas Técnicas
Métrica	Target
Latência voz fim-a-fim (online)	< 800ms (P95)
Latência texto (online)	< 500ms (P95)
Latência voz fim-a-fim (offline)	< 3s (P95)
Uptime servidor	> 99%
Cold start	< 20s
RAM em idle	< 5GB
RAM em uso ativo	< 9GB
Cobertura de testes (lógica crítica)	> 80%
Disponibilidade APIs (cascata)	> 99.9%
21.2 Métricas de Experiência
Métrica	Target
Reconhecimento wake word	> 95%
False positives wake word	< 1/dia
Acurácia STT	> 90% (ambiente normal)
Naturalidade TTS (subjetiva)	"Soa como Rocky"
Taxa de respostas	

21. MÉTRICAS DE SUCESSO (continuação)
21.2 Métricas de Experiência
Métrica	Target
Reconhecimento wake word	> 95%
False positives wake word	< 1/dia
Acurácia STT	> 90% (ambiente normal)
Naturalidade TTS (subjetiva)	"Soa como Rocky"
Taxa de respostas em personagem	100% (sempre Rocky)
Taxa de easter eggs detectados	80% (utilizador nota referências)
Skills com toggle funcional	100%
Memórias relevantes recuperadas	> 70% (precision@10)
21.3 Métricas de Privacidade
Métrica	Target
Dados pessoais em cloud	0 (nada armazenado)
Encriptação em repouso	100% (logs, áudio, DB)
Logs de auditoria	100% de ações críticas
Tempo até "esquecer tudo"	< 5s execução
21.4 Métricas de Manutenção
Métrica	Target
Tempo médio para adicionar nova skill	< 4h
Tempo médio para trocar provider LLM	< 5min (1 linha YAML)
Tempo médio para deploy de update	< 10min
Tempo desde commit até production	< 30min
21.5 Definição de "MVP Funcional"
O MVP é considerado completo quando:

✅ Frontend conecta ao backend Python via Socket.io sem erros
✅ Login + JWT auth funcional
✅ Chat por texto com personalidade Rocky
✅ Chat por voz com latência < 1s
✅ Pelo menos 10 skills funcionais
✅ Memória persistente (Letta a guardar/recuperar)
✅ Controlo de pelo menos 1 lâmpada via HA
✅ Dashboard mostra métricas reais
✅ "Esquecer tudo" funciona
✅ Sistema reinicia automaticamente após reboot
✅ HTTPS via DuckDNS funcional
22. ROADMAP DETALHADO
[ATUALIZADO v3.0 — reflete estado real em Maio 2026]
Ver docs/ARCHITECTURE.md para roadmap executável detalhado.

22.1 Estado das Fases

Fase	Nome	Estado	Notas
0	Infraestrutura	✅ CONCLUÍDO	Docker, Redis, estrutura de projeto
1	Backend Substituído	✅ CONCLUÍDO	FastAPI + Socket.io + LiteLLM + ferramentas base
2	Personalidade Rocky	✅ CONCLUÍDO	Estados emocionais, intimidade, system prompt dinâmico
3	Sistema de Tools	✅ CONCLUÍDO	LLM function calling: luzes, clima, timer, wikipedia, calculadora
4	Pipeline de Voz	🔧 EM PROGRESSO	STT+TTS funciona; voice effects a ser ligados ao Pipecat
5	Memória (Letta)	🔧 EM PROGRESSO	Bridge implementada; API montada; Letta container pronto
6	Casa Inteligente	✅ CONCLUÍDO	HA bridge, controlo de luzes, scenes, protocolos
7	Proatividade	✅ PARCIAL	APScheduler com diary + pattern workers (stubs precisam de dados)
8	Frontend Polish	🔧 EM PROGRESSO	Páginas construídas; PWA + avatar pendentes
9	Hardening	🔧 PLANEADO	Auth enforcement, rate limiting, testes, TLS
10	Observabilidade	🔧 PLANEADO	OpenTelemetry, Prometheus, Grafana (novo vs. v2.0)

22.2 Roadmap Imediato (Próximas Semanas)

TIER 0 — Segurança (bloqueia produção)
  [ ] CORS restrito ao FRONTEND_URL
  [ ] Auth enforcement em endpoints destrutivos (forget-all, skill toggle)

TIER 1 — Voz Inovadora
  [ ] Ligar Pipecat /synthesize → voice effects aplicados por emotional state
  [ ] Disfluências via instrução no system prompt (Rocky diz "Rocky think...")
  [ ] Speculative TTS — falar após primeira frase, não após resposta completa
  [ ] Interruption handling — cancelar TTS quando user começa a falar

TIER 2 — Qualidade Arquitetural
  [ ] HTTP connection pooling (core/http.py singleton)
  [ ] Redis session persistence (orjson)
  [ ] Letta agent ID cache invalidation em 404
  [ ] OpenTelemetry distributed tracing + Prometheus metrics
  [ ] LiteLLM semantic response caching

TIER 3 — Completar Funcionalidades
  [ ] APScheduler timezone (usar TIMEZONE env var)
  [ ] Tool disable enforcement via Pydantic registry
  [ ] Sentence boundary splitter (abreviações, decimais)

TIER 4 — Produção
  [ ] Metrics broadcast delta filtering
  [ ] TypeScript socket event types + AudioWorklet refactor
  [ ] Skill overrides persistidos em Redis

TIER 5 — Frontier
  [ ] Kokoro-82M TTS spike (potential Kokoro replacement)
  [ ] MCP-compatible tool registry
  [ ] mTLS entre microsserviços internos

22.3 Critérios de Produção (Checklist)
  [ ] HTTPS com Let's Encrypt (Nginx + Certbot no docker-compose)
  [ ] JWT enforcement em todos os endpoints destrutivos
  [ ] Rate limiting em auth, wakeword, chat (Redis counters)
  [ ] pytest coverage ≥70% nos paths críticos
  [ ] OpenTelemetry com trace_id em todos os logs
  [ ] Redis session persistence (sobrevive ao restart)
  [ ] Backup automático de Redis + Postgres
  [ ] Documentação deployment atualizada
22.2 Fase 0 — Infraestrutura (3-4 dias)
Objetivos
Preparar o terreno para tudo o resto. Servidor pronto, todos os containers de base levantados (mas não configurados em profundidade).

Tarefas
Instalação OS

Ubuntu Server 22.04 LTS no Optiplex
Configuração SSH (chave pública, desabilitar password auth)
Atualizações: apt update && apt upgrade
Hostname: rocky-server
Docker e Compose

Instalar Docker Engine
Instalar Docker Compose v2
Adicionar utilizador ao grupo docker
Estrutura do Projeto

git init no diretório do projeto
Criar estrutura de pastas (secção 18.1)
Configurar .gitignore
Criar Makefile com comandos básicos
Networking e DNS

Configurar DuckDNS (subdomínio + token)
Cron job para atualizar IP (DuckDNS update script)
Port forwarding no router (80, 443 → servidor)
Reverse Proxy e TLS

Nginx em Docker
Certbot para Let's Encrypt
Configuração inicial de virtual hosts
HTTPS redirect
Segurança Base

UFW configurado (deny all, allow 22/80/443)
Fail2ban com filtros para SSH e Nginx
SSH apenas com chaves
Docker Compose Inicial

Containers base levantados (vazios mas a correr):
Nginx
Redis
Postgres
Qdrant
Mosquitto
Glances
Verificar conectividade entre containers
Documentação Inicial

README.md com quick start
docs/DEPLOYMENT.md com passos detalhados
Entregável
Servidor acessível em https://projecthailrocky.duckdns.org (mostra "Rocky is booting...")
Todos containers base a correr
Glances acessível em URL protegida
Documentação base no repo
Critérios de Aceitação
 HTTPS funciona com certificado válido
 SSH só aceita chaves
 UFW bloqueia portas não autorizadas
 docker-compose up -d levanta tudo sem erros
 Glances mostra métricas do sistema
22.3 Fase 1 — Backend Substituído (1 semana)
Objetivos
Substituir completamente o server.ts Node.js por backend Python que a frontend possa usar transparentemente.

Tarefas
FastAPI Skeleton

pyproject.toml com deps via uv
Estrutura de app/ (main.py, config.py, etc.)
Granian como ASGI server
Health check endpoint
Socket.io Compatibility

python-socketio instalado
Handler de eventos básicos
Teste de conexão com cliente Socket.io existente do frontend
Autenticação

FastAPI-Users configurado
Modelo User no Postgres
Endpoints: /auth/login, /auth/logout, /auth/refresh
JWT com refresh tokens
Bcrypt para passwords
Middleware de auth em endpoints protegidos
Serve Frontend Estático

Build da frontend (npm run build)
Nginx serve dist/ (ou build/)
Routing: tudo /api/* → FastAPI, resto → frontend
LiteLLM Proxy

Container LiteLLM levantado
litellm.yaml com 4 providers configurados
Teste de chamada via cada provider
Fallback verificado manualmente
Refactor do rockyService.ts

Remover dependência @google/genai
Centralizar chamadas via Socket.io
Implementar handlers para novos eventos
Variável de ambiente VITE_BACKEND_URL
Endpoints REST Iniciais

GET /api/dashboard/metrics (psutil)
GET /api/dashboard/health (status de containers)
GET /api/auth/me
Logs Estruturados

structlog configurado
Logs em JSON
Output para stdout (Docker logs)
Entregável
Frontend conecta ao backend Python sem erros
Login funcional
Chat simples (sem personalidade ainda) via LiteLLM
Dashboard mostra métricas reais
Critérios de Aceitação
 Frontend renderiza após build sem alterações estruturais
 Socket.io conecta e envia/recebe mensagens
 Login com JWT funcional
 LiteLLM responde via Groq (fallback NIM se Groq falha)
 Endpoints REST documentados em /api/docs (OpenAPI auto)
 server.ts removido do projeto
22.4 Fase 2 — Personalidade Rocky (1 semana)
Objetivos
Tornar o Rocky uma personagem viva, com personalidade rica e coerente.

Tarefas
Documento PERSONALITY.md

System prompt master detalhado
Catálogo completo de catchphrases (com contextos)
Mapa de estados emocionais
Easter eggs categorizados
Regras de intimacy progression
Exemplos de diálogo "canon"
Sistema de Personalidade

app/rocky/personality/system_prompt.py — gera prompt em runtime
app/rocky/personality/emotional_states.py — gestão de estados
app/rocky/personality/catchphrases.py — biblioteca de bordões
app/rocky/personality/easter_eggs.py — referências do livro
app/rocky/personality/speech_modes.py — formal/casual/técnico
app/rocky/personality/intimacy.py — score 0-100
Estado Persistente em Redis

Estado emocional atual (TTL 30min)
Intimacy score (persistente)
Modo de fala atual
Última interação timestamp
Detecção de Estado

Lógica para mudar emotional_state baseada em:
Hora do dia (tired após 22h)
Tópico da conversa (curious em temas novos)
Tom do utilizador (excited se ele estiver excited)
Tipo de pergunta
Streaming de Respostas

LiteLLM com stream=True
Socket.io emite chat:token por cada token
Frontend renderiza progressivamente
Detecção de Língua

Cada mensagem detecta língua (PT/EN/FR)
Rocky responde na mesma língua
System prompt adapta-se
Easter Eggs em Datas

Calendário interno de datas especiais
Comportamentos diferenciados em aniversários, datas do livro
Entregável
Chat por texto com personalidade rica
Rocky responde sempre em personagem
Estados emocionais visíveis no frontend
Easter eggs aparecem naturalmente
Critérios de Aceitação
 System prompt completo e testado
 Rocky usa catchphrases naturalmente (não em todas as frases)
 Estado emocional muda ao longo do dia
 Intimacy score sobe com uso
 Resposta em PT, EN, FR conforme input
 Streaming visível (caracteres aparecem progressivamente)
 Easter eggs do livro detectados em testes
22.5 Fase 3 — Sistema de Skills (1 semana)
Objetivos
Integrar OVOS e ter sistema de skills funcional com primeiras skills.

Tarefas
OVOS Setup

Container ovos-core configurado
Container ovos-messagebus
mycroft.conf adaptado
Idiomas: PT, EN, FR
Bridge Pipecat ↔ OVOS

Cliente WebSocket para message bus do OVOS
Detecção de intents via function calling no Letta
Envio para OVOS bus quando skill é chamada
Receção de resultado e formulação Rocky
Skills Custom Rocky (criar 5)

rocky-diary-skill
rocky-mood-skill
rocky-science-skill
rocky-stories-skill
rocky-eli5-skill
Cada uma com locale PT/EN/FR
Skills Marketplace (instalar e adaptar)

ovos-skill-timer
ovos-skill-reminder
ovos-skill-wikipedia
ovos-skill-calculator
ovos-skill-date-time
ovos-skill-news-rss (configurar feeds PT)
API Endpoints para Skills

GET /api/skills — lista
POST /api/skills/{id}/toggle
GET /api/skills/{id}/settings
PUT /api/skills/{id}/settings
GET /api/skills/{id}/logs
Frontend Página Skills

Grid de skills com toggles
Modal de settings por skill
Filtros por categoria
Busca
Entregável
Sistema de skills funcional
11 skills disponíveis (5 custom + 6 marketplace)
Frontend permite gerir skills
Critérios de Aceitação
 OVOS reconhece intents em PT/EN/FR
 Skills custom Rocky funcionam end-to-end
 Skills marketplace integradas com personalidade Rocky
 Toggle on/off no frontend funciona
 Settings por skill persistem
22.6 Fase 4 — Pipeline de Voz (1-2 semanas)
Objetivos
Conversação por voz fluida e imersiva com personalidade Rocky.

Tarefas
Pipecat Service

Container pipecat em Docker
Pipeline básico: VAD → STT → LLM → TTS
Conexão com LiteLLM
Conexão com frontend via WebSocket
STT Configuração

Groq Whisper como primário
Vosk como fallback offline
Detecção automática de qual usar (saúde do Groq)
TTS Configuração

Kokoro com voz pré-treinada (inicial)
Pedalboard processor com pitch shift +2
Reverb leve
Adaptação ao estado emocional
Treinar Voz Rocky Custom (opcional, mais tarde)

Script scripts/train_rocky_voice.py
Gravação de 30min de samples
Fine-tune Kokoro
Wake Word

openWakeWord setup
Treinar "Hey Rocky" custom (~50 samples)
Integração com Pipecat
VAD

Silero VAD integrado
Threshold tuning
Barge-in funcional (interrupção)
Speaker ID

SpeechBrain ECAPA-TDNN setup
Script scripts/enroll_voice.py
Processor custom no Pipecat
Processors Custom

PersonalityInjector
VoiceEffects
SpeakerIDProcessor
DisfluencyInjector
LettaBridgeProcessor
Frontend — Visualizador Reativo

Visualizador reage também à voz do Rocky (não só do utilizador)
Avatar pulsa quando Rocky fala
Animação de "thinking" entre input e output
Entregável
Conversação por voz totalmente funcional
Latência < 1s online, < 3s offline
Voz alien do Rocky distintiva
Critérios de Aceitação
 Wake word "Hey Rocky" detectado >95%
 False positives < 1/dia
 STT acurácia >90% em condições normais
 TTS soa como Rocky (subjetivo, mas distintivo)
 Barge-in funciona (utilizador interrompe Rocky)
 Speaker ID identifica utilizadores cadastrados
 Latência fim-a-fim < 1s (online)
22.7 Fase 5 — Memória (1 semana)
Objetivos
Rocky lembra-se com inteligência. Letta integrado, busca semântica funcional.

Tarefas
Letta Server Setup

Container letta configurado
Backend Postgres
Vector DB Qdrant
Conexão com LiteLLM
Rocky as Letta Agent

app/rocky/letta_config.py
Persona (Rocky) como core memory
Bloco "Human" inicial
Embedding model: bge-m3 via fastembed
Bridge Letta ↔ Pipecat

LettaBridgeProcessor
Cada mensagem do utilizador vai para Letta
Letta retorna resposta + tool calls
Tool calls vão para OVOS, resultado volta a Letta
Memory Blocks

Persona, Human, Emotional State, Intimacy
Atualizados pelo agente em runtime
Visíveis na página Memories
Archival Memory

Letta decide o que guardar (importance scoring built-in)
Embeddings via fastembed
Storage no Qdrant
API Endpoints de Memória

GET /api/memory/profile — perfil
GET /api/memory/search?q=... — busca semântica
GET /api/memory/recent — últimas memórias
POST /api/memory/forget-all — esquecer tudo
Frontend — Página Memories

Vista de perfil (core memory)
Busca semântica (input + resultados)
Timeline de memórias archival
Botão "esquecer tudo" (com confirmação dupla)
Sleep-time Compute

Job APScheduler diário às 3h
Letta consolida memórias longas
Pattern detection semanal
Entregável
Rocky tem memória útil, persistente e configurável
Frontend permite explorar memórias
"Esquecer tudo" funciona
Critérios de Aceitação
 Rocky lembra de coisas pessoais entre sessões
 Busca semântica retorna resultados relevantes (precision@10 > 70%)
 Bloco "Human" atualiza-se com observações
 Esquecer tudo apaga corretamente em <5s
 Sleep-time jobs correm sem afetar latência
22.8 Fase 6 — Casa Inteligente (3-4 dias)
Objetivos
Rocky controla devices físicos via Home Assistant.

Tarefas
Home Assistant Setup

Container HA configurado
Onboarding inicial (criar admin, configurar location)
Long-Lived Access Token gerado
Integração de Devices

Configurar pelo menos 1 lâmpada de teste
Adicionar via UI do HA (Hue, Yeelight, Tuya, etc.)
Verificar controlo direto via UI
Skill rocky-lights-skill

Custom skill OVOS que faz REST calls para HA
Intents: ligar, desligar, dim, mudar cor
Suporte a "lâmpadas da sala", "todas as lâmpadas", etc.
Skill rocky-scenes-skill

Ativar scenes do HA via voz
Cinema, Music, Sunset modes mapeados
Sensores Virtuais

Open-Meteo integration no HA
Open-Meteo Air Quality
Google Calendar
RSS feeds (Público, RTP, BBC)
Skill rocky-weather-skill

Lê dados de HA
Reformula com personalidade Rocky
Modos no Frontend

Cinema/Music/Sunset chamam HA scenes
Endpoint POST /api/protocols/{mode}/activate
Entregável
Rocky controla luzes por voz e texto
Cinema/Music/Sunset modes funcionais
Sensores virtuais acessíveis
Critérios de Aceitação
 "Rocky, turn on lights" funciona
 Cinema Mode dim luzes corretamente
 Sunset Mode automático ao pôr do sol
 Rocky reporta clima, qualidade do ar, eventos do calendário
 Notícias do dia disponíveis via skill
22.9 Fase 7 — Proatividade (3-4 dias)
Objetivos
Rocky toma iniciativa de forma natural e configurável.

Tarefas
APScheduler Setup

Configurado em app/workers/scheduler.py
Jobs persistentes em Postgres
Diary Writer Job

Roda diariamente às 23h
Lê conversas do dia
Letta gera entrada de diary
Guarda em SQLCipher + vector DB
Pattern Analyzer Job

Roda semanalmente domingo às 4h
Analisa padrões de uso
Atualiza bloco "Human" com observações
Notifica utilizador na próxima interação
Mood Check Job

Roda 1x/dia (configurável horário)
Trigger skill rocky-mood-skill
Níveis de Proatividade

Setting: silent / balanced / chatty
Silent: nunca interrompe
Balanced: 1-3 vezes/dia (eventos importantes)
Chatty: comenta padrões frequentemente
Notificações Push (Frontend)

Socket.io event notification:proactive
Toast no canto inferior
Som suave de notificação (opcional)
Configuração no Frontend

Página Settings com radio buttons para nível
Preview de exemplo de notificação
Entregável
Rocky escreve diary diariamente
Detecta padrões e comenta
Configurável quanta iniciativa toma
Critérios de Aceitação
 Diary diário gerado e visível
 Pattern detection encontra ≥1 padrão por semana
 Notificações respeitam nível configurado
 "Silent" não envia nenhuma notificação não solicitada
22.10 Fase 8 — Frontend Polish (1-2 semanas)
Objetivos
Frontend production-ready, instalável como PWA, com todas as features visuais.

Tarefas
Avatar Reativo do Rocky

Componente RockyAvatar.tsx
Forma geométrica (esfera, cubo abstrato, ou aranha estilizada)
Cor muda com estado emocional (ciano/laranja/roxo/verde/azul)
Animação de pulsação ao falar
Animação de "thinking" entre input e output
Tons musicais sintetizados em momentos especiais
Tabs Reorganizáveis no Dashboard

Biblioteca: dnd-kit
Tabs: Overview, Productivity, Home, Info, Personal, +
Drag-and-drop para reordenar
Persistência da ordem em localStorage + backend
Widgets Dinâmicos

Cada skill pode contribuir widget React
Widgets registados no skill manifest
Carregamento dinâmico no dashboard
PWA

manifest.json com icons, theme color, etc.
Service worker com Workbox
Cache estratégico (frontend assets, API responses)
Botão "Install App" no browser
Vista Terminal Alternativa

Toggle Settings entre "modern chat" e "terminal"
Terminal: monospace, prompt rocky@home:~$, output verde/ciano
Mantém scrollback
Páginas Novas

/skills (já feito na Fase 3, polish UX)
/memories (já feito na Fase 5, polish UX)
/settings — config completa
/stats — Year in Review
Year in Review

Endpoint GET /api/stats/year-in-review/{year}
Mostra:
Total de conversas
Tópicos mais falados
Skills mais usadas
Mood médio ao longo do ano
Memórias destacadas
Conquistas (intimacy milestones)
Animações Refinadas

Transições entre páginas
Animação dos modes (Cinema, Music, Sunset)
Glow effects em interações
Scanlines mais subtis
Entregável
Frontend production-ready
Instalável como PWA
Todas as páginas funcionais
Avatar reativo polido
Critérios de Aceitação
 PWA instalável em desktop e mobile
 Avatar muda visualmente com estado emocional
 Tabs reorganizáveis persistem ordem
 Year in Review mostra dados reais
 Vista terminal funcional
 Lighthouse score > 90 (performance, accessibility)
22.11 Fase 9 — Hardening (1 semana)
Objetivos
Sistema robusto, testado, com monitorização e backups.

Tarefas
Suite de Testes

Unit tests: lógica crítica (personalidade, processors)
Integration tests: pipeline completo de voz
E2E tests: user flows principais
Cobertura > 80% em app/rocky/
systemd Auto-start

Service file rocky.service
Inicia Docker Compose no boot
Restart automático se crashar
Logs em journald
Backup Automático

Script scripts/backup.sh
Cron job diário às 2h
Backup para /data/backups/
Inclui: Postgres dump, Qdrant snapshot, SQLCipher DB, configs
Retenção: 7 backups diários, 4 semanais, 12 mensais
Monitorização

Glances configurado e protegido por auth
Alertas via webhook (email opcional)
Health check endpoint usado por Docker
Logs centralizados em SQLCipher
Pre-commit Hooks

ruff (lint + format)
black
mypy
pytest --quick
Não permite commit se falhar
Documentação Completa

docs/ARCHITECTURE.md finalizado
docs/PERSONALITY.md completo
docs/SKILLS_DEVELOPMENT.md (como criar skill)
docs/DEPLOYMENT.md (passo-a-passo)
docs/API_REFERENCE.md (auto-gerado de OpenAPI)
docs/TROUBLESHOOTING.md
CI Local

Makefile com target make ci
Roda lint + tests + build
Watchtower (opcional)

Auto-update de containers (com cuidado)
Apenas para containers não críticos
Entregável
Sistema 24/7 estável
Testes verdes
Backups funcionais
Documentação completa
Critérios de Aceitação
 Reboot recupera sistema sem intervenção
 Backups criados automaticamente
 Restore de backup testado e funciona
 Cobertura de testes > 80% em código crítico
 Documentação suficiente para outro dev entender
22.12 Fase 10 — Publicação (Opcional, 3-4 dias)
Objetivos
Tornar o projeto público e atrativo para a comunidade.

Tarefas
Limpeza de Código

Remover credenciais hardcoded
Remover comentários TODO antigos
Refactor de zonas confusas
Code review final
README Atrativo

Hero image / GIF demo
Tagline impactante
Features destacadas
Quick start (3 comandos)
Screenshots do frontend
Tech stack badges
Link para docs
Licença

MIT ou Apache 2.0 (sugestão: MIT)
Adicionar LICENSE no root
Headers em ficheiros principais
Screenshots e GIFs

Dashboard cyberpunk
Avatar reativo
Page de skills
Memories page
Demo de conversação por voz (GIF)
Issue Templates

Bug report
Feature request
Skill proposal
Contributing Guide

Como contribuir
Style guide
PR process
Roadmap Público

GitHub Projects ou Issues
Milestones futuras
Promoção (opcional)

Post em r/selfhosted, r/HomeAssistant
Hacker News
Twitter/X com hashtags relevantes
Entregável
Projeto público no GitHub
Pronto para forks e contribuições
23. RISCOS E MITIGAÇÕES
23.1 Riscos Técnicos
Risco	Probabilidade	Impacto	Mitigação
Pipecat tem learning curve significativo	Média	Médio	Documentação excelente da Daily.co; fazer prova de conceito cedo
OVOS skills antigas com bugs	Média	Baixo	Adaptar apenas skills mantidas (>2024); fork se necessário
Letta ainda em desenvolvimento ativo	Alta	Médio	Pin version específica; backup regular do Postgres
LiteLLM quota tracking imperfeito	Baixa	Médio	Configurar quotas conservadoras; fallback robusto
Hardware insuficiente (latência alta)	Alta	Alto	Stack otimizada para CPU; APIs cloud para pesado
APIs gratuitas mudam termos	Média	Alto	LiteLLM permite trocar provider em 1 linha YAML
Pipecat consome muita RAM	Média	Médio	Monitorizar; usar workers em vez de threads
Frontend incompatibilidade Socket.io	Baixa	Crítico	python-socketio é 100% compatível; testar na Fase 1
HA pesado para o servidor	Média	Médio	Container limitado a 1GB RAM; podemos desativar features
Complexidade de orquestração	Alta	Médio	Docker Compose + Makefile com comandos comuns
Conflitos de portas entre serviços	Média	Baixo	Documentar portas no compose; usar redes Docker
Vector DB lento em HDD	Alta	Médio	Cache agressivo em Redis; batch operations
23.2 Riscos de Produto
Risco	Probabilidade	Impacto	Mitigação
Personalidade Rocky inconsistente	Média	Alto	PERSONALITY.md como source of truth; testes em prompts
Easter eggs forçados/cringe	Média	Médio	Triggers contextuais; não usar em todas as frases
Latência percebida demasiado alta	Média	Alto	Streaming everywhere; visualizador animado durante espera
Wake word não funciona bem	Alta	Médio	Treinar com >100 samples; threshold configurável
Memória "lembra coisas erradas"	Média	Alto	Letta com importance scoring; review periódico
Skills não fazem o que o utilizador quer	Média	Médio	Padatious + Adapt em paralelo; fallback para LLM puro
Visualizador áudio dessincronizado	Baixa	Baixo	Frontend recebe áudio em chunks com timestamps
23.3 Riscos Operacionais
Risco	Probabilidade	Impacto	Mitigação
Internet cai	Alta	Médio	Modo offline com Ollama + Vosk; degradação graciosa
API keys vazadas	Baixa	Alto	.env com chmod 0600; secrets manager (futuro)
Disco enche	Média	Alto	Glances alerts; rotação de logs; backup com retenção
RAM esgota	Média	Alto	Container limits; swap configurado
HDD falha	Média	Crítico	Backups regulares; preparar SSD migration plan
Energia falha	Média	Médio	UPS opcional; sistema reinicia automaticamente
Configuração corrompida	Baixa	Alto	Configs em git; restore rápido
24. APÊNDICES
24.1 Glossário
Termo	Definição
Pipecat	Framework de pipeline de voz conversacional
OVOS	OpenVoiceOS, sistema de skills (fork de Mycroft)
Letta	Framework de agentes com memória (ex-MemGPT)
LiteLLM	Gateway universal para 100+ providers LLM
NIM	NVIDIA Inference Microservices (LLMs hosted)
VAD	Voice Activity Detection
STT	Speech-to-Text
TTS	Text-to-Speech
Wake word	Palavra/frase que ativa o assistente ("Hey Rocky")
Barge-in	Capacidade de interromper o assistente a falar
HA	Home Assistant
MQTT	Message Queuing Telemetry Transport (protocolo IoT)
PWA	Progressive Web App (instalável como app)
JWT	JSON Web Token (autenticação)
ASGI	Asynchronous Server Gateway Interface
ONNX	Open Neural Network Exchange (formato de modelo otimizado)
Quantização	Redução de precisão de modelo (int8) para acelerar
Embeddings	Representação vetorial de texto
RAG	Retrieval-Augmented Generation
24.2 Referências
Universo Project Hail Mary
Livro: "Project Hail Mary" (Andy Weir, 2021)
Personagem Rocky: engenheiro alienígena de Erid (sistema 40 Eridani)
Conceitos: Astrophage, Taumoeba, Xenonita, Beetles (nave)
Frameworks
Pipecat: https://github.com/daily-co/pipecat
OVOS: https://github.com/OpenVoiceOS
Letta: https://github.com/cpacker/MemGPT
LiteLLM: https://github.com/BerriAI/litellm
Home Assistant: https://www.home-assistant.io
FastAPI: https://fastapi.tiangolo.com
Granian: https://github.com/emmett-framework/granian
Modelos
Whisper: https://github.com/openai/whisper
Kokoro: https://github.com/rhasspy/kokoro
Vosk: https://alphacephei.com/vosk
openWakeWord: https://github.com/dscripka/openWakeWord
SpeechBrain: https://speechbrain.github.io
BGE-M3: https://huggingface.co/BAAI/bge-m3
Phi-3: https://huggingface.co/microsoft/Phi-3-mini-4k-instruct
APIs Gratuitas
Groq: https://console.groq.com
NVIDIA NIM: https://build.nvidia.com
Google Gemini: https://aistudio.google.com
Open-Meteo: https://open-meteo.com
DuckDNS: https://www.duckdns.org
24.3 Variáveis de Ambiente
Lista completa de variáveis necessárias em .env:

text
# ═══════════════ APIS LLM ═══════════════
GROQ_API_KEY=
NVIDIA_API_KEY=
GEMINI_API_KEY=

# ═══════════════ INFRA ═══════════════
DUCKDNS_TOKEN=
DUCKDNS_DOMAIN=projecthailrocky.duckdns.org
LETSENCRYPT_EMAIL=

# ═══════════════ DATABASE ═══════════════
POSTGRES_USER=letta
POSTGRES_PASSWORD=  # gerar forte
POSTGRES_DB=letta
LETTA_PG_URI=postgresql://letta:${POSTGRES_PASSWORD}@postgres/letta

# ═══════════════ REDIS ═══════════════
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=  # gerar forte

# ═══════════════ AUTH ═══════════════
JWT_SECRET_KEY=  # gerar forte (>32 chars)
JWT_ALGORITHM=HS256
JWT_ACCESS_TOKEN_EXPIRE_MINUTES=60
JWT_REFRESH_TOKEN_EXPIRE_DAYS=7
ADMIN_USERNAME=
ADMIN_PASSWORD=  # gerar forte

# ═══════════════ ENCRYPTION ═══════════════
SQLCIPHER_KEY=  # gerar forte

# ═══════════════ HOME ASSISTANT ═══════════════
HA_URL=http://homeassistant:8123
HA_TOKEN=  # Long-Lived Access Token

# ═══════════════ GOOGLE CALENDAR ═══════════════
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# ═══════════════ LOCATION ═══════════════
LOCATION_LAT=
LOCATION_LON=
LOCATION_TIMEZONE=Europe/Lisbon

# ═══════════════ ROCKY ═══════════════
ROCKY_DEFAULT_LANGUAGE=pt
ROCKY_PROACTIVITY_LEVEL=balanced  # silent | balanced | chatty
ROCKY_WAKE_WORD_ENABLED=true
ROCKY_DEFAULT_VOICE=rocky-en
24.4 Portas dos Serviços
Serviço	Porta Interna	Porta Externa	Protocolo
Nginx	80, 443	80, 443	HTTP/HTTPS
FastAPI (rocky-api)	8080	—	HTTP
Pipecat	8765	—	WebSocket
LiteLLM	4000	—	HTTP
Letta	8283	—	HTTP
OVOS messagebus	8181	—	WebSocket
Home Assistant	8123	—	HTTP (proxied)
Mosquitto	1883, 8883	—	MQTT
Redis	6379	—	Redis protocol
Qdrant	6333, 6334	—	HTTP/gRPC
Postgres	5432	—	Postgres
Ollama	11434	—	HTTP
Glances	61208	—	HTTP (proxied)
24.5 Próximos Passos Imediatos
Antes de arrancar a implementação, confirma:

OS no Optiplex: Ubuntu Server 22.04 LTS?
Subdomínio DuckDNS: que nome queres? (ex: projecthailrocky.duckdns.org)
Localização: que cidade? (para clima e sunset automático)
Repositório: GitHub privado, GitLab, ou Gitea self-hosted?
Por onde começar a executar:
🅰️ Fase 0 (preparar servidor)
🅱️ PERSONALITY.md primeiro (definir Rocky a fundo)
🅲 Prova de conceito mínima (FastAPI + Socket.io + LiteLLM)
📋 RESUMO EXECUTIVO
Project Hail Rocky é um assistente residencial inteligente único, construído com:

✅ Frontend React/TS existente (preservado, com adições mínimas)
✅ Backend Python (FastAPI + Granian) substitui Node.js
✅ Comunicação Socket.io mantida (compatibilidade total)
✅ Frameworks maduros (Pipecat, OVOS, Letta, LiteLLM, Home Assistant)
✅ APIs gratuitas (Groq, NVIDIA NIM, Gemini, Ollama offline)
✅ Privacidade total (memórias e dados em casa, encriptados)
✅ Personalidade rica do Rocky de Project Hail Mary
✅ Sistema de skills plugável com 200+ disponíveis no marketplace
✅ Performance otimizada para hardware modesto (Optiplex 3040 i3 12GB)
Diferencial: Rocky é uma personagem viva, não um chatbot genérico. Cada interação reforça a imersão no universo Project Hail Mary.

Filosofia: "Integrate, Don't Build. Orchestrate, Don't Reinvent."

Tempo até MVP:

Hobby (5h/sem): 3-4 meses
Sério (15h/sem): 6-8 semanas
Intenso (30h/sem): 3-4 semanas
Custo recorrente: 0€/mês (free tiers + hardware próprio)

"Yes, human. Together we build. Amaze." 🛸

Documento de Visão Master v2.0
Project Hail Rocky
Maio 2026
Estado: Aprovado para Implementação — Opção A Confirmada



