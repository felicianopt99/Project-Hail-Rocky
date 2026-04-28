import asyncio
import os
import logging
from dotenv import load_dotenv

# Mocking some parts if needed, but we can try to import
try:
    from app.core.config import settings
    from app.core.vision_agents_extensions import GeminiLLM, OllamaLLM, FallbackLLM
    from vision_agents.plugins import nvidia
except ImportError as e:
    print(f"Import error: {e}")
    exit(1)

logging.basicConfig(level=logging.INFO)
load_dotenv()

async def test_llms():
    llm_chain = []
    
    if settings.NVIDIA_API_KEY:
        print("Testing NVIDIA...")
        try:
            nv_llm = nvidia.VLM(model=settings.NVIDIA_LLM_MODEL, api_key=settings.NVIDIA_API_KEY)
            llm_chain.append(nv_llm)
        except Exception as e:
            print(f"NVIDIA init failed: {e}")
    
    if settings.GEMINI_API_KEY:
        print("Testing Gemini...")
        try:
            gem_llm = GeminiLLM(api_key=settings.GEMINI_API_KEY, model=settings.GEMINI_MODEL)
            llm_chain.append(gem_llm)
        except Exception as e:
            print(f"Gemini init failed: {e}")

    llm = FallbackLLM(llm_chain)
    
    print("\nAttempting generate call...")
    try:
        # Agent.chat calls generate
        # Let's see if generate is supported
        response = await llm.generate("Hello Rocky, are you there?")
        print(f"Generate Success: {response.text}")
    except Exception as e:
        print(f"Generate Failed: {e}")
        
    print("\nAttempting simple_call...")
    try:
        response = await llm.simple_response("Hello Rocky, are you there?")
        print(f"Simple Success: {response.text}")
    except Exception as e:
        print(f"Simple Failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_llms())
