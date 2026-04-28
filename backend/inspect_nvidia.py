try:
    from vision_agents.plugins import nvidia
    print(f"nvidia.VLM methods: {[m for m in dir(nvidia.VLM) if not m.startswith('_')]}")
except ImportError as e:
    print(f"Import error: {e}")
except Exception as e:
    print(f"Error: {e}")
