import httpx
import os
from . import config

class LLMEngine:
    def __init__(self):
        self.provider = config.LLM_PROVIDER

    async def get_response(self, text):
        if not text:
            return ""

        if self.provider == "ollama":
            return await self._ollama_request(text)
        elif self.provider == "openai":
            return await self._openai_request(text)
        else:
            return "Provedor LLM desconhecido."

    async def _ollama_request(self, text):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    config.OLLAMA_URL,
                    json={
                        "model": config.OLLAMA_MODEL,
                        "prompt": f"Você é o Rocky, um assistente de voz amigável e eficiente. Responda de forma curta e direta: {text}",
                        "stream": False
                    }
                )
                if response.status_code == 200:
                    return response.json().get("response", "")
                else:
                    return f"Erro no Ollama: {response.status_code}"
        except Exception as e:
            return f"Erro ao conectar ao Ollama: {e}"

    async def _openai_request(self, text):
        # Basic implementation if user wants to swap
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {config.OPENAI_API_KEY}"},
                    json={
                        "model": "gpt-3.5-turbo",
                        "messages": [{"role": "user", "content": text}]
                    }
                )
                return response.json()["choices"][0]["message"]["content"]
        except Exception as e:
            return f"Erro OpenAI: {e}"
