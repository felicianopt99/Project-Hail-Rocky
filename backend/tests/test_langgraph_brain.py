import asyncio
import os
import sys

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from app.rocky.graph.workflow import rocky_brain_graph
from langchain_core.messages import HumanMessage
from app.config import settings

async def test_graph():
    print("Testing Rocky LangGraph Brain...")
    
    # Ensure we are in a mock/test mode for Letta if possible
    # For now, we assume Letta is running or we gracefully handle failure
    
    initial_state = {
        "messages": [HumanMessage(content="Hello Rocky! How are you today?")],
        "sid": "test_session",
        "tools_called": []
    }
    
    print("\n--- Starting Stream ---")
    async for event in rocky_brain_graph.astream_events(initial_state, version="v1"):
        kind = event["event"]
        if kind == "on_chat_model_stream":
            content = event["data"]["chunk"].content
            if content:
                print(content, end="", flush=True)
        elif kind == "on_tool_start":
            print(f"\n[Tool Start: {event['name']}]")
        elif kind == "on_tool_end":
            print(f"\n[Tool End: {event['name']}]")
            
    print("\n--- Stream Finished ---\n")

if __name__ == "__main__":
    # You might need to set API keys here if not in .env
    asyncio.run(test_graph())
