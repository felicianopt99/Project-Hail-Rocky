"""
Weekly pattern analyzer.

Runs Sundays at 04:00. Asks Rocky to reflect on patterns observed
in the past week and update the "human" core memory block with new insights.
"""
import structlog

from ..bridges.letta_bridge import send_message, is_available

log = structlog.get_logger()

_PATTERN_PROMPT = (
    "Rocky, please review your recent memories and identify 1-2 patterns or habits "
    "you have noticed about the human you live with. "
    "If you notice something new, update your memory block about them. "
    "Be observant but not intrusive. Keep it factual and kind."
)


async def run(ctx: dict) -> None:
    log.info("pattern_analyzer_started")

    if not await is_available():
        log.warning("pattern_analyzer_skipped", reason="Letta unavailable")
        return

    response = await send_message(_PATTERN_PROMPT, role="system")
    if response:
        log.info("pattern_analyzed", preview=response[:80])
    else:
        log.warning("pattern_analyzer_no_response")
