import inspect
try:
    from vision_agents.core.llm.llm import LLM
    print(f"LLM methods: {[m for m in dir(LLM) if not m.startswith('_')]}")
    # Check if 'generate' is in LLM
    print(f"Has generate: {'generate' in dir(LLM)}")
    print(f"Has function_registry: {'function_registry' in dir(LLM)}")
except ImportError as e:
    print(f"Import error: {e}")
except Exception as e:
    print(f"Error: {e}")
