import inspect
try:
    from vision_agents.core import Agent
    print(f"Agent.simple_response signature: {inspect.signature(Agent.simple_response)}")
    print(f"Agent.say signature: {inspect.signature(Agent.say)}")
except ImportError as e:
    print(f"Import error: {e}")
except Exception as e:
    print(f"Error: {e}")
