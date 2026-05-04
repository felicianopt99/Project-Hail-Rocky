from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel

from ..bridges import letta_bridge
from ..core.redis_client import get_redis
from .auth import get_current_user

router = APIRouter()



@router.get("/profile")
async def get_profile():
    """Rocky's core memory blocks — persona + human profile."""
    memory = await letta_bridge.get_core_memory()
    if memory is None:
        return {"available": False, "note": "Letta not running — start with: make letta"}
    return {"available": True, "memory": memory}


@router.get("/search")
async def search_memories(q: str = Query(..., min_length=2)):
    """Semantic search across Rocky's archival memories."""
    results = await letta_bridge.search_archival(q, limit=15)
    return {"query": q, "results": results, "count": len(results)}


@router.get("/recent")
async def get_recent():
    """Most recent archival memories."""
    memories = await letta_bridge.get_recent_memories(limit=30)
    return {"memories": memories}


class ForgetRequest(BaseModel):
    confirm: str  # must be "YES_FORGET_EVERYTHING"


@router.post("/forget-all")
async def forget_all(body: ForgetRequest, _user: dict = Depends(get_current_user)):
    """Irreversibly reset Rocky's memory. Requires auth + explicit confirmation."""

    if body.confirm != "YES_FORGET_EVERYTHING":
        raise HTTPException(status_code=400, detail="Confirmation string incorrect.")

    # Clear Redis state
    redis = await get_redis()
    if redis:
        try:
            keys = await redis.keys("rocky:*")
            if keys:
                await redis.delete(*keys)
        except Exception:
            pass

    # Reset Letta agent
    success = await letta_bridge.forget_all()
    if not success:
        raise HTTPException(status_code=503, detail="Letta unavailable — memory not cleared.")

    return {"success": True, "message": "Rocky memory cleared. Good. New start, human."}
