from typing import Any, Dict, List
from app.core.plugins.base import BasePlugin

class HelloPlugin(BasePlugin):
    """A simple plugin to test the plugin system."""

    async def get_tools(self) -> List[Dict[str, Any]]:
        return [{
            "type": "function",
            "function": {
                "name": "hello_rocky",
                "description": "Say hello to Rocky and get a friendly response.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "user_name": {
                            "type": "string",
                            "description": "The name of the user to greet."
                        }
                    },
                    "required": ["user_name"]
                }
            }
        }]

    async def execute_tool(self, name: str, args: Dict[str, Any]) -> Any:
        if name == "hello_rocky":
            user_name = args.get("user_name", "Stranger")
            return f"Olá {user_name}! Eu sou o Rocky, o teu assistente local. O sistema de plugins está a funcionar perfeitamente!"
        return f"Tool {name} not found in HelloPlugin."
