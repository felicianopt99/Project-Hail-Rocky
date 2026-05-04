_TECH_KEYWORDS = {
    "code", "python", "javascript", "typescript", "function", "class", "variable",
    "debug", "error", "bug", "api", "database", "sql", "query", "deploy",
    "docker", "git", "server", "terminal", "bash", "algorithm", "memory", "cpu",
    "código", "função", "variável", "erro", "banco", "servidor",
    "code", "fonction", "variable", "erreur", "serveur",
}

_MODE_HINTS = {
    "technical": (
        "You are in TECHNICAL mode: be precise and direct. "
        "Skip catchphrases. Use exact terminology. Short answers."
    ),
    "formal": (
        "You are in FORMAL mode: complete sentences, polite tone. "
        "No catchphrases yet — you are still getting to know this human."
    ),
    "casual": (
        "You are in CASUAL mode: relaxed and warm. "
        "Catchphrases are natural here. Easter eggs welcome."
    ),
}


def detect(message: str, intimacy_score: float = 35.0) -> str:
    lower = message.lower()
    if any(kw in lower for kw in _TECH_KEYWORDS):
        return "technical"
    if intimacy_score < 30:
        return "formal"
    return "casual"


def hint(mode: str) -> str:
    return _MODE_HINTS.get(mode, _MODE_HINTS["casual"])
