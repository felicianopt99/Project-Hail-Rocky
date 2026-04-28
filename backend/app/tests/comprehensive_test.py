import asyncio
import os
import sys
import logging
import httpx
from dotenv import load_dotenv

# Set PYTHONPATH to include backend
sys.path.append(os.path.join(os.getcwd(), "backend"))

from app.core.config import settings
from app.core.vision_agents_extensions import GeminiLLM, OllamaLLM, FallbackLLM, KokoroTTS, WyomingWakeWord
from vision_agents.plugins import nvidia
from app.db.session import init_db, close_db
from app.db import services as db_service
from app.skills.weather import get_weather

logging.basicConfig(level=logging.INFO, format="[TEST] %(message)s")
logger = logging.getLogger("TestBattery")

load_dotenv()

async def test_llm_chain():
    logger.info("--- Testing LLM Chain ---")
    llm_chain = []
    
    # 1. NVIDIA
    if settings.NVIDIA_API_KEY:
        try:
            nv = nvidia.VLM(model=settings.NVIDIA_LLM_MODEL, api_key=settings.NVIDIA_API_KEY)
            res = await nv.simple_response("Say 'NVIDIA OK'")
            logger.info(f"NVIDIA NIM: OK (Response: {res.text})")
            llm_chain.append(nv)
        except Exception as e:
            logger.error(f"NVIDIA NIM: FAILED ({e})")
    
    # 2. Gemini
    if settings.GEMINI_API_KEY:
        try:
            gem = GeminiLLM(api_key=settings.GEMINI_API_KEY, model=settings.GEMINI_MODEL)
            res = await gem.simple_response("Say 'Gemini OK'")
            logger.info(f"Google Gemini: OK (Response: {res.text})")
            llm_chain.append(gem)
        except Exception as e:
            logger.error(f"Google Gemini: FAILED ({e})")
            
    # 3. Ollama
    try:
        oll = OllamaLLM(base_url=settings.OLLAMA_BASE_URL, model=settings.LOCAL_LLM_MODEL)
        # Short timeout for local test
        res = await asyncio.wait_for(oll.simple_response("Say 'Ollama OK'"), timeout=10.0)
        logger.info(f"Ollama Local: OK (Response: {res.text})")
        llm_chain.append(oll)
    except Exception as e:
        logger.warning(f"Ollama Local: SKIPPED/FAILED ({e}) - Check if Ollama is running")

    return llm_chain

async def test_stt_tts():
    logger.info("--- Testing Voice Services ---")
    
    # TTS: Kokoro
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{settings.KOKORO_URL}/health", timeout=5.0)
            if res.status_code == 200:
                logger.info("Kokoro TTS: OK (Service is up)")
            else:
                logger.error(f"Kokoro TTS: FAILED (Status {res.status_code})")
    except Exception as e:
        logger.error(f"Kokoro TTS: FAILED ({e})")

    # Wake Word: Wyoming
    try:
        ww = WyomingWakeWord(host="127.0.0.1", port=10400)
        # Attempt connection
        reader, writer = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", 10400), timeout=2.0)
        writer.close()
        await writer.wait_closed()
        logger.info("Wyoming Wake Word Service: OK (Port 10400 accessible)")
    except Exception as e:
        logger.error(f"Wyoming Wake Word Service: FAILED ({e})")

async def test_database():
    logger.info("--- Testing Database ---")
    try:
        await init_db()
        await db_service.save_message("system", "Test battery initiated. Amaze!")
        messages = await db_service.get_messages(limit=1)
        if messages:
            logger.info(f"Database (Prisma/SQLite): OK (Latest message: {messages[0]['text']})")
        await close_db()
    except Exception as e:
        logger.error(f"Database: FAILED ({e})")

async def test_skills():
    logger.info("--- Testing Skills ---")
    # Weather
    try:
        weather = await get_weather()
        logger.info(f"Weather Skill: OK ({weather})")
    except Exception as e:
        logger.error(f"Weather Skill: FAILED ({e})")

    # HA Connection
    if settings.HA_BASE_URL:
        try:
            async with httpx.AsyncClient() as client:
                headers = {"Authorization": f"Bearer {settings.HA_ACCESS_TOKEN}"}
                res = await client.get(f"{settings.HA_BASE_URL}/api/", headers=headers, timeout=5.0)
                if res.status_code == 200:
                    logger.info("Home Assistant API: OK")
                else:
                    logger.error(f"Home Assistant API: FAILED (Status {res.status_code})")
        except Exception as e:
            logger.error(f"Home Assistant API: FAILED ({e})")

async def run_all_tests():
    logger.info("==========================================")
    logger.info("   ROCKY COMPREHENSIVE TEST BATTERY      ")
    logger.info("==========================================")
    
    await test_database()
    await test_llm_chain()
    await test_stt_tts()
    await test_skills()
    
    logger.info("==========================================")
    logger.info("   TESTS COMPLETED. Fist-bump! 👊         ")
    logger.info("==========================================")

if __name__ == "__main__":
    asyncio.run(run_all_tests())
