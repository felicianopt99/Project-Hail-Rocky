import httpx
import structlog
from ..config import settings

log = structlog.get_logger()

BASE_TOOLS: list[dict] = [
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
            "name": "execute_python",
            "description": "Execute Python code for complex calculations, data analysis, or advanced logic. Returns the console output (STDOUT).",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "The complete Python code to execute.",
                    }
                },
                "required": ["code"],
            },
        },
    },
]

async def get_tools() -> list[dict]:
    """
    Fetch all available tools, including local basics and dynamic MCP tools.
    """
    tools = list(BASE_TOOLS)
    
    if settings.ha_mcp_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                url = f"{settings.ha_mcp_url.rstrip('/')}/tools"
                r = await client.get(url)
                if r.status_code == 200:
                    mcp_data = r.json()
                    # MCP spec: tool list is in "tools" key
                    mcp_tools = mcp_data.get("tools", [])
                    
                    for t in mcp_tools:
                        # Convert MCP format to LiteLLM/OpenAI format
                        tools.append({
                            "type": "function",
                            "function": {
                                "name": t["name"],
                                "description": t.get("description", ""),
                                "parameters": t.get("inputSchema", {"type": "object", "properties": {}}),
                            }
                        })
                    log.info("mcp_tools_imported", count=len(mcp_tools), url=url)
        except Exception as e:
            log.warning("mcp_tools_fetch_failed", url=settings.ha_mcp_url, error=str(e))
            
    return tools
