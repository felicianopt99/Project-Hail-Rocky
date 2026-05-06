import uuid
from contextvars import ContextVar
from typing import Optional

_trace_id_var: ContextVar[Optional[str]] = ContextVar("trace_id", default=None)

def set_trace_id(trace_id: Optional[str] = None) -> str:
    if not trace_id:
        trace_id = str(uuid.uuid4())
    _trace_id_var.set(trace_id)
    return trace_id

def get_trace_id() -> Optional[str]:
    return _trace_id_var.get()
