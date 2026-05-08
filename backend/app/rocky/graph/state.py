from typing import TypedDict, Annotated, Sequence
from langchain_core.messages import BaseMessage
from operator import add

class RockyState(TypedDict):
    """
    Represents the state of the Rocky brain graph.
    """
    messages: Annotated[Sequence[BaseMessage], add]
    sid: str
    emotional_state: str
    intimacy_score: int
    core_memory: dict
    recent_context: list[dict]
    tools_called: list[str]
    # To signal termination or transitions
    next_step: str | None
