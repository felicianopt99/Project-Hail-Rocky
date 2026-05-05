import os
import json
import httpx
import asyncio
import time
from dotenv import dotenv_values
from deepeval.models import DeepEvalBaseLLM
from deepeval.metrics import GEval, AnswerRelevancyMetric
from deepeval.test_case import LLMTestCase, LLMTestCaseParams

# 1. Configuração de Ambiente
env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
env_config = dotenv_values(env_path)

NIM_API_KEY = env_config.get("NVIDIA_API_KEY")
# URL EXATA pedida pelo usuário
NIM_BASE_URL = "https://integrate.api.nvidia.com/v1/"

# 2. Wrapper Customizado Robusto para NVIDIA NIM
class NvidiaNIM(DeepEvalBaseLLM):
    def __init__(self, model_name: str):
        self.model_name = model_name

    def load_model(self):
        return self

    def get_model_name(self):
        return self.model_name

    def generate(self, prompt: str) -> str:
        url = f"{NIM_BASE_URL.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {NIM_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "max_tokens": 1024
        }
        try:
            with httpx.Client(timeout=60.0) as client:
                response = client.post(url, headers=headers, json=payload)
                if response.status_code != 200:
                    print(f"Error {response.status_code}: {response.text}")
                    return "Error"
                return response.json()["choices"][0]["message"]["content"]
        except Exception as e:
            return f"Exception: {str(e)}"

    async def a_generate(self, prompt: str) -> str:
        # Redireciona para o síncrono para garantir estabilidade no loop do DeepEval
        return self.generate(prompt)

# 3. Inicialização do Juiz
# Llama 3.1 70B é o mínimo para garantir que o DeepEval receba JSON válido
nim_judge = NvidiaNIM(model_name="meta/llama-3.1-70b-instruct")

# 4. Definição das Métricas
personality_metric = GEval(
    name="Rocky Personality",
    model=nim_judge,
    evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
    criteria="Evaluate if the response matches Rocky's Eridian personality: short, science-focused, enthusiastic, uses 'amaze'.",
    threshold=0.7
)

relevancy_metric = AnswerRelevancyMetric(
    model=nim_judge,
    threshold=0.7
)

# 5. Execução Completa do Dataset
def run_full_evaluation():
    scenarios_path = os.path.join(os.path.dirname(__file__), "..", "data", "scenarios_advanced.json")
    with open(scenarios_path, "r") as f:
        data = json.load(f)
    
    print(f"\n🚀 Iniciando Avaliação via NVIDIA NIM")
    print(f"🔗 URL: {NIM_BASE_URL}")
    print(f"📊 Dataset: {len(data['scenarios'])} cenários.")

    for sc in data["scenarios"]:
        print(f"\n🧪 {sc['id']}: {sc['name']}")
        
        # Mock de resposta (Aqui você integraria com a chamada real ao Rocky)
        if sc["language"] == "pt":
            actual_output = "Eu sou Rocky! Faço ciência para ajudar amigo Grace! Incrível! Pergunta?"
        else:
            actual_output = "I am Rocky! I do science! Help friend Grace! Amaze! Question?"

        test_case = LLMTestCase(
            input=sc["input"],
            actual_output=actual_output
        )

        try:
            start = time.time()
            personality_metric.measure(test_case)
            relevancy_metric.measure(test_case)
            duration = time.time() - start

            print(f"  - 🎭 Personalidade: {personality_metric.score:.2f} " + ("✅" if personality_metric.is_successful() else "❌"))
            print(f"  - 🎯 Relevância:    {relevancy_metric.score:.2f} " + ("✅" if relevancy_metric.is_successful() else "❌"))
            print(f"  - ⏱️ Duração:       {duration:.2f}s")
        except Exception as e:
            print(f"  💥 Falha no teste: {e}")

if __name__ == "__main__":
    run_full_evaluation()
