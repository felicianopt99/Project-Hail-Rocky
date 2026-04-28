import logging
import asyncio
import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Vision Agents
from vision_agents.core import Agent, User
from vision_agents.core.edge.types import Participant
from vision_agents.plugins import nvidia
from vision_agents.core.stt.events import STTTranscriptEvent
from vision_agents.core.llm.events import LLMResponseChunkEvent
from vision_agents.core.tts.events import TTSAudioEvent, TTSSynthesisStartEvent
from vision_agents.core.turn_detection.events import TurnStartedEvent, TurnEndedEvent
from vision_agents.core.edge.events import AudioReceivedEvent
from getstream.video.rtc import PcmData

# Custom Extensions
from app.core.edge_dummy import DummyEdge
from app.core.vision_agents_extensions import LocalWhisperSTT, KokoroTTS, FallbackLLM, GeminiLLM, OllamaLLM, WyomingWakeWord

# App Modules
from app.core.config import settings
from app.db.session import init_db, close_db
from app.db import services as db_service
from app.api.socket_server import sio
from app.services.state_manager import state_manager

# Skills
from app.skills.home_assistant import light_control
from app.skills.system import get_system_status
from app.skills.weather import get_weather

# Configure logging with character flavor
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - [ROCKY] %(message)s"
)
logger = logging.getLogger("RockyBackend")

load_dotenv()

app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Should be restricted in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Socket.io ASGI app
sio_app = socketio.ASGIApp(sio, other_asgi_app=app)

# Global Agent Instance
agent = None
ww_detector = None

async def init_agent():
    global agent
    logger.info("Initializing Eridian Intelligence... Question?")
    
    # Initialize components
    edge = DummyEdge()
    stt = LocalWhisperSTT(model_size=settings.WHISPER_MODEL)
    tts = KokoroTTS(url=settings.KOKORO_URL)
    
    # Initialize LLM Fallback Chain (NVIDIA -> Gemini -> Ollama)
    llm_chain = []
    
    if settings.NVIDIA_API_KEY:
        logger.info("Adding NVIDIA NIM to intelligence chain...")
        llm_chain.append(nvidia.VLM(model=settings.NVIDIA_LLM_MODEL, api_key=settings.NVIDIA_API_KEY))
    
    if settings.GEMINI_API_KEY:
        logger.info("Adding Gemini to intelligence chain...")
        llm_chain.append(GeminiLLM(api_key=settings.GEMINI_API_KEY, model=settings.GEMINI_MODEL))
        
    logger.info("Adding Ollama as local backup...")
    llm_chain.append(OllamaLLM(base_url=settings.OLLAMA_BASE_URL, model=settings.LOCAL_LLM_MODEL))
    
    llm = FallbackLLM(llm_chain)
    
    # Register tools with the LLM chain
    tools = [light_control, get_system_status, get_weather]
    for t in tools:
        llm.register_function()(t)

    agent = Agent(
        edge=edge,
        llm=llm,
        agent_user=User(id="rocky", name="Rocky"),
        instructions=settings.ROCKY_SYSTEM_PROMPT,
        stt=stt,
        tts=tts
    )

    # Initialize Wake Word Detector
    global ww_detector
    ww_detector = WyomingWakeWord(host="127.0.0.1", port=10400)
    await ww_detector.connect()
    
    # Enable turn detection for voice mode
    # Headless mode: initialize event loop for audio without agent.join()
    await stt.start()
    agent._call_ended_event = asyncio.Event()
    asyncio.create_task(agent._consume_incoming_audio())
    logger.info("Headless audio consumer task started.")

    
    # Event Subscriptions
    @agent.events.subscribe
    async def handle_transcript(event: STTTranscriptEvent):
        await sio.emit("transcript_result", event.text)

    @agent.events.subscribe
    async def handle_llm_token(event: LLMResponseChunkEvent):
        if event.delta:
            await sio.emit("chat_token", event.delta)

    @agent.events.subscribe
    async def handle_audio_chunk(event: TTSAudioEvent):
        if event.data:
            await sio.emit("tts_chunk", event.data.to_bytes())
        if event.is_final_chunk:
            await sio.emit("status_update", "idle")
            await sio.emit("tts_end")

    @agent.events.subscribe
    async def handle_turn_started(event: TurnStartedEvent):
        await sio.emit("status_update", "listening")

    @agent.events.subscribe
    async def handle_turn_ended(event: TurnEndedEvent):
        await sio.emit("status_update", "thinking_llm")

    @agent.events.subscribe
    async def handle_tts_synthesis_start(event: TTSSynthesisStartEvent):
        await sio.emit("status_update", "synthesizing_tts")
        await sio.emit("tts_start", {"sampleRate": 24000})

@app.on_event("startup")
async def startup_event():
    logger.info("[STARTUP] Starting initialization...")
    await init_db()
    logger.info("[STARTUP] DB initialized")
    await state_manager.start()
    logger.info("[STARTUP] State manager started")
    await init_agent()
    logger.info("[STARTUP] Agent initialized, checking state...")
    if agent:
        logger.info(f"[STARTUP] ✓ Agent ready: {agent}")
        logger.info(f"[STARTUP] ✓ Queues: {list(agent._participant_queues.keys())}")
    else:
        logger.error("[STARTUP] ✗ Agent is NONE!")
    logger.info("Rocky Unified Backend is READY. Amaze! Fist-bump!")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down... Sleep time, Friend.")
    await state_manager.stop()
    await close_db()
    if agent:
        await agent.close()
    if ww_detector:
        await ww_detector.close()

# Socket.io event for audio streaming
audio_chunk_count = 0

@sio.on("audio_chunk")
async def handle_audio_chunk_sio(sid, data):
    global audio_chunk_count
    audio_chunk_count += 1

    if audio_chunk_count == 1:
        logger.info(f"[AUDIO] FIRST CHUNK RECEIVED - {len(data)} bytes")
    elif audio_chunk_count % 20 == 0:
        logger.info(f"[AUDIO] Chunk #{audio_chunk_count} ({len(data)} bytes), queues: {list(agent._participant_queues.keys()) if agent else 'N/A'}")

    if not agent:
        logger.error(f"[AUDIO] Agent is NONE! Cannot process audio")
        return {"success": False, "error": "Agent not initialized"}

    user_participant = Participant(original=None, user_id="user", id="user-1")

    # Send to Vision Agents audio pipeline via edge events
    try:
        agent.edge.events.send(AudioReceivedEvent(pcm_data=PcmData.from_bytes(data), participant=user_participant))
    except Exception as e:
        logger.error(f"[AUDIO] Error sending to agent.edge: {e}")

    # Send to Wyoming for Wake Word detection (separate path)
    if ww_detector and ww_detector._connected:
        await ww_detector.send_audio(data)

    return {"success": True}

@sio.on("chat_request")
async def handle_chat_request(sid, data):
    content = data.get("content")
    if agent and content:
        logger.info(f"Chat request from {sid}: {content}")
        await db_service.save_message("user", content)
        # In 0.5.5, we use agent.chat which handles event emissions automatically
        # if subscriptions are set up. If simple_response is used, ensure it triggers events.
        try:
            await sio.emit("status_update", "thinking_llm")
            await agent.simple_response(content)
            return {"success": True}
        except Exception as e:
            logger.error(f"Chat execution failed: {e}")
            await sio.emit("chat_response", {"text": "Bad math! My neural circuits are scrambled. Fist-bump?"})
            return {"success": False, "error": str(e)}

@sio.on("interrupt")
async def handle_interrupt(sid):
    if agent:
        if hasattr(agent.llm, "interrupt"):
            await agent.llm.interrupt()
        if agent.tts and hasattr(agent.tts, "interrupt"):
            await agent.tts.interrupt()

@app.get("/health")
async def health():
    return {
        "status": "ok", 
        "message": "Rocky is watching the pipes. Amaze!",
        "version": "2.0.0-pro"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(sio_app, host="0.0.0.0", port=8000)
