import os
from dotenv import load_dotenv
from deepeval import assert_test
from deepeval.test_case import LLMTestCase, LLMTestCaseParams
from deepeval.metrics import GEval
from deepeval.models import GPTModel
from deepeval.metrics import AnswerRelevancyMetric

# Carrega as variáveis de ambiente do Rocky
load_dotenv()

# Configuração do NVIDIA NIM como Juiz (usando as chaves do .env)
# O DeepEval usa o padrão OpenAI, então apontamos para o NVIDIA_BASE_URL
nim_api_key = os.getenv("NVIDIA_API_KEY")
nim_base_url = os.getenv("NVIDIA_BASE_URL")

# Modelo que servirá como "Juiz" para avaliar o Rocky
# Usamos o Llama 3.1 70B (disponível no NIM) por ser muito preciso para avaliações
judge_model = GPTModel(
    model="meta/llama-3.1-70b-instruct",
    api_key=nim_api_key,
    base_url=nim_base_url
)

def test_rocky_personality():
    """
    Testa se a resposta do Rocky mantém a personalidade correta.
    """
    input_text = "Who are you and what do you do?"
    
    # Simulação da resposta do Rocky (em um teste real, você chamaria o seu backend aqui)
    # Aqui estamos testando a capacidade de julgamento do DeepEval com NIM primeiro
    actual_output = "I am Rocky. I am Eridian. I do science! I help friend Grace. Amaze!"
    
    # Métrica de Personalidade Customizada (G-Eval)
    personality_metric = GEval(
        name="Rocky Personality Score",
        model=judge_model,
        # O G-Eval precisa saber quais campos do test_case ele deve olhar
        evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
        criteria="Determine if the response sounds like Rocky from Project Hail Mary: short, enthusiastic sentences, uses 'amaze', says 'friend Grace', and has a scientific curiosity.",
        evaluation_steps=[
            "Check for short and punchy sentence structure",
            "Verify the use of 'amaze' or 'scary'",
            "Check if the tone is friendly and inquisitive",
            "Confirm it refers to itself as Rocky or Eridian"
        ],
        threshold=0.8
    )

    test_case = LLMTestCase(
        input=input_text,
        actual_output=actual_output
    )

    # Executa a métrica
    personality_metric.measure(test_case)
    
    print(f"\n[ROCKY PERSONALITY TEST]")
    print(f"Score: {personality_metric.score}")
    print(f"Reason: {personality_metric.reason}")
    
    assert personality_metric.score >= 0.8, f"Personalidade do Rocky falhou! Nota: {personality_metric.score}"

if __name__ == "__main__":
    # Para rodar manualmente: python scripts/test_rocky_deepeval.py
    try:
        test_rocky_personality()
        print("\n✅ Teste de Personalidade passou com sucesso!")
    except Exception as e:
        print(f"\n❌ Falha no teste: {e}")
