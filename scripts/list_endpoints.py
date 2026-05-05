import subprocess
import sys
import os
import json
from pathlib import Path

root = Path(__file__).parent.parent
scratch_lib = str(root / "scratch" / "lib")

def run_introspection(service_path, app_var):
    env = os.environ.copy()
    env["REDIS_URL"] = "redis://localhost:6379/0"
    env["FRONTEND_URL"] = "http://localhost:5173"
    env["MODELS_DIR"] = "/tmp/models"
    env["GROQ_API_KEY"] = "mock"
    env["LETTA_API_KEY"] = "mock"
    
    script = f"""
import sys, os
import unittest.mock as mock

sys.path.insert(0, '{service_path}')
sys.path.append('{scratch_lib}')

def mock_deep(name):
    parts = name.split('.')
    for i in range(len(parts)):
        n = '.'.join(parts[:i+1])
        if n not in sys.modules:
            m = mock.MagicMock()
            m.__path__ = []
            sys.modules[n] = m

# Catch all missing imports
class MockFinder:
    def find_spec(self, fullname, path, target=None):
        if fullname.startswith(("app", "core", "api", "rocky", "voice", "tools", "bridges", "workers", "processors", "pipeline")):
            return None
        if fullname in sys.modules or fullname in sys.builtin_module_names:
            return None
        # Mock it
        mock_deep(fullname)
        return None # We already added it to sys.modules

# sys.meta_path.insert(0, MockFinder()) # This might be risky

# Manual mocks for things that are known to fail
mock_modules = [
    'structlog', 'litellm', 'redis', 'redis.asyncio', 'jose', 'passlib', 'passlib.context',
    'kokoro_onnx', 'pedalboard', 'pipecat', 'pipecat.frames', 'pipecat.frames.frames',
    'pipecat.processors', 'pipecat.processors.frame_processor', 'pipecat.services',
    'pipecat.transports', 'pipecat.transports.services', 'pipecat.pipeline',
    'daily', 'deepgram', 'openai', 'azure_speaker', 'ha_handlers', 'skills', 
    'letta_bridge', 'pipecat_bridge', 'apscheduler', 'apscheduler.schedulers', 
    'apscheduler.schedulers.asyncio', 'apscheduler.schedulers.background'
]
for mod in mock_modules:
    try:
        __import__(mod)
    except:
        mock_deep(mod)

sys.modules["structlog"].get_logger = mock.MagicMock()

try:
    from app.main import {app_var} as app
    if hasattr(app, 'other_asgi_app'):
        app = app.other_asgi_app
    
    routes = []
    for r in app.routes:
        if hasattr(r, 'path') and hasattr(r, 'methods'):
            methods = ", ".join(sorted(list(r.methods - {{"HEAD", "OPTIONS"}})))
            if not methods: continue
            summary = getattr(r, "summary", None)
            if not summary and hasattr(r, "endpoint"):
                summary = (r.endpoint.__doc__ or "").split("\\n")[0].strip()
            routes.append({{"path": r.path, "methods": methods, "summary": summary or ""}})
    import json
    print(json.dumps(routes))
except Exception as e:
    import traceback
    print("ERROR:" + str(e) + "\\n" + traceback.format_exc())
"""
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, env=env)
    return result.stdout

def main():
    output = "# Project Hail Rocky - API Endpoint Map\n\n"
    
    output += "## Backend Service (Port 8000)\n\n"
    res = run_introspection(str(root / "backend"), "fastapi_app")
    if res.startswith("ERROR:"):
        output += f"Error: {res[6:]}\n"
    else:
        try:
            routes = json.loads(res)
            output += "| Method | Path | Summary |\n|--------|------|---------|\n"
            for r in sorted(routes, key=lambda x: x["path"]):
                output += f"| {r['methods']} | `{r['path']}` | {r['summary']} |\n"
        except:
            output += f"Error parsing output: {res}\n"
    output += "\n"

    output += "## Voice Engine Service (Port 8881)\n\n"
    res = run_introspection(str(root / "services" / "voice_engine"), "app")
    if res.startswith("ERROR:"):
        output += f"Error: {res[6:]}\n"
    else:
        try:
            routes = json.loads(res)
            output += "| Method | Path | Summary |\n|--------|------|---------|\n"
            for r in sorted(routes, key=lambda x: x["path"]):
                output += f"| {r['methods']} | `{r['path']}` | {r['summary']} |\n"
        except:
            output += f"Error parsing output: {res}\n"
    
    os.makedirs(root / "docs", exist_ok=True)
    with open(root / "docs" / "api_endpoints.md", "w") as f:
        f.write(output)
    print("Generated docs/api_endpoints.md")

if __name__ == "__main__":
    main()
