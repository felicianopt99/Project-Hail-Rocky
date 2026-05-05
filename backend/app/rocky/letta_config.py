"""
Rocky as a Letta agent.

Letta gives Rocky hierarchical memory:
  - Core memory "persona"  — Rocky's personality (always in context)
  - Core memory "human"    — What Rocky knows about the human (edited by Rocky)
  - Archival memory        — Important moments (vector DB, semantic search)
  - Recall memory          — Recent conversation summaries
"""
from ..rocky.personality.system_prompt import _BASE as ROCKY_PERSONA

ROCKY_AGENT_NAME = "rocky"

INITIAL_HUMAN_BLOCK = (
    "This human lives with Rocky. "
    "Their name, preferences, and interests are unknown — "
    "Rocky will learn over time through conversation."
)

# Model names passed to Letta — must match what Letta's LiteLLM proxy resolves
LETTA_LLM_MODEL = "groq/llama-3.1-8b-instant"
LETTA_EMBEDDING_MODEL = "letta/letta-free"  # or "hugging-face/BAAI/bge-m3" when Qdrant is ready

AGENT_DESCRIPTION = (
    "Rocky — Eridian engineer and home companion. "
    "Has hierarchical memory and remembers important moments."
)
