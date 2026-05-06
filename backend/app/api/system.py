from fastapi import APIRouter
import httpx
import structlog
from ..config import settings
from ..core import redis_client
from ..bridges import letta_bridge

router = APIRouter()
log = structlog.get_logger()

@router.get("/health")
async def get_system_health():
    """
    Centralized health endpoint that validates the infrastructure:
    - Redis connection
    - Letta memory server availability
    - Home Assistant MCP server tool listing
    """
    
    # 1. Redis Check
    redis_status = "offline"
    try:
        redis = await redis_client.get_redis()
        if redis:
            # ping() returns True if successful in redis-py
            if await redis.ping():
                redis_status = "online"
    except Exception as e:
        log.warning("health_check_redis_failed", error=str(e))

    # 2. Letta Check
    letta_status = "unreachable"
    try:
        if await letta_bridge.is_available():
            letta_status = "healthy"
    except Exception as e:
        log.warning("health_check_letta_failed", error=str(e))

    # 3. HA-MCP Check
    mcp_status = "disconnected"
    if settings.ha_mcp_url:
        try:
            # We check if the MCP server responds to the tool listing command
            # In the streamable_http protocol used by Letta, this is GET /tools
            async with httpx.AsyncClient(timeout=5.0) as client:
                url = f"{settings.ha_mcp_url.rstrip('/')}/tools"
                r = await client.get(url)
                if r.status_code == 200:
                    mcp_status = "connected"
        except Exception as e:
            log.warning("health_check_mcp_failed", url=settings.ha_mcp_url, error=str(e))
    else:
        mcp_status = "not_configured"

    return {
        "redis": redis_status,
        "letta": letta_status,
        "mcp": mcp_status
    }
