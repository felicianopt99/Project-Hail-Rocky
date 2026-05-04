import structlog

log = structlog.get_logger()

_LABELS = [(0, 30, "stranger"), (31, 60, "acquaintance"), (61, 85, "friend"), (86, 100, "close_friend")]

_POSITIVE = {"thank", "thanks", "obrigado", "obrigada", "merci", "great",
             "love", "perfect", "awesome", "brilliant", "excellent", "good job"}
_NEGATIVE = {"wrong", "bad", "hate", "stupid", "useless", "terrible", "awful",
             "errado", "mau", "odeia", "inútil"}


def label(score: float) -> str:
    for low, high, lbl in _LABELS:
        if low <= score <= high:
            return lbl
    return "stranger"


def behavior_hint(score: float) -> str:
    lbl = label(score)
    hints = {
        "stranger": "Be formal. No easter eggs. Introduce yourself carefully.",
        "acquaintance": "Casual tone. Occasional catchphrases. Starting to open up.",
        "friend": "Relaxed, warm. Share opinions. Frequent catchphrases. Easter eggs welcome.",
        "close_friend": "Very familiar. Use their name if known. Maximum warmth. Deep connection.",
    }
    return hints.get(lbl, hints["stranger"])


async def load(user_id: str = "default", redis=None) -> float:
    if redis is None:
        return 35.0
    try:
        val = await redis.get(f"rocky:intimacy:{user_id}")
        return float(val) if val else 35.0
    except Exception:
        return 35.0


async def update(user_id: str, message: str, redis=None) -> float:
    score = await load(user_id, redis)
    lower = message.lower()
    words = set(lower.split())

    if words & _POSITIVE:
        score = min(100.0, score + 1.0)
    elif words & _NEGATIVE:
        score = max(0.0, score - 0.5)
    else:
        score = min(100.0, score + 0.2)

    if redis:
        try:
            await redis.set(f"rocky:intimacy:{user_id}", str(score))
        except Exception as e:
            log.warning("intimacy_save_failed", error=str(e))

    return score
