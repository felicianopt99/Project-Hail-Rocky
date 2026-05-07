"""Background task that polls Valkey every 30 s for due alarms and reminders."""
import asyncio
import json
import time
import structlog

from ..config import settings
from .redis_client import get_redis

log = structlog.get_logger()

_ALARMS_KEY = "rocky:alarms"

_POLL_INTERVAL = 30  # seconds


async def _watch(sio: object) -> None:
    log.info("alarm_watcher_started")
    while True:
        try:
            redis = await get_redis()
            if redis is not None:
                now = time.time()
                due: list[tuple[str, float]] = await redis.zrangebyscore(
                    _ALARMS_KEY, "-inf", now, withscores=True
                )
                for raw, score in due:
                    try:
                        alarm = json.loads(raw)
                    except json.JSONDecodeError:
                        await redis.zrem(_ALARMS_KEY, raw)
                        continue

                    kind = alarm.get("type", "alarm")
                    event = "alarm_fired" if kind == "alarm" else "reminder_fired"
                    await sio.emit(event, {  # type: ignore[union-attr]
                        "label":   alarm.get("label", kind),
                        "message": alarm.get("message"),
                        "type":    kind,
                    })
                    await redis.zrem(_ALARMS_KEY, raw)
                    log.info("alarm_dispatched", type=kind, label=alarm.get("label"))

        except asyncio.CancelledError:
            log.info("alarm_watcher_stopped")
            return
        except Exception as e:
            log.warning("alarm_watcher_error", error=str(e))

        await asyncio.sleep(_POLL_INTERVAL)


def start(sio: object) -> "asyncio.Task[None]":
    """Start the alarm watcher and return the background task."""
    return asyncio.create_task(_watch(sio))
