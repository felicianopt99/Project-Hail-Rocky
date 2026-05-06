from fastapi import APIRouter
import httpx
import psutil
import structlog
from ..config import settings
from ..core import redis_client
from ..bridges import letta_bridge
from ..tools.executor import _check_server_health

router = APIRouter()
log = structlog.get_logger()

@router.get("/health")
async def get_system_health():
    """
    Centralized health endpoint that validates the infrastructure:
    - Redis connection
    - Letta memory server availability
    - Home Assistant MCP server tool listing
    - Hardware status (Optiplex 3040)
    """
    
    # 1. Redis Check
    redis_status = "offline"
    try:
        redis = await redis_client.get_redis()
        if redis and await redis.ping():
            redis_status = "online"
    except Exception as e:
        log.warning("health_check_redis_failed", error=str(e))

    # 2. Letta Check
    letta_status = "unreachable"
    try:
        if await letta_bridge.is_available():
            letta_status = "healthy"
    except Exception:
        pass

    # 3. HA-MCP Check
    mcp_status = "disconnected"
    if settings.ha_mcp_url:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                url = f"{settings.ha_mcp_url.rstrip('/')}/tools"
                r = await client.get(url)
                if r.status_code == 200:
                    mcp_status = "connected"
        except Exception:
            pass
    else:
        mcp_status = "not_configured"

    # 4. Hardware Check
    ram = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    
    return {
        "redis": redis_status,
        "letta": letta_status,
        "mcp": mcp_status,
        "hardware": {
            "cpu_percent": psutil.cpu_percent(),
            "ram_percent": ram.percent,
            "disk_percent": disk.percent,
            "summary": _check_server_health()
        }
    }
