import psutil
from fastapi import APIRouter

router = APIRouter()


@router.get("/metrics")
async def get_metrics():
    cpu = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory()
    temps = {}
    try:
        raw = psutil.sensors_temperatures()
        for chip, entries in (raw or {}).items():
            if entries:
                temps[chip] = entries[0].current
    except Exception:
        pass

    temp = next(iter(temps.values()), 0.0)

    return {
        "cpu": round(cpu, 1),
        "ram": round(mem.percent, 1),
        "totalRam": round(mem.total / (1024**3), 1),
        "temp": round(temp, 1),
    }


@router.get("/health")
async def get_health():
    return {"status": "ok"}
