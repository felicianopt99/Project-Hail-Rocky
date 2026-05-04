from datetime import datetime

STATES = ["neutral", "curious", "tired", "excited", "focused", "playful"]

_CURIOUS = {"why", "how", "what", "when", "where", "wonder",
            "porquê", "como", "quando", "onde", "curioso",
            "pourquoi", "comment", "quand", "où"}
_EXCITED = {"amazing", "wow", "great", "awesome", "fantastic", "perfect", "brilliant",
            "incrível", "fantástico", "perfeito", "ótimo", "excelente",
            "incroyable", "fantastique", "parfait", "super"}
_TECH = {"code", "python", "javascript", "typescript", "debug", "error", "function",
         "class", "bug", "api", "database", "server", "docker", "git", "bash",
         "código", "depurar", "erro", "função", "servidor",
         "déboguer", "erreur", "fonction", "serveur"}


def detect(message: str, current: str = "neutral") -> str:
    hour = datetime.now().hour
    if hour >= 22 or hour < 6:
        return "tired"

    lower = message.lower()
    words = set(lower.split())

    if words & _TECH:
        return "focused"
    if words & _EXCITED:
        return "excited"
    if words & _CURIOUS or message.count("?") >= 1:
        return "curious"
    return current


async def load(sid: str, redis=None) -> str:
    if redis is None:
        return "neutral"
    try:
        val = await redis.get(f"rocky:state:{sid}")
        return val if val in STATES else "neutral"
    except Exception:
        return "neutral"


async def save(sid: str, state: str, redis=None, ttl: int = 1800) -> None:
    if redis is None or state not in STATES:
        return
    try:
        await redis.setex(f"rocky:state:{sid}", ttl, state)
    except Exception:
        pass
