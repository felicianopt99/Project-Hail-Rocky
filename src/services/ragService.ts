import si from "systeminformation";
import { createTag } from "../lib/logger";

const log = createTag("RAGService");

export class RAGService {
  async getSystemContext(query?: string) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    const { systemStateManager } = await import("../managers/SystemStateManager");
    const state = systemStateManager.getState();

    let devices = Object.entries(state.lights);

    // If a query is provided, filter devices to keep only those mentioned or relevant
    if (query && query.length > 3) {
      const q = query.toLowerCase();
      const filtered = devices.filter(([id, info]: [string, any]) => {
        const name = id.split(".")[1].toLowerCase();
        const area = info.areaName?.toLowerCase() || "";
        return q.includes(name) || q.includes(area) || q.includes("luz") || q.includes("light");
      });
      // If we filtered out EVERYTHING, keep the original list (safety)
      if (filtered.length > 0) devices = filtered;
    }

    const deviceContext = devices
      .map(([id, info]: [string, any]) => `${id.split('.')[1]}:${info.status}${info.brightness < 100 ? `(${info.brightness}%)` : ""}`)
      .join(", ");

    log.debug("System context generated", { deviceCount: devices.length });

    return `Time:${timeStr} | Weather:${state.weather.temp}C, ${state.weather.desc} | Devices: ${deviceContext || "None"}`;
  }

  // Future: Add semantic search for memories here
}

export const ragService = new RAGService();
