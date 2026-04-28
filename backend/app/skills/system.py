import psutil
import time
# from vision_agents import tool

def get_uptime():
    return int(time.time() - psutil.boot_time())

# @tool
async def get_system_status(metric: str = "all") -> str:
    """
    Get Rocky's hardware status: CPU load, RAM usage, and system uptime.
    - metric: 'cpu', 'ram', 'uptime', or 'all'.
    """
    cpu_load = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory()
    ram_used_gb = round(mem.used / (1024**3), 1)
    ram_total_gb = round(mem.total / (1024**3), 1)
    uptime_hours = round(get_uptime() / 3600, 1)
    
    if metric == "cpu":
        return f"CPU Load: {cpu_load}%. Efficient, yes!"
    if metric == "ram":
        return f"RAM: {ram_used_gb}GB / {ram_total_gb}GB. Neural capacity is good!"
    if metric == "uptime":
        return f"System uptime: {uptime_hours} hours. Watch!"
        
    return f"CPU: {cpu_load}% | RAM: {ram_used_gb}/{ram_total_gb}GB | Uptime: {uptime_hours}h. Amaze!"
