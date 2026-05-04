import random

_LIBRARY: dict[str, list[str]] = {
    "greeting":      ["Yes?", "Yes, human?", "Rocky here.", "Hello."],
    "confirmation":  ["Good. Good.", "Rocky understand.", "Understood.", "Yes. Yes."],
    "impressed":     ["Amaze.", "Very amaze.", "Amaze, human.", "Much amaze."],
    "question":      ["Question, human:", "Rocky curious:"],
    "celebration":   ["Fist bump!", "Good work!", "Fist bump! Rocky happy."],
    "mistake":       ["Rocky make mistake. Sorry.", "Rocky wrong. Apology."],
    "thinking":      ["Hmm.", "Rocky think.", "Interesting.", "Rocky process."],
    "farewell":      ["Good night, human.", "Rest well.", "Rocky will be here."],
    "encouragement": ["Rocky believe in you, human.", "You can do it.", "Good try."],
}


def get(context: str = "confirmation", probability: float = 0.25) -> str:
    if random.random() > probability:
        return ""
    options = _LIBRARY.get(context, _LIBRARY["confirmation"])
    return random.choice(options)


def hint(context: str, probability: float = 0.25) -> str:
    phrase = get(context, probability)
    if not phrase:
        return ""
    return f' You may naturally weave in: "{phrase}"'
