import asyncio
import json
import os
import subprocess
import structlog
import httpx
from typing import Any, Dict, List, Optional
from ..config import settings

log = structlog.get_logger()

class MCPBridge:
    """
    Manages multiple MCP servers (Stdio and HTTP/SSE).
    Inspired by Chanakya-Local-Friend and the Model Context Protocol spec.
    """
    _instance = None
    _servers: Dict[str, Dict[str, Any]] = {}
    _lock = asyncio.Lock()

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(MCPBridge, cls).__new__(cls)
        return cls._instance

    async def initialize(self):
        """Load configuration and start all MCP servers."""
        async with self._lock:
            if self._servers:
                return

            config_path = settings.mcp_config_path
            if not os.path.isabs(config_path):
                # Try relative to project root
                root = os.getcwd()
                config_path = os.path.join(root, config_path)

            if not os.path.exists(config_path):
                log.warning("mcp_config_not_found", path=config_path)
                return

            try:
                with open(config_path, "r") as f:
                    config = json.load(f)
                
                servers_config = config.get("mcpServers", {})
                for name, cfg in servers_config.items():
                    await self._start_server(name, cfg)
            except Exception as e:
                log.error("mcp_initialization_failed", error=str(e))

    async def _start_server(self, name: str, cfg: dict):
        """Starts an individual MCP server based on its config."""
        log.info("mcp_server_starting", name=name)
        
        # Determine transport type
        if "command" in cfg:
            await self._start_stdio_server(name, cfg)
        elif "url" in cfg:
            await self._start_http_server(name, cfg)
        else:
            log.warning("mcp_server_config_invalid", name=name)

    async def _start_stdio_server(self, name: str, cfg: dict):
        try:
            cmd = cfg["command"]
            args = cfg.get("args", [])
            env = os.environ.copy()
            env.update(cfg.get("env", {}))

            process = await asyncio.create_subprocess_exec(
                cmd, *args,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env
            )
            
            self._servers[name] = {
                "type": "stdio",
                "process": process,
                "tools": [],
                "initialized": False
            }

            # Initialize MCP session
            init_res = await self._call_stdio(name, "initialize", {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "rocky", "version": "1.0"}
            })
            
            if init_res:
                await self._call_stdio(name, "notifications/initialized", {}, is_notification=True)
                self._servers[name]["initialized"] = True
                # Fetch tools
                tools_res = await self._call_stdio(name, "tools/list", {})
                if tools_res:
                    self._servers[name]["tools"] = tools_res.get("tools", [])
                log.info("mcp_stdio_server_ready", name=name, tools_count=len(self._servers[name]["tools"]))

        except Exception as e:
            log.error("mcp_stdio_start_failed", name=name, error=str(e))

    async def _start_http_server(self, name: str, cfg: dict):
        url = cfg["url"]
        self._servers[name] = {
            "type": "http",
            "url": url,
            "session_id": None,
            "tools": [],
            "initialized": False
        }
        # Attempt immediate discovery for HTTP
        try:
            await self._init_http_session(name)
        except Exception as e:
            log.warning("mcp_http_discovery_failed_at_startup", name=name, error=str(e))

    async def _init_http_session(self, name: str):
        server = self._servers[name]
        url = server["url"].rstrip("/") + "/mcp"
        headers = {"Accept": "application/json, text/event-stream"}
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Initialize
            init_payload = {
                "jsonrpc": "2.0", "id": 0, "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "rocky", "version": "1.0"},
                },
            }
            r = await client.post(url, json=init_payload, headers=headers)
            if r.status_code != 200:
                return

            session_id = r.headers.get("mcp-session-id")
            if not session_id:
                return
            
            server["session_id"] = session_id
            
            # Notif initialized
            await client.post(url, json={"jsonrpc": "2.0", "method": "notifications/initialized"},
                              headers={**headers, "Mcp-Session-Id": session_id})
            
            # List tools
            list_r = await client.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
                                       headers={**headers, "Mcp-Session-Id": session_id})
            
            if list_r.status_code == 200:
                tools_data = self._parse_sse_json(list_r.text)
                if tools_data:
                    server["tools"] = tools_data.get("result", {}).get("tools", [])
                    server["initialized"] = True
                    log.info("mcp_http_server_ready", name=name, tools_count=len(server["tools"]))

    def _parse_sse_json(self, text: str) -> Optional[dict]:
        for line in text.splitlines():
            if line.startswith("data:"):
                try:
                    return json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    pass
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    async def _call_http(self, name: str, tool_name: str, arguments: dict) -> Optional[str]:
        server = self._servers[name]
        if not server["session_id"]:
            await self._init_http_session(name)
            if not server["session_id"]:
                return "Error: Could not initialize MCP HTTP session."

        url = server["url"].rstrip("/") + "/mcp"
        headers = {
            "Accept": "application/json, text/event-stream",
            "Mcp-Session-Id": server["session_id"]
        }
        payload = {
            "jsonrpc": "2.0", "id": 1,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(url, json=payload, headers=headers)
            if r.status_code != 200:
                return f"Error: MCP server returned {r.status_code}"
            
            data = self._parse_sse_json(r.text)
            if not data or "result" not in data:
                return f"Error: Invalid MCP response: {r.text}"
            
            content = data["result"].get("content", [])
            return "\n".join([c.get("text", "") for c in content if c.get("type") == "text"])

    async def _call_stdio(self, name: str, method: str, params: dict, is_notification: bool = False) -> Optional[dict]:
        server = self._servers.get(name)
        if not server or server["type"] != "stdio":
            return None
        
        proc = server["process"]
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }
        if not is_notification:
            request["id"] = 1

        try:
            msg = json.dumps(request) + "\n"
            proc.stdin.write(msg.encode())
            await proc.stdin.drain()

            if is_notification:
                return None

            line = await proc.stdout.readline()
            if not line:
                log.debug("mcp_stdio_no_line", name=name)
                return None
            
            raw_res = line.decode()
            log.debug("mcp_stdio_raw_res", name=name, raw=raw_res)
            response = json.loads(raw_res)
            if "error" in response:
                log.error("mcp_stdio_error", name=name, error=response["error"])
                return None
            return response.get("result")
        except Exception as e:
            log.error("mcp_stdio_call_failed", name=name, method=method, error=str(e))
            return None

    async def get_all_tools(self) -> List[dict]:
        """Returns a list of all tools from all servers, formatted for LLM."""
        await self.initialize()
        all_tools = []
        for name, server in self._servers.items():
            for t in server.get("tools", []):
                all_tools.append({
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("inputSchema", {"type": "object", "properties": {}}),
                    "server_name": name
                })
        return all_tools

    async def call_tool(self, tool_name: str, arguments: dict) -> Optional[str]:
        """Calls a tool by name on the appropriate server."""
        for name, server in self._servers.items():
            for t in server.get("tools", []):
                if t["name"] == tool_name:
                    if server["type"] == "stdio":
                        res = await self._call_stdio(name, "tools/call", {
                            "name": tool_name,
                            "arguments": arguments
                        })
                        if res and "content" in res:
                            return "\n".join([c.get("text", "") for c in res["content"] if c.get("type") == "text"])
                    elif server["type"] == "http":
                        return await self._call_http(name, tool_name, arguments)
        return None

    async def shutdown(self):
        """Gracefully stop all MCP servers."""
        for name, server in self._servers.items():
            if server["type"] == "stdio":
                proc = server["process"]
                proc.terminate()
                await proc.wait()
                log.info("mcp_server_stopped", name=name)

mcp_bridge = MCPBridge()
