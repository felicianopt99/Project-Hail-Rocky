"""Voice Engine Service — Unified pipeline for synthesis and audio effects.

Architecture (2026):
  Backend → (HTTP) → This service (Consolidated Engine)
  
  Pipeline: Text → DisfluencyInjector → Kokoro-ONNX → VoiceEffectsProcessor → Audio output
"""
import os
import asyncio
import httpx
import numpy as np
import structlog
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from kokoro_onnx import Kokoro

def setup_logging():
    structlog.configure(
        processors=[
            structlog.contextvars.inject_contextvars,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.stdlib.add_log_level,
            structlog.processors.JSONRenderer() if os.getenv("LOG_FORMAT") == "JSON" else structlog.dev.ConsoleRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

setup_logging()
log = structlog.get_logger()

from .processors.voice_effects import VoiceEffectsProcessor, SAMPLE_RATE
from .processors.disfluency import DisfluencyInjector
from .pipeline import run_voice_pipeline

# Config
MODELS_DIR = os.getenv("MODELS_DIR", "/models")
DEFAULT_VOICE = os.getenv("VOICE_ENGINE_DEFAULT_VOICE", "am_michael")
# Model paths for Kokoro-ONNX
MODEL_PATH = os.path.join(MODELS_DIR, "kokoro-v1.0.onnx")
VOICES_PATH = os.path.join(MODELS_DIR, "voices-v1.0.bin")

# Global instances
_kokoro: Kokoro | None = None
_disfluency = DisfluencyInjector(probability=0.2, min_length=60)

async def download_models_if_missing():
    """Download Kokoro-ONNX models if not present in volume."""
    files = {
        "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
        "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
    }
    os.makedirs(MODELS_DIR, exist_ok=True)
    
    async with httpx.AsyncClient(follow_redirects=True, timeout=300.0) as client:
        for name, url in files.items():
            path = os.path.join(MODELS_DIR, name)
            if not os.path.exists(path):
                log.info("downloading_model", name=name, url=url)
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    # Use a thread for file writing to avoid blocking the event loop
                    def save_to_file():
                        with open(path, "wb") as f:
                            for chunk in response.iter_bytes():
                                f.write(chunk)
                    await asyncio.to_thread(save_to_file)
                log.info("download_complete", name=name)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _kokoro
    try:
        await download_models_if_missing()
        _kokoro = Kokoro(MODEL_PATH, VOICES_PATH)
        log.info("voice_engine_ready", model=MODEL_PATH)
    except Exception as e:
        log.error("voice_engine_init_failed", error=str(e))
    yield

app = FastAPI(title="Rocky Voice Engine", version="1.0.0", lifespan=lifespan)

class SynthRequest(BaseModel):
    text: str
    emotional_state: str = "neutral"
    voice: str = DEFAULT_VOICE
    speed: float = 1.0
    lang: str = "en" # Default to en for Rocky's primary locale

LANG_MAP = {
    "en": "a",      # Default to American English
    "en-us": "a",
    "en-gb": "b",
    "pt": "p",      # Portuguese (Brazilian/European depending on model, usually 'p' for Kokoro)
    "pt-br": "p"
}

@app.websocket("/voice")
async def voice_websocket(websocket: WebSocket):
    await websocket.accept()
    if _kokoro is None:
        log.error("voice_websocket_failed_engine_not_ready")
        await websocket.close(code=1011) # Internal error
        return
    log.info("voice_websocket_accepted", params=dict(websocket.query_params))
    # Extract initial settings from query params
    emotional_state = websocket.query_params.get("state", "neutral")
    sid = websocket.query_params.get("sid", "default")
    trace_id = websocket.query_params.get("trace_id", "unknown")
    
    structlog.contextvars.bind_contextvars(trace_id=trace_id, sid=sid)
    
    try:
        # Run Pipecat pipeline
        await run_voice_pipeline(websocket, sid=sid, emotional_state=emotional_state)
    except WebSocketDisconnect:
        log.info("voice_websocket_disconnected")
    except Exception as e:
        log.error("voice_pipeline_error", error=str(e))
    finally:
        try:
            await websocket.close()
        except:
            pass

@app.post("/synthesize")
async def synthesize(req: SynthRequest):
    """Text → FX → PCM audio stream (Legacy)."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    if _kokoro is None:
        raise HTTPException(status_code=503, detail="Voice engine not initialized")

    # For legacy HTTP, we use a simple text-based disfluency (synchronous-like)
    # We can't easily use the FrameProcessor version here without mocking frames
    text = req.text # Simplified for now
    
    fx = VoiceEffectsProcessor(emotional_state=req.emotional_state, sample_rate=SAMPLE_RATE)

    async def generate():
        # Map language codes to what espeak-ng/tokenizer expects
        # kokoro-onnx tokenizer also handles 'a' for American English, etc.
        mapped_lang = LANG_MAP.get(req.lang, req.lang)
        
        try:
            stream = _kokoro.create_stream(text, voice=req.voice, speed=req.speed, lang=mapped_lang)
            buffer = []
            chunk_threshold = 8192
            for samples, rate in stream:
                if samples is not None and len(samples) > 0:
                    processed = fx.apply_to_float(samples)
                    buffer.append(processed)
                    current_size = sum(len(s) for s in buffer)
                    if current_size >= chunk_threshold:
                        combined = np.concatenate(buffer)
                        yield (np.clip(combined, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
                        buffer = []
            if buffer:
                combined = np.concatenate(buffer)
                yield (np.clip(combined, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
        except Exception as e:
            log.error("synthesis_stream_error", error=str(e), text=text[:50])
            # Don't yield anything more, just close the stream

    return StreamingResponse(generate(), media_type="application/octet-stream")

@app.get("/health")
async def health():
    return {
        "status": "ok" if _kokoro else "error",
        "stt_configured": bool(os.getenv("GROQ_API_KEY")),
        "engine": "Kokoro-ONNX",
        "sample_rate": SAMPLE_RATE,
        "version": "1.0.0"
    }
