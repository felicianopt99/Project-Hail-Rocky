#!/usr/bin/env python3
import asyncio
import time
import httpx
import sys
import os
import json
from datetime import datetime

# Configuration
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
VOICE_ENGINE_URL = os.getenv("VOICE_ENGINE_URL", "http://127.0.0.1:8880")

# Colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
RESET = "\033[0m"

class TestBattery:
    def __init__(self):
        self.results = []
        self.client = httpx.AsyncClient(timeout=30.0)

    async def log_result(self, category, name, success, message, duration=None):
        status = f"{GREEN}PASS{RESET}" if success else f"{RED}FAIL{RESET}"
        dur_str = f" ({duration:.2f}ms)" if duration else ""
        print(f"[{category}] {name}: {status}{dur_str}")
        if not success:
            print(f"   {RED}↳ {message}{RESET}")
        
        self.results.append({
            "category": category,
            "name": name,
            "success": success,
            "message": message,
            "duration": duration
        })

    async def test_service_health(self):
        print(f"\n{BOLD}--- Infrastructure & Health ---{RESET}")
        
        # Test Backend
        try:
            start = time.time()
            resp = await self.client.get(f"{BACKEND_URL}/api/health")
            duration = (time.time() - start) * 1000
            if resp.status_code == 200:
                await self.log_result("HEALTH", "Backend Reachable", True, "OK", duration)
            else:
                await self.log_result("HEALTH", "Backend Reachable", False, f"Status {resp.status_code}")
        except Exception as e:
            await self.log_result("HEALTH", "Backend Reachable", False, str(e))

        # Test Voice Engine
        try:
            start = time.time()
            resp = await self.client.get(f"{VOICE_ENGINE_URL}/health")
            duration = (time.time() - start) * 1000
            if resp.status_code == 200:
                await self.log_result("HEALTH", "Voice Engine Reachable", True, "OK", duration)
            else:
                await self.log_result("HEALTH", "Voice Engine Reachable", False, f"Status {resp.status_code}")
        except Exception as e:
            await self.log_result("HEALTH", "Voice Engine Reachable", False, str(e))

    async def test_brain_logic(self):
        print(f"\n{BOLD}--- Brain Logic & Personality ---{RESET}")
        
        # Load from JSON if exists
        scenarios = []
        scenarios_path = os.path.join(os.path.dirname(__file__), "test_scenarios.json")
        if os.path.exists(scenarios_path):
            try:
                with open(scenarios_path, "r") as f:
                    data = json.load(f)
                    for s in data.get("scenarios", []):
                        scenarios.append({
                            "name": s["name"],
                            "input": s["input"],
                            "contains": s["expected_keywords"]
                        })
            except Exception as e:
                print(f"{YELLOW}Warning: Could not load test_scenarios.json: {e}{RESET}")

        if not scenarios:
            scenarios = [
                {"name": "Greeting", "input": "Hello Rocky!", "contains": ["Rocky", "hello"]},
                {"name": "Tool Intent", "input": "Turn on the living room lights", "contains": ["light", "turn", "ok"]},
                {"name": "Personality Check", "input": "Who are you?", "contains": ["Rocky", "alien", "assistant"]},
            ]

        for s in scenarios:
            try:
                start = time.time()
                resp = await self.client.post(
                    f"{BACKEND_URL}/api/brain/chat",
                    json={"sid": "test_battery", "content": s["input"]}
                )
                duration = (time.time() - start) * 1000
                
                full_text = ""
                async for chunk in resp.aiter_text():
                    full_text += chunk
                
                success = any(word.lower() in full_text.lower() for word in s["contains"])
                if success:
                    await self.log_result("BRAIN", f"Scenario: {s['name']}", True, "Response validated", duration)
                else:
                    await self.log_result("BRAIN", f"Scenario: {s['name']}", False, f"Expected keywords not found in: {full_text[:50]}...", duration)
            except Exception as e:
                await self.log_result("BRAIN", f"Scenario: {s['name']}", False, str(e))

    async def test_tts_performance(self):
        print(f"\n{BOLD}--- Voice Engine Performance (TTS) ---{RESET}")
        text = "This is a performance test for the Rocky voice synthesis system. It should be fast."
        
        try:
            start = time.time()
            async with self.client.stream(
                "POST",
                f"{VOICE_ENGINE_URL}/synthesize",
                json={"text": text, "emotional_state": "neutral"}
            ) as resp:
                ttfb = None
                total_bytes = 0
                async for chunk in resp.aiter_bytes():
                    if ttfb is None:
                        ttfb = (time.time() - start) * 1000
                    total_bytes += len(chunk)
                
                total_duration = (time.time() - start) * 1000
                
                if ttfb and ttfb < 2000:
                    await self.log_result("PERF", "TTS TTFB (Time to First Byte)", True, f"{ttfb:.2f}ms", ttfb)
                else:
                    await self.log_result("PERF", "TTS TTFB (Time to First Byte)", False, f"Slow: {ttfb:.2f}ms" if ttfb else "No audio", ttfb)
                
                await self.log_result("PERF", "TTS Throughput", True, f"Received {total_bytes/1024:.1f} KB", total_duration)
        except Exception as e:
            await self.log_result("PERF", "TTS Performance", False, str(e))

    async def run_all(self):
        print(f"{BLUE}{BOLD}Rocky Automated Test Battery v1.0{RESET}")
        print(f"Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        
        await self.test_service_health()
        await self.test_brain_logic()
        await self.test_tts_performance()
        
        await self.client.aclose()
        self.summary()

    def summary(self):
        total = len(self.results)
        passed = len([r for r in self.results if r["success"]])
        failed = total - passed
        
        print(f"\n{BOLD}{'='*40}{RESET}")
        print(f"{BOLD}FINAL SUMMARY{RESET}")
        print(f"{BOLD}{'='*40}{RESET}")
        print(f"Total Tests:  {total}")
        print(f"Passed:       {GREEN}{passed}{RESET}")
        print(f"Failed:       {RED}{failed}{RESET}")
        print(f"{BOLD}{'='*40}{RESET}")
        
        if failed > 0:
            sys.exit(1)

if __name__ == "__main__":
    battery = TestBattery()
    asyncio.run(battery.run_all())
