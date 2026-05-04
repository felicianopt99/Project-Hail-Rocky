"""APScheduler setup — background jobs for Rocky."""
import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .diary_writer import run as run_diary
from .pattern_analyzer import run as run_patterns
from ..config import settings

log = structlog.get_logger()

scheduler = AsyncIOScheduler(timezone=settings.timezone)


def setup() -> AsyncIOScheduler:
    # Daily diary at 23:00
    scheduler.add_job(
        run_diary,
        trigger=CronTrigger(hour=23, minute=0),
        id="diary_writer",
        name="Rocky Daily Diary",
        replace_existing=True,
    )

    # Weekly pattern analysis — Sunday 04:00
    scheduler.add_job(
        run_patterns,
        trigger=CronTrigger(day_of_week="sun", hour=4, minute=0),
        id="pattern_analyzer",
        name="Rocky Pattern Analyzer",
        replace_existing=True,
    )

    return scheduler
