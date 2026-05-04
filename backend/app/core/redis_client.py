import redis.asyncio as aioredis
import structlog

from ..config import settings

log = structlog.get_logger()

_pool: aioredis.ConnectionPool | None = None


async def get_redis() -> aioredis.Redis | None:
    global _pool
    if not settings.redis_url:
        return None
    try:
        if _pool is None:
            _pool = aioredis.ConnectionPool.from_url(
                settings.redis_url, decode_responses=True, max_connections=10
            )
        return aioredis.Redis(connection_pool=_pool)
    except Exception as e:
        log.warning("redis_unavailable", error=str(e))
        return None
