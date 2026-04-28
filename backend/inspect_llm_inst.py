try:
    from vision_agents.core.llm.llm import LLM
    class TestLLM(LLM):
        async def simple_response(self, text, participant=None): return None
    llm = TestLLM()
    print(f"LLM instance has events: {hasattr(llm, 'events')}")
except Exception as e:
    print(f"Error: {e}")
