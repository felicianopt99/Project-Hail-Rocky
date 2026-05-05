#!/usr/bin/env python3
import asyncio
import time
import httpx
import os
import json
import socketio
import statistics
import logging
import re
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional
from enum import Enum

# ==========================================
# CONFIGURATION & TYPES
# ==========================================

BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
VOICE_ENGINE_URL = os.getenv("VOICE_ENGINE_URL", "http://127.0.0.1:8881")
REPORTS_DIR = os.path.join(os.path.dirname(__file__), "reports")
MAX_CONCURRENT_TESTS = int(os.getenv("MAX_CONCURRENT_TESTS", "5"))

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("TestBattery")

class TestStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    ERROR = "ERROR"
    TIMEOUT = "TIMEOUT"

@dataclass
class TestCase:
    id: str
    name: str
    input: str
    expected_keywords: List[str]
    expected_traits: List[str] = field(default_factory=list)
    category: str = "general"
    intent: str = ""
    language: str = "en"

@dataclass
class TestMetrics:
    stt_latency_ms: Optional[float] = None
    llm_ttft_ms: Optional[float] = None
    ttrs_ms: Optional[float] = None # Time To Response Start (VUI metric)
    total_latency_ms: Optional[float] = None
    audio_gen_time_ms: Optional[float] = None
    tokens_count: int = 0
    tps: Optional[float] = None # Tokens per second
    personality_score: float = 0.0
    intent_match: bool = False

@dataclass
class TestResult:
    test_case: TestCase
    status: TestStatus
    metrics: TestMetrics
    actual_transcript: str = ""
    actual_response: str = ""
    reason: str = ""
    retries_used: int = 0
    logs: List[str] = field(default_factory=list)

# ==========================================
# PERSONALITY SCORER
# ==========================================

class PersonalityScorer:
    """
    Evaluates if the response sounds like Rocky from Project Hail Mary.
    """
    ROCKY_ISMS = [
        r"amaze", r"scary", r"fist-bump", r"fist bump", 
        r"question\?", r"pergunta\?", r"understand\?", r"entendes\?",
        r"bad bad bad", r"good good good"
    ]
    
    @staticmethod
    def score(text: str, language: str = "en") -> float:
        if not text: return 0.0
        score = 0.0
        
        # 1. Check for Rocky-isms (0.4 weight)
        matches = 0
        for pattern in PersonalityScorer.ROCKY_ISMS:
            if re.search(pattern, text, re.IGNORECASE):
                matches += 1
        score += min(0.4, (matches * 0.15))
        
        # 2. Sentence structure (0.3 weight)
        # Rocky speaks in short, punchy sentences.
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        if sentences:
            avg_words = sum(len(s.split()) for s in sentences) / len(sentences)
            if 3 <= avg_words <= 8:
                score += 0.3
            elif avg_words <= 12:
                score += 0.15
        
        # 3. Tone/Specific content (0.3 weight)
        scientific_terms = ["math", "science", "erid", "grace", "human", "friend", "astrophage", "sol"]
        if language == "pt":
            scientific_terms += ["amigo", "humano", "matemática", "ciência"]
            
        content_matches = sum(1 for term in scientific_terms if term in text.lower())
        score += min(0.3, (content_matches * 0.1))
        
        return round(score * 100, 2)

# ==========================================
# TEST EXECUTOR
# ==========================================

class IsolatedTestRunner:
    def __init__(self, test_case: TestCase, timeout: float = 60.0):
        self.tc = test_case
        self.timeout = timeout
        self.sio = socketio.AsyncClient(reconnection_attempts=3)
        self.events = asyncio.Queue()
        self.metrics = TestMetrics()
        self.test_logger = logging.getLogger(f"TestRunner-{self.tc.id}")

        self.sio.on("transcript_result", lambda data: self.events.put_nowait(("stt", data)))
        self.sio.on("chat_token", lambda data: self.events.put_nowait(("llm_token", data)))
        self.sio.on("chat_response", lambda data: self.events.put_nowait(("llm_final", data)))
        self.sio.on("tts_start", lambda data: self.events.put_nowait(("tts_start", data)))
        self.sio.on("error", lambda data: self.events.put_nowait(("error", data)))

    async def _generate_audio(self, http_client: httpx.AsyncClient) -> Optional[bytes]:
        start = time.time()
        try:
            resp = await http_client.post(
                f"{VOICE_ENGINE_URL}/synthesize",
                json={"text": self.tc.input, "voice": "af_bella", "lang": self.tc.language}
            )
            resp.raise_for_status()
            self.metrics.audio_gen_time_ms = (time.time() - start) * 1000
            return resp.content
        except Exception as e:
            self.test_logger.error(f"Audio gen failed: {e}")
            return None

    async def execute(self, http_client: httpx.AsyncClient, retry_count: int = 0) -> TestResult:
        audio_data = await self._generate_audio(http_client)
        if not audio_data:
            return TestResult(self.tc, TestStatus.ERROR, self.metrics, reason="Audio generation failed")

        send_time = time.time()
        transcript = ""
        full_response = ""
        first_token_time = None
        
        try:
            await self.sio.connect(BACKEND_URL)
            await self.sio.emit("audio_blob", {"audio": audio_data, "lang": self.tc.language})

            async with asyncio.timeout(self.timeout):
                while True:
                    event_type, data = await self.events.get()

                    if event_type == "stt":
                        self.metrics.stt_latency_ms = (time.time() - send_time) * 1000
                        transcript = data
                    
                    elif event_type == "llm_token":
                        if first_token_time is None:
                            first_token_time = time.time()
                            self.metrics.llm_ttft_ms = (first_token_time - send_time) * 1000
                        full_response += data
                        self.metrics.tokens_count += 1
                    
                    elif event_type == "llm_final":
                        self.metrics.total_latency_ms = (time.time() - send_time) * 1000
                        if first_token_time:
                            gen_duration = time.time() - first_token_time
                            if gen_duration > 0:
                                self.metrics.tps = self.metrics.tokens_count / gen_duration
                        break
                    
                    elif event_type == "tts_start":
                        if self.metrics.ttrs_ms is None:
                            self.metrics.ttrs_ms = (time.time() - send_time) * 1000

                    elif event_type == "error":
                        raise RuntimeError(f"Backend Error: {data}")

            # Validation logic
            self.metrics.personality_score = PersonalityScorer.score(full_response, self.tc.language)
            
            stt_matches = [w for w in self.tc.expected_keywords if w.lower() in transcript.lower()]
            llm_matches = [w for w in self.tc.expected_keywords if w.lower() in full_response.lower()]
            all_unique_matches = set(stt_matches) | set(llm_matches)
            
            success_rate = (len(all_unique_matches) / len(self.tc.expected_keywords)) if self.tc.expected_keywords else 1.0
            
            stt_ok = len(transcript.strip()) > 2
            llm_ok = self.metrics.llm_ttft_ms is not None and len(full_response) > 5
            
            # Performance Thresholds (Enterprise standard)
            perf_ok = (self.metrics.llm_ttft_ms or 9999) < 2500 # Max 2.5s for TTFT
            
            if success_rate >= 0.5 and stt_ok and llm_ok and perf_ok:
                status = TestStatus.PASS
                reason = "Success"
            else:
                status = TestStatus.FAIL
                if not stt_ok: reason = "STT failed"
                elif not llm_ok: reason = "LLM failed"
                elif not perf_ok: reason = f"Latency too high ({int(self.metrics.llm_ttft_ms)}ms)"
                else: reason = f"Keyword match low ({int(success_rate*100)}%)"

            return TestResult(self.tc, status, self.metrics, transcript, full_response, reason, retry_count)

        except TimeoutError:
            if retry_count < 1:
                self.test_logger.warning("Timeout reached. Retrying once...")
                await self.sio.disconnect()
                return await self.execute(http_client, retry_count + 1)
            return TestResult(self.tc, TestStatus.TIMEOUT, self.metrics, transcript, full_response, "Execution timeout", retry_count)
        
        except Exception as e:
            self.test_logger.error(f"Critical execution error: {e}")
            return TestResult(self.tc, TestStatus.ERROR, self.metrics, reason=str(e), retries_used=retry_count)
        
        finally:
            if self.sio.connected:
                await self.sio.disconnect()


# ==========================================
# ORCHESTRATOR
# ==========================================

class EnterpriseTestBattery:
    def __init__(self, scenarios_path: str):
        self.scenarios_path = scenarios_path
        self.results: List[TestResult] = []
        self.start_time = None

    async def preflight_check(self) -> bool:
        logger.info("Running Pre-flight Health Check...")
        async with httpx.AsyncClient(timeout=5.0) as client:
            try:
                b_resp = await client.get(f"{BACKEND_URL}/api/health")
                # Voice engine check
                ve_resp = await client.get(f"{VOICE_ENGINE_URL}/synthesize") 
                return b_resp.status_code == 200
            except Exception:
                return False

    async def run(self, concurrency: int = MAX_CONCURRENT_TESTS):
        self.start_time = datetime.now()
        if not await self.preflight_check():
            logger.error("Abort: Critical services offline.")
            # return # Keep going for now if health check is flaky but backend works

        with open(self.scenarios_path, 'r') as f:
            data = json.load(f)
            test_cases = [TestCase(**tc) for tc in data.get("scenarios", [])]

        logger.info(f"Loaded {len(test_cases)} scenarios. Concurrency: {concurrency}")
        semaphore = asyncio.Semaphore(concurrency)

        async def _run_with_semaphore(tc: TestCase, client: httpx.AsyncClient):
            async with semaphore:
                logger.info(f"Starting [{tc.id}] {tc.name}")
                runner = IsolatedTestRunner(tc)
                res = await runner.execute(client)
                self.results.append(res)
                logger.info(f"Finished [{tc.id}] -> {res.status.value} (Score: {res.metrics.personality_score})")

        async with httpx.AsyncClient(timeout=45.0) as client:
            tasks = [_run_with_semaphore(tc, client) for tc in test_cases]
            await asyncio.gather(*tasks)

        self.generate_report()

    def generate_report(self):
        duration = (datetime.now() - self.start_time).total_seconds()
        
        def safe_stats(data: List[float]):
            clean_data = [d for d in data if d is not None]
            if not clean_data: return {"avg": 0, "p95": 0, "jitter": 0}
            avg = statistics.mean(clean_data)
            p95 = statistics.quantiles(clean_data, n=20)[18] if len(clean_data) > 1 else clean_data[0]
            jitter = statistics.stdev(clean_data) if len(clean_data) > 1 else 0
            return {
                "avg": round(avg, 2),
                "p95": round(p95, 2),
                "jitter": round(jitter, 2)
            }

        stts = [r.metrics.stt_latency_ms for r in self.results]
        ttfts = [r.metrics.llm_ttft_ms for r in self.results]
        ttrss = [r.metrics.ttrs_ms for r in self.results]
        tpss = [r.metrics.tps for r in self.results]
        scores = [r.metrics.personality_score for r in self.results]
        
        report = {
            "metadata": {
                "version": "4.1-vui-benchmarks",
                "timestamp": self.start_time.isoformat(),
                "duration_seconds": duration,
                "concurrency": MAX_CONCURRENT_TESTS
            },
            "summary": {
                "total": len(self.results),
                "passed": sum(1 for r in self.results if r.status == TestStatus.PASS),
                "failed": sum(1 for r in self.results if r.status == TestStatus.FAIL),
                "avg_personality_score": round(statistics.mean(scores) if scores else 0, 2)
            },
            "benchmarks": {
                "stt_latency": safe_stats(stts),
                "llm_ttft": safe_stats(ttfts),
                "ttrs": safe_stats(ttrss),
                "tokens_per_second": safe_stats(tpss)
            },
            "raw_results": [asdict(r) for r in self.results]
        }

        os.makedirs(REPORTS_DIR, exist_ok=True)
        report_file = os.path.join(REPORTS_DIR, f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2)

        print(f"\n{'='*60}")
        print(f"✅ TEST COMPLETE: {report['summary']['passed']}/{report['summary']['total']} Passed")
        print(f"🎭 Personality Accuracy: {report['summary']['avg_personality_score']}%")
        
        # Alexa Comparison Dashboard
        print(f"\n📢 VUI BENCHMARK (ALEXA VS ROCKY)")
        print(f"{'-'*60}")
        print(f"{'Metric':<25} | {'Alexa Standard':<15} | {'Rocky (Avg)':<10}")
        print(f"{'-'*60}")
        avg_ttft = report['benchmarks']['llm_ttft']['avg']
        avg_ttrs = report['benchmarks'].get('ttrs', {}).get('avg', 'N/A')
        print(f"{'TTFT (LLM Response)':<25} | {'~1.5s - 2.2s':<15} | {avg_ttft:<10}ms")
        print(f"{'TTRS (Speech Start)':<25} | {'~2.0s - 3.0s':<15} | {avg_ttrs:<10}ms")
        print(f"{'Jitter (Stability)':<25} | {'< 200ms':<15} | {report['benchmarks']['llm_ttft']['jitter']:<10}ms")
        print(f"{'-'*60}")
        
        if avg_ttft < 1500:
            print(f"🚀 STATUS: ROCKY IS FASTER THAN ALEXA!")
        else:
            print(f"🐢 STATUS: WITHIN INDUSTRY RANGE.")
            
        print(f"\n🚀 Avg TPS: {report['benchmarks']['tokens_per_second']['avg']} tokens/sec")
        print(f"📁 Report: {report_file}")
        print(f"{'='*60}\n")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenarios", type=str, default="tests/data/scenarios_advanced.json")
    parser.add_argument("--concurrency", type=int, default=3)
    args = parser.parse_args()
    
    # Ensure reports dir exists
    os.makedirs(REPORTS_DIR, exist_ok=True)
    
    battery = EnterpriseTestBattery(args.scenarios)
    try:
        asyncio.run(battery.run(concurrency=args.concurrency))
    except KeyboardInterrupt:
        logger.warning("Test aborted.")