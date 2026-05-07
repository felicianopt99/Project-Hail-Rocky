import asyncio
import socketio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.logging import setup_logging
from .api import dashboard, socketio_handlers, auth, skills, settings_api, speaker, memory, brain, webrtc, system
from .config import settings
from .workers.scheduler import setup as setup_scheduler, shutdown as shutdown_scheduler
from .core.http_client import AsyncHTTPClient
import structlog

setup_logging()
log = structlog.get_logger(__name__)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[
        settings.frontend_url,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    logger=True,
    engineio_logger=True,
)

socketio_handlers.register(sio)
webrtc.set_sio(sio)


from .core.semantic_cache import semantic_cache


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker = setup_scheduler()
    # Start worker in the background
    worker_task = asyncio.create_task(worker.start())
    
    yield
    
    # Graceful shutdown
    log.info("application_shutdown_started")
    await worker.stop()
    await shutdown_scheduler()
    await semantic_cache.close()
    await AsyncHTTPClient.close_client()
    
    try:
        await asyncio.wait_for(worker_task, timeout=5.0)
    except asyncio.TimeoutError:
        log.warning("worker_shutdown_timeout")
    except Exception as e:
        log.error("worker_shutdown_error", error=str(e))
    
    log.info("application_shutdown_complete")


fastapi_app = FastAPI(
    title="Rocky Backend",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_url,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

fastapi_app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
fastapi_app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
fastapi_app.include_router(skills.router, prefix="/api/skills", tags=["skills"])
fastapi_app.include_router(settings_api.router, prefix="/api/settings", tags=["settings"])
fastapi_app.include_router(speaker.router, prefix="/api/speaker/profiles", tags=["speaker"])
fastapi_app.include_router(memory.router, prefix="/api/memory", tags=["memory"])
fastapi_app.include_router(brain.router, prefix="/api/brain", tags=["brain"])
fastapi_app.include_router(webrtc.router, prefix="/api/webrtc", tags=["webrtc"])
fastapi_app.include_router(system.router, prefix="/api/system", tags=["system"])


@fastapi_app.get("/api/health")
async def health():
    return {"status": "ok", "service": "rocky-backend", "version": "0.1.0"}


app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
