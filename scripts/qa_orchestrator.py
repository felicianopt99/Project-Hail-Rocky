#!/usr/bin/env python3
import asyncio
import sys
import os
import subprocess
import json
import time
from datetime import datetime
from typing import Dict, Any

# Add scripts dir to path to import PersonalityScorer
sys.path.append(os.path.dirname(__file__))
try:
    from enterprise_test_battery import PersonalityScorer, BACKEND_URL, VOICE_ENGINE_URL
except ImportError:
    BACKEND_URL = "http://127.0.0.1:8000"
    VOICE_ENGINE_URL = "http://127.0.0.1:8881"

class QAOrchestrator:
    def __init__(self):
        self.results = {
            "timestamp": datetime.now().isoformat(),
            "levels": {},
            "summary": {"passed": 0, "failed": 0, "total": 0}
        }

    def run_command(self, cmd: list, name: str) -> bool:
        print(f"\n🚀 Running Level: {name}...")
        start_time = time.time()
        
        # Try local first
        try:
            process = subprocess.run(cmd, capture_output=True, text=True)
            if process.returncode != 0 and "pytest" in cmd[0]:
                # If pytest fails locally (maybe env issues), try docker if possible
                print(f"  ⚠️  Local {name} failed. Trying via Docker...")
                # Fix paths for docker: host "tests/functional/..." -> container "tests/..."
                docker_cmd_args = [c.replace("tests/functional/", "tests/") if "tests/functional/" in c else c for c in cmd]
                docker_cmd = ["docker", "compose", "exec", "-T", "-e", "PYTHONPATH=.", "backend"] + docker_cmd_args
                process = subprocess.run(docker_cmd, capture_output=True, text=True)
            
            duration = time.time() - start_time
            passed = process.returncode == 0
            
            self.results["levels"][name] = {
                "passed": passed,
                "duration_sec": round(duration, 2),
                "stdout": process.stdout[-2000:], 
                "stderr": process.stderr[-2000:] if process.stderr else ""
            }
            
            if passed:
                print(f"✅ {name} PASSED ({round(duration, 2)}s)")
                self.results["summary"]["passed"] += 1
            else:
                print(f"❌ {name} FAILED ({round(duration, 2)}s)")
                print(f"  Diagnostics: {process.stderr[:200] if process.stderr else 'Check stdout'}")
                self.results["summary"]["failed"] += 1
            
            self.results["summary"]["total"] += 1
            return passed
        except Exception as e:
            print(f"💥 Error running {name}: {e}")
            return False

    async def check_health(self) -> bool:
        print("\n🔍 Level 0: Health Checks...")
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                resp = await client.get(f"{BACKEND_URL}/api/health")
                backend_ok = resp.status_code == 200
                print(f"  - Backend: {'OK' if backend_ok else 'DOWN'}")
            except:
                backend_ok = False
                print("  - Backend: DOWN")

            try:
                # Piper/Voice engine check
                resp = await client.get(f"{VOICE_ENGINE_URL}/synthesize", params={"text": "test"})
                # Piper returns 405 on GET usually, but if it responds it's alive
                voice_ok = resp.status_code in [200, 405]
                print(f"  - Voice Engine: {'OK' if voice_ok else 'DOWN'}")
            except:
                voice_ok = False
                print("  - Voice Engine: DOWN")

        passed = backend_ok
        self.results["levels"]["Health Checks"] = {"passed": passed, "backend": backend_ok, "voice": voice_ok}
        self.results["summary"]["total"] += 1
        if passed: self.results["summary"]["passed"] += 1
        else: self.results["summary"]["failed"] += 1
        return passed

    def run_all(self):
        print("="*60)
        print(f"PROJECT HAIL ROCKY - QA SUITE v1.0")
        print("="*60)

        # Level 0: Health
        asyncio.run(self.check_health())

        # Level 1: API Functional
        self.run_command(["pytest", "tests/functional/test_api.py"], "API Functional")

        # Level 2: Socket.IO Loop
        self.run_command(["pytest", "tests/functional/test_voice_loop.py"], "Socket.IO Integration")

        # Level 3: Enterprise Battery (Stress & Latency Benchmarks)
        self.run_command([
            sys.executable, "tests/benchmarks/latency_battery.py", 
            "--scenarios", "tests/data/scenarios_advanced.json", 
            "--concurrency", "2"
        ], "VUI Industry Benchmarks")

        # Level 4: Ground Truth Quality (DeepEval + NVIDIA NIM)
        self.run_command([
            sys.executable, "tests/quality/personality_eval.py"
        ], "Ground Truth Quality")

        # Level 5: STT Regression - English (Primary)
        self.run_command([
            sys.executable, "tests/quality/stt_regression.py",
            "--lang", "en_us", "--limit", "10"
        ], "STT Accuracy (English)")

        # Level 6: STT Regression - Portuguese
        self.run_command([
            sys.executable, "tests/quality/stt_regression.py",
            "--lang", "pt_br", "--limit", "10"
        ], "STT Accuracy (Portuguese)")

        self.save_report()

    def save_report(self):
        reports_dir = "scripts/reports"
        os.makedirs(reports_dir, exist_ok=True)
        filename = f"qa_summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = os.path.join(reports_dir, filename)
        with open(filepath, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        print("\n" + "="*60)
        print(f"QA FINAL STATUS: {self.results['summary']['passed']}/{self.results['summary']['total']} Levels Passed")
        print(f"Report saved to: {filepath}")
        print("="*60)

if __name__ == "__main__":
    orchestrator = QAOrchestrator()
    orchestrator.run_all()
