import { createTag } from "../lib/logger";

const log = createTag("HealthMonitor");

export enum ServiceStatus {
  HEALTHY = "HEALTHY",
  DEGRADED = "DEGRADED",
  OFFLINE = "OFFLINE"
}

class ServiceHealthMonitor {
  private failures: Map<string, number> = new Map();
  private lastCheck: Map<string, number> = new Map();
  private readonly FAILURE_THRESHOLD = 3;
  private readonly RECOVERY_TIME_MS = 300000; // 5 minutes

  recordFailure(serviceName: string) {
    const current = this.failures.get(serviceName) || 0;
    this.failures.set(serviceName, current + 1);
    this.lastCheck.set(serviceName, Date.now());
    log.warn(`Service failure recorded`, { service: serviceName, count: current + 1 });
  }

  recordSuccess(serviceName: string) {
    if (this.failures.get(serviceName) && this.failures.get(serviceName)! > 0) {
      this.failures.set(serviceName, 0);
      log.info(`Service is now healthy`, { service: serviceName });
    }
  }

  isAvailable(serviceName: string): boolean {
    const failures = this.failures.get(serviceName) || 0;
    if (failures < this.FAILURE_THRESHOLD) return true;

    const last = this.lastCheck.get(serviceName) || 0;
    if (Date.now() - last > this.RECOVERY_TIME_MS) {
      log.info(`Attempting recovery check`, { service: serviceName });
      this.failures.set(serviceName, this.FAILURE_THRESHOLD - 1); // Allow one attempt
      return true;
    }

    return false;
  }

  getStatus() {
    const status: Record<string, string> = {};
    const services = Array.from(new Set([...this.failures.keys(), "GROQ_STT", "NVIDIA_LLM", "GEMINI_LLM", "KOKORO_TTS", "PIPER_TTS"]));
    
    for (const service of services) {
      const failures = this.failures.get(service) || 0;
      if (failures === 0) status[service] = "healthy";
      else if (failures < this.FAILURE_THRESHOLD) status[service] = "degraded";
      else status[service] = "offline";
    }
    return status;
  }
}

export const healthMonitor = new ServiceHealthMonitor();
