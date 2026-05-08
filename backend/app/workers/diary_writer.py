"""
Rocky's daily diary writer.

Runs nightly at 23:00. Rocky reflects on the day's interactions and
writes an archival memory entry — creating a running journal of life
with the human.
"""
import structlog
from datetime import date

from ..rocky.graph.workflow import run_rocky_brain
from ..bridges.letta_bridge import is_available

log = structlog.get_logger()

_DIARY_PROMPT = (
    "Rocky, please write a brief diary entry for today ({date}). "
    "Reflect on your conversations and observations from the day. "
    "Be honest, curious, and in character. Keep it to 2-3 sentences. "
    "Prefix with: [DIARY {date}]"
)


async def run(ctx: dict) -> None:
    log.info("diary_writer_started")

    if not await is_available():
        log.warning("diary_writer_skipped", reason="Letta unavailable")
        return

    today = date.today().isoformat()
    prompt = _DIARY_PROMPT.format(date=today)

    # Using the unified LangGraph brain
    response = await run_rocky_brain(prompt, role="system", sid="worker_diary_writer")
    
    if response:
        log.info("diary_written", date=today, preview=response[:80])
    else:
        log.warning("diary_writer_no_response")
