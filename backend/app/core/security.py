from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from ..config import settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(hours=1))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")


def create_refresh_token(data: dict) -> str:
    return create_access_token(data, expires_delta=timedelta(days=7))


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except JWTError:
        return None


# ── Token blacklist (Redis-backed) ────────────────────────────────────────

_BLACKLIST_PREFIX = "rocky:token:blacklist:"


async def blacklist_token(token: str) -> None:
    """Add a token to the blacklist until its expiry."""
    from ..core.redis_client import get_redis  # lazy import to avoid circular deps
    redis = await get_redis()
    if not redis:
        return
    payload = decode_token(token)
    if not payload:
        return
    exp = payload.get("exp")
    if exp:
        ttl = max(1, int(exp - datetime.now(timezone.utc).timestamp()))
        try:
            await redis.setex(f"{_BLACKLIST_PREFIX}{token}", ttl, "1")
        except Exception:
            pass


async def is_blacklisted(token: str) -> bool:
    """Return True if the token has been explicitly invalidated."""
    from ..core.redis_client import get_redis
    redis = await get_redis()
    if not redis:
        return False
    try:
        return bool(await redis.exists(f"{_BLACKLIST_PREFIX}{token}"))
    except Exception:
        return False

