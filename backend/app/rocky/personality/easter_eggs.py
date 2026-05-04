import random
from datetime import date

_REFS: dict[str, list[str]] = {
    "energy": [
        "Reminds Rocky of astrophage. Small organism. Much energy.",
        "Energy. Astrophage would be interested in this.",
    ],
    "sun": [
        "Sun reminds Rocky of Tau Ceti. Different star. Miss sometimes.",
        "Rocky know sun well. Not Eridani. But warm.",
    ],
    "travel": [
        "Rocky traveled far. Beetles — Rocky's ship. Very good ship.",
        "Long journey, human. Rocky understand. Beetles go very far.",
    ],
    "problem": [
        "Rocky face big problems before. Taumoeba — small problem, unexpected solution.",
        "Problems are solvable. Rocky learn this from Ryland.",
    ],
    "music": [
        "Music! Rocky and Ryland communicate with music first. Good memory.",
        "Both Eridians and humans have music. Rocky find this amaze.",
    ],
    "science": [
        "Science is same everywhere. Rocky and Ryland discover this together.",
        "Physics does not change. Rocky like reliable things.",
    ],
    "food": [
        "Human food is interesting to Rocky. Eridians do not eat. Just ammonia.",
        "Humans eat so many things. Rocky observe with great curiosity.",
    ],
    "sleep": ["Rocky not sleep. Eridians do not sleep. Humans sleep very long. Amaze."],
    "home": [
        "Eridani system is far. Rocky think about home sometimes.",
        "Rocky has two homes now. Eridani and here. Both good.",
    ],
    "gravity": [
        "Gravity here is weak, human. Rocky used to higher gravity.",
        "Question, human: Earth gravity always this weak?",
    ],
}

_SPECIAL_DATES: dict[tuple[int, int], str] = {
    (4, 12): "Today Rocky mark important day. First contact with Ryland was day like this.",
    (7, 20): "Humans landed on moon. Rocky knows this day. Amaze achievement.",
    (12, 31): "End of Earth rotation cycle. Rocky calculate humans call this 'New Year'. Soon.",
    (1, 1): "New rotation begins, human. Rocky calculate this is Earth year zero-reset.",
}

_TOPIC_TRIGGERS = {
    "energy": ["energy", "power", "electricity", "battery", "fuel"],
    "sun": ["sun", "star", "solar", "light", "warm", "heat"],
    "travel": ["travel", "trip", "journey", "fly", "space", "move", "far"],
    "problem": ["problem", "issue", "bug", "error", "fix", "broken", "fail"],
    "music": ["music", "song", "sound", "audio", "melody", "rhythm"],
    "science": ["science", "physics", "chemistry", "biology", "experiment"],
    "food": ["food", "eat", "hungry", "dinner", "lunch", "cook", "taste"],
    "sleep": ["sleep", "tired", "rest", "nap", "bed", "dream"],
    "home": ["home", "house", "family", "belong", "place", "live"],
    "gravity": ["heavy", "weight", "gravity", "fall", "drop"],
}


def get_for_topic(message: str, probability: float = 0.15) -> str:
    if random.random() > probability:
        return ""
    lower = message.lower()
    for topic, keywords in _TOPIC_TRIGGERS.items():
        if any(kw in lower for kw in keywords):
            refs = _REFS.get(topic, [])
            if refs:
                return random.choice(refs)
    return ""


def get_special_date() -> str:
    today = date.today()
    return _SPECIAL_DATES.get((today.month, today.day), "")
