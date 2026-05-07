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

    def _find_latest_report(self, pattern: str) -> Optional[str]:
        import glob
        reports_dir = "scripts/reports"
        files = glob.glob(os.path.join(reports_dir, pattern))
        if not files:
            return None
        return max(files, key=os.path.getmtime)

    def generate_markdown_summary(self):
        print("\n📝 Generating Unified Executive Summary...")
        
        # 1. Gather external data
        latency_file = self._find_latest_report("report_*.json")
        stt_en_file = self._find_latest_report("stt_regression_en_us_*.json")
        stt_pt_file = self._find_latest_report("stt_regression_pt_br_*.json")
        
        latency_data = {}
        if latency_file:
            with open(latency_file, 'r') as f:
                latency_data = json.load(f)
        
        stt_en_data = {}
        if stt_en_file:
            with open(stt_en_file, 'r') as f:
                stt_en_data = json.load(f)

        stt_pt_data = {}
        if stt_pt_file:
            with open(stt_pt_file, 'r') as f:
                stt_pt_data = json.load(f)

        # 2. Build Markdown
        md = []
        md.append("# 🚀 PROJECT HAIL ROCKY - EXECUTIVE QA REPORT")
        md.append(f"\n**Timestamp**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        passed = self.results["summary"]["passed"]
        total = self.results["summary"]["total"]
        status_color = "🟢" if passed == total else "🔴"
        md.append(f"\n## {status_color} Overall Status: {passed}/{total} Levels Passed")
        
        # Level Status Table
        md.append("\n### 📋 Level Breakdown")
        md.append("| Level | Status | Duration | Details |")
        md.append("| :--- | :--- | :--- | :--- |")
        for name, data in self.results["levels"].items():
            icon = "✅" if data.get("passed") else "❌"
            dur = f"{data.get('duration_sec', 0)}s"
            details = "OK"
            if not data.get("passed"):
                # Try to extract a clean reason
                stderr = data.get("stderr", "")
                details = stderr.splitlines()[-1] if stderr else "Check logs"
            md.append(f"| {name} | {icon} | {dur} | {details} |")

        # Performance Section
        if latency_data:
            md.append("\n### ⚡ Performance Benchmarks (Industry Standard)")
            md.append("| Metric | Rocky (Avg) | Alexa Standard | Status |")
            md.append("| :--- | :--- | :--- | :--- |")
            b = latency_data.get("benchmarks", {})
            ttft = b.get("llm_ttft", {}).get("avg", 0)
            ttrs = b.get("ttrs", {}).get("avg", 0)
            md.append(f"| **LLM TTFT** | {ttft}ms | 1500-2200ms | {'🚀 Faster' if ttft < 1500 else '🆗 Standard'} |")
            md.append(f"| **VUI TTRS** | {ttrs}ms | 2000-3000ms | {'🚀 Faster' if ttrs < 2000 else '🆗 Standard'} |")
            md.append(f"| **Throughput** | {b.get('tokens_per_second', {}).get('avg', 0)} tps | - | - |")

        # Quality Section
        if stt_en_data or stt_pt_data:
            md.append("\n### 🎯 Quality Metrics (STT Accuracy)")
            md.append("| Language | WER (Word Error Rate) | CER (Char Error Rate) | Status |")
            md.append("| :--- | :--- | :--- | :--- |")
            if stt_en_data:
                wer = stt_en_data.get("metrics", {}).get("avg_wer", 0)
                md.append(f"| English (US) | {wer:.2%} | {stt_en_data.get('metrics', {}).get('avg_cer', 0):.2%} | {'✅ High' if wer < 0.1 else '⚠️ Review'} |")
            if stt_pt_data:
                wer = stt_pt_data.get("metrics", {}).get("avg_wer", 0)
                md.append(f"| Portuguese (BR) | {wer:.2%} | {stt_pt_data.get('metrics', {}).get('avg_cer', 0):.2%} | {'✅ High' if wer < 0.15 else '⚠️ Review'} |")

        if latency_data:
            score = latency_data.get("summary", {}).get("avg_personality_score", 0)
            md.append(f"\n> [!TIP]\n> **Rocky Personality Score**: {score}% accuracy in scientific tone and Eridian-isms.")

        # Save MD
        md_path = os.path.join("scripts/reports", "QA_EXECUTIVE_SUMMARY.md")
        with open(md_path, 'w') as f:
            f.write("\n".join(md))
        print(f"📄 Unified Summary saved to: {md_path}")

    def save_report(self):
        reports_dir = "scripts/reports"
        os.makedirs(reports_dir, exist_ok=True)
        filename = f"qa_summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = os.path.join(reports_dir, filename)
        with open(filepath, 'w') as f:
            json.dump(self.results, f, indent=2)
        
        # Generate the beautiful MD report
        self.generate_markdown_summary()
        
        print("\n" + "="*60)
        print(f"QA FINAL STATUS: {self.results['summary']['passed']}/{self.results['summary']['total']} Levels Passed")
        print(f"Report saved to: {filepath}")
        print("="*60)

if __name__ == "__main__":
    orchestrator = QAOrchestrator()
    orchestrator.run_all()
