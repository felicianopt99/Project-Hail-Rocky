import asyncio
import httpx
import time
import pytest
import statistics

BASE_URL = "http://localhost:8000" # Should be configurable
CONCURRENT_REQUESTS = 50
TOTAL_REQUESTS = 100

async def fire_request(client, endpoint, payload):
    start = time.perf_counter()
    try:
        if payload:
            response = await client.post(endpoint, json=payload, timeout=30.0)
        else:
            response = await client.get(endpoint, timeout=30.0)
        end = time.perf_counter()
        return {
            "status": response.status_code,
            "latency": end - start,
            "success": 200 <= response.status_code < 300
        }
    except Exception as e:
        return {
            "status": "error",
            "latency": time.perf_counter() - start,
            "success": False,
            "error": str(e)
        }

@pytest.mark.asyncio
async def test_api_stress_health():
    """Fire 100 concurrent requests to /api/health."""
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        tasks = [fire_request(client, "/api/health", None) for _ in range(TOTAL_REQUESTS)]
        results = await asyncio.gather(*tasks)
    
    successes = [r for r in results if r["success"]]
    latencies = [r["latency"] for r in results]
    
    print(f"\n--- Stress Test Result (/api/health) ---")
    print(f"Total: {TOTAL_REQUESTS}, Success: {len(successes)}")
    if latencies:
        print(f"Avg Latency: {statistics.mean(latencies):.4f}s")
        print(f"P95 Latency: {statistics.quantiles(latencies, n=20)[18]:.4f}s")
    
    assert len(successes) / TOTAL_REQUESTS > 0.95 # 95% success rate required

@pytest.mark.asyncio
async def test_api_stress_brain_chat():
    """Stress test the brain chat endpoint (no streaming consumption)."""
    payload = {"sid": "stress-test", "content": "How's the weather?"}
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        # Fewer concurrent requests for the heavier brain endpoint
        tasks = [fire_request(client, "/api/brain/chat", payload) for _ in range(20)]
        results = await asyncio.gather(*tasks)
    
    successes = [r for r in results if r["success"]]
    assert len(successes) > 0 # At least some should succeed
