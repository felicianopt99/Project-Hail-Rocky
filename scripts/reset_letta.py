import asyncio
import os
import sys

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from app.bridges import letta_bridge
from app.config import settings

async def reset():
    print(f"Connecting to Letta at {settings.letta_url}...")
    if await letta_bridge.is_available():
        print("Letta is available. Resetting agent...")
        success = await letta_bridge.forget_all()
        if success:
            print("Agent reset successfully. New configuration will be applied on next message.")
        else:
            print("Failed to reset agent.")
    else:
        print("Letta is not available.")

if __name__ == "__main__":
    asyncio.run(reset())
