try:
    from vision_agents.core.llm.llm import LLM
    llm = LLM()
    print(f"LLM has function_registry: {hasattr(llm, 'function_registry')}")
    print(f"LLM methods: {[m for m in dir(llm) if not m.startswith('_')]}")
except ImportError as e:
    print(f"Import error: {e}")
except Exception as e:
    print(f"Error: {e}")
