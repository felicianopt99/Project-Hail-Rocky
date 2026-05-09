import asyncio
import httpx
import re
import structlog
from typing import List, Dict, Any, Optional
from ..config import settings

log = structlog.get_logger()

def infer_service_type(model_id: str, metadata: Dict[str, Any] = None) -> str:
    """
    Infers if a service is LLM, STT, or TTS based on naming and metadata.
    Heuristics inspired by Chanakya-Local-Friend.
    """
    m_id = model_id.lower()
    
    # 1. Check metadata tasks (HuggingFace style)
    if metadata and "task" in metadata:
        task = str(metadata["task"]).lower()
        if any(k in task for k in ["tts", "text-to-speech"]): return "tts"
        if any(k in task for k in ["stt", "speech-recognition", "asr"]): return "stt"
        if any(k in task for k in ["text-generation", "chat", "llm"]): return "llm"

    # 2. Check naming heuristics
    tokens = set(re.split(r'[^a-zA-Z0-9]', m_id))
    if any(k in tokens for k in ["whisper", "stt", "faster-whisper", "asr"]):
        return "stt"
    if any(k in tokens for k in ["tts", "kokoro", "parler", "elevenlabs"]):
        return "tts"
    
    # Default to LLM if it looks like a model
    return "llm"

class DiscoveryManager:
    """
    Automatic discovery of local AI services (Ollama, Whisper, TTS).
    Zero-config strategy for Project-Hail-Rocky.
    """
    _instance = None
    _services: Dict[str, List[Dict[str, Any]]] = {"llm": [], "stt": [], "tts": [], "mcp": []}
    _scanned = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DiscoveryManager, cls).__new__(cls)
        return cls._instance

    async def scan(self, force: bool = False):
        """Scans common local ports and known service names."""
        if self._scanned and not force:
            return
            
        log.info("discovery_scan_started")
        
        # Potential local endpoints (Docker service names and localhost)
        endpoints = [
            # LLMs
            {"url": "http://ollama:11434", "name": "ollama-local"},
            {"url": "http://localhost:11434", "name": "ollama-host"},
            {"url": "http://vllm:8000", "name": "vllm-local"},
            # STT
            {"url": "http://whisper:9000", "name": "whisper-faster"},
            {"url": "http://localhost:9000", "name": "whisper-faster-host"},
            # MCP
            {"url": "http://ha-mcp:3000", "name": "home-assistant-mcp"},
            {"url": "http://localhost:3000", "name": "mcp-host"},
        ]

        tasks = [self._check_endpoint(e) for e in endpoints]
        await asyncio.gather(*tasks)
        
        self._scanned = True
        log.info("discovery_scan_complete", 
                 llms=len(self._services["llm"]), 
                 stt=len(self._services["stt"]),
                 tts=len(self._services["tts"]))

    async def _check_endpoint(self, endpoint: Dict[str, str]):
        url = endpoint["url"].rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                # 1. Try /v1/models (OpenAI style)
                try:
                    r = await client.get(f"{url}/v1/models")
                    if r.status_code == 200:
                        data = r.json()
                        models = data.get("data", [])
                        for m in models:
                            m_id = m.get("id")
                            s_type = infer_service_type(m_id, m)
                            self._add_service(s_type, {"id": m_id, "url": url, "source": endpoint["name"]})
                        return
                except: pass

                # 2. Try /api/tags (Ollama style)
                try:
                    r = await client.get(f"{url}/api/tags")
                    if r.status_code == 200:
                        models = r.json().get("models", [])
                        for m in models:
                            self._add_service("llm", {"id": m.get("name"), "url": url, "source": endpoint["name"]})
                        return
                except: pass

                # 3. Simple health check for known ports if no /models
                r = await client.get(url)
                if r.status_code < 500:
                    # Check by port
                    if ":11434" in url: self._add_service("llm", {"id": "ollama-detected", "url": url})
                    elif ":9000" in url: self._add_service("stt", {"id": "whisper-detected", "url": url})
                    elif ":3000" in url: self._add_service("mcp", {"id": "mcp-detected", "url": url})

        except Exception:
            pass

    def _add_service(self, s_type: str, data: dict):
        if s_type in self._services:
            # Avoid duplicates
            if not any(s["url"] == data["url"] and s["id"] == data["id"] for s in self._services[s_type]):
                self._services[s_type].append(data)

    def get_services(self, s_type: str) -> List[dict]:
        return self._services.get(s_type, [])

discovery_manager = DiscoveryManager()
