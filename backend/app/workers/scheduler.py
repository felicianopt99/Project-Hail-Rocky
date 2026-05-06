import structlog
from saq import CronJob, Queue, Worker

from .diary_writer import run as run_diary
from .pattern_analyzer import run as run_patterns
from ..config import settings

log = structlog.get_logger()

# Create a queue instance
queue = Queue.from_url(settings.redis_url)

def setup() -> Worker:
    """Configures the saq Worker with cron jobs."""
    
    # Define cron jobs
    # Daily diary at 23:00
    diary_cron = CronJob(
        run_diary,
        cron="0 23 * * *",
        unique=True,
        timeout=600,
    )

    # Weekly pattern analysis — Sunday 04:00
    pattern_cron = CronJob(
        run_patterns,
        cron="0 4 * * 0", # Sunday is 0 or 7 depending on implementation, saq uses crontab syntax
        unique=True,
        timeout=600,
    )

    # Initialize worker
    worker = Worker(
        queue,
        functions=[run_diary, run_patterns],
        cron_jobs=[diary_cron, pattern_cron],
    )

    return worker
