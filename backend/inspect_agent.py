try:
    from vision_agents.core import Agent
    print(f"Agent methods: {[m for m in dir(Agent) if not m.startswith('_')]}")
except ImportError as e:
    print(f"Import error: {e}")
except Exception as e:
    print(f"Error: {e}")
