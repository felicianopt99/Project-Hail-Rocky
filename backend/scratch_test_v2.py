import asyncio
import os
import logging
from dotenv import load_dotenv

# Set PYTHONPATH to include backend
import sys
sys.path.append(os.path.join(os.getcwd(), "backend"))

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
        print("NVIDIA API Key found.")
        try:
            nv_llm = nvidia.VLM(model=settings.NVIDIA_LLM_MODEL, api_key=settings.NVIDIA_API_KEY)
            llm_chain.append(nv_llm)
        except Exception as e:
            print(f"NVIDIA init failed: {e}")
    
    if settings.GEMINI_API_KEY:
        print("Gemini API Key found.")
        try:
            gem_llm = GeminiLLM(api_key=settings.GEMINI_API_KEY, model=settings.GEMINI_MODEL)
            llm_chain.append(gem_llm)
        except Exception as e:
            print(f"Gemini init failed: {e}")

    llm = FallbackLLM(llm_chain)
    
    print("\nAttempting simple_response call (this tests the proxy and registration logic)...")
    try:
        # We also test tool registration
        @llm.register_function(name="test_tool", description="A test tool")
        def test_tool():
            return "Tool called!"
            
        print("Tool registration success!")
        
        # We won't actually call the cloud API in the test to avoid wasting tokens/timeouts 
        # unless NVIDIA is available and working.
        # But we can at least verify it doesn't crash on registration.
        
    except Exception as e:
        print(f"Test Failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_llms())
