#!/usr/bin/env python3
import socket
import urllib.request
import urllib.error
import json
import os
import subprocess
import time
from typing import List, Tuple, Dict

# Colors for terminal output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"

def print_step(msg: str):
    print(f"\n{BLUE}==>{RESET} {msg}")

def print_ok(msg: str):
    print(f"  {GREEN}[OK]{RESET} {msg}")

def print_fail(msg: str):
    print(f"  {RED}[FAIL]{RESET} {msg}")

def print_warn(msg: str):
    print(f"  {YELLOW}[WARN]{RESET} {msg}")

def check_env() -> bool:
    print_step("Checking Environment")
    if not os.path.exists(".env"):
        print_fail(".env file missing")
        return False
    
    required_vars = ["LETTA_URL", "REDIS_URL", "VOICE_ENGINE_URL", "VITE_BACKEND_URL"]
    with open(".env", "r") as f:
        content = f.read()
        for var in required_vars:
            if var not in content:
                print_warn(f"Variable {var} might be missing from .env")
    
    print_ok(".env file present")
    return True

def check_docker_services() -> Dict[str, bool]:
    print_step("Checking Docker Services Status")
    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--format", "json"],
            capture_output=True, text=True, check=True
        )
        # Handle both list of objects and single object output
        output = result.stdout.strip()
        if not output:
            print_fail("No services running (or docker compose ps returned empty)")
            return {}
        
        # Docker Compose V2 format can be multiple JSON objects or a list
        try:
            services = json.loads(output)
        except json.JSONDecodeError:
            # Try splitting by newlines if it's multiple JSON objects
            services = [json.loads(line) for line in output.splitlines() if line.strip()]
            
        if isinstance(services, dict):
            services = [services]

        status_map = {}
        for s in services:
            name = s.get("Name", s.get("Service", "unknown"))
            state = s.get("State", s.get("Status", "unknown")).lower()
            is_running = "up" in state or "running" in state
            status_map[name] = is_running
            if is_running:
                print_ok(f"Service {name}: {state}")
            else:
                print_fail(f"Service {name}: {state}")
        return status_map
    except Exception as e:
        print_fail(f"Failed to check docker status: {e}")
        return {}

def check_http(name: str, url: str, expected_code: int = 200) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            if response.getcode() == expected_code:
                print_ok(f"{name} reachable ({url})")
                return True
            else:
                print_fail(f"{name} returned code {response.getcode()} (expected {expected_code})")
                return False
    except Exception as e:
        print_fail(f"{name} unreachable at {url}: {e}")
        return False

def check_tcp(name: str, host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=3):
            print_ok(f"{name} TCP connection successful ({host}:{port})")
            return True
    except Exception as e:
        print_fail(f"{name} TCP connection failed ({host}:{port}): {e}")
        return False

def check_letta_agents(letta_url: str) -> bool:
    url = f"{letta_url.rstrip('/')}/v1/agents"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read().decode())
            print_ok(f"Letta API functional (Found {len(data)} agents)")
            return True
    except Exception as e:
        print_fail(f"Letta API failed to list agents: {e}")
        return False

def check_socketio(url: str) -> bool:
    # Basic Engine.io handshake check
    handshake_url = f"{url.rstrip('/')}/socket.io/?EIO=4&transport=polling"
    try:
        with urllib.request.urlopen(handshake_url, timeout=5) as response:
            data = response.read().decode()
            if "sid" in data:
                print_ok(f"Socket.io handshake successful (sid found)")
                return True
            else:
                print_fail(f"Socket.io handshake returned invalid data: {data[:100]}")
                return False
    except Exception as e:
        print_fail(f"Socket.io handshake failed at {handshake_url}: {e}")
        return False

def load_env() -> Dict[str, str]:
    env = {}
    if os.path.exists(".env"):
        with open(".env", "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    env[key.strip()] = value.strip().strip('"').strip("'")
    return env

def run_checks():
    print(f"\n{GREEN}Rocky System Health Check{RESET}")
    print("="*30)
    
    env_vars = load_env()
    overall_success = True
    
    # 1. Env
    if not check_env():
        overall_success = False
        
    # 2. Docker
    service_status = check_docker_services()
    if not any(service_status.values()):
        print_warn("No services appear to be running. Please run 'make up' or 'make full'")
        overall_success = False

    # 3. Connectivity
    print_step("Checking Service Connectivity")
    
    # Backend
    backend_url = env_vars.get("VITE_BACKEND_URL", "http://127.0.0.1:8000")
    # Backend health is usually on /api/health
    backend_ok = check_http("Rocky Backend", f"{backend_url.rstrip('/')}/api/health")
    if not backend_ok:
        overall_success = False
    else:
        # Check Socket.io if backend is up
        if not check_socketio(backend_url):
            print_warn("Socket.io might have issues (handshake failed)")
        
    # Redis
    redis_url = env_vars.get("REDIS_URL", "redis://127.0.0.1:6380")
    try:
        # Simple redis url parsing
        redis_host = redis_url.split("//")[1].split(":")[0]
        redis_port = int(redis_url.split(":")[2])
        if not check_tcp("Redis", redis_host, redis_port):
            overall_success = False
    except:
        check_tcp("Redis", "127.0.0.1", 6380)
        
    # Postgres
    if not check_tcp("PostgreSQL", "127.0.0.1", 5433):
        overall_success = False

    # Letta
    letta_url = env_vars.get("LETTA_URL", "http://127.0.0.1:8283")
    if not check_http("Letta Health", f"{letta_url.rstrip('/')}/v1/health"):
        overall_success = False
    else:
        check_letta_agents(letta_url)

    # Voice Engine
    voice_url = env_vars.get("VOICE_ENGINE_URL", "http://127.0.0.1:8881")
    check_http("Voice Engine (Kokoro-ONNX)", f"{voice_url.rstrip('/')}/health")

    # Qdrant
    check_http("Qdrant Vector DB", "http://127.0.0.1:6333/healthz")

    print("\n" + "="*30)
    if overall_success:
        print(f"{GREEN}ALL CRITICAL SYSTEMS OK{RESET}")
    else:
        print(f"{RED}SOME SYSTEMS FAILED{RESET}")
        exit(1)

if __name__ == "__main__":
    run_checks()
