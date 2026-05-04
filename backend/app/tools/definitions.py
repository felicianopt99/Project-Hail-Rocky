"""
Tool definitions passed to LiteLLM.
The LLM reads these descriptions and decides which to call.
"""

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_datetime",
            "description": "Get the current date, time, and day of the week.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_timer",
            "description": "Set a countdown timer that fires an alert when done.",
            "parameters": {
                "type": "object",
                "properties": {
                    "duration_seconds": {
                        "type": "integer",
                        "description": "Timer duration in seconds. Convert 'minutes' and 'hours' accordingly.",
                    },
                    "label": {
                        "type": "string",
                        "description": "Short label for the timer (e.g. 'pasta', 'meeting').",
                    },
                },
                "required": ["duration_seconds"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather and today's forecast for a city.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "City name, e.g. 'Lisbon', 'Porto', 'London'.",
                    }
                },
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_wikipedia",
            "description": "Get a brief summary of a topic from Wikipedia.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Topic or person to look up.",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Evaluate a mathematical expression and return the result.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Math expression, e.g. '2 ** 10', '(15 * 8) / 3'.",
                    }
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "control_lights",
            "description": "Control smart home lights: turn on, off, toggle, or set brightness/colour.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entity_id": {
                        "type": "string",
                        "description": "HA entity ID, e.g. 'light.living_room'. Use 'all' for all lights.",
                    },
                    "action": {
                        "type": "string",
                        "enum": ["on", "off", "toggle"],
                        "description": "Action to perform.",
                    },
                    "brightness": {
                        "type": "integer",
                        "description": "Brightness 0-100 (optional).",
                    },
                    "color": {
                        "type": "string",
                        "description": "Hex colour, e.g. '#ff8800' (optional).",
                    },
                },
                "required": ["entity_id", "action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "activate_scene",
            "description": "Activate a Home Assistant scene like cinema mode, reading mode, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "scene_id": {
                        "type": "string",
                        "description": "HA scene entity ID, e.g. 'scene.cinema_mode'.",
                    }
                },
                "required": ["scene_id"],
            },
        },
    },
]
