import { BaseSkill, SkillDefinition, RockyContext } from "../BaseSkill";
import si from "systeminformation";

export class SystemStatusSkill extends BaseSkill {
  getDefinition(context: RockyContext): SkillDefinition {
    return {
      name: "get_system_status",
      description:
        `Get Rocky's hardware status: CPU load, RAM usage, core temperature, ` +
        `and system uptime. Use when user asks "how's the system?", ` +
        `"what's the CPU temperature?", "RAM usage", "system health", etc.`,
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: ["cpu", "ram", "temperature", "uptime", "all"],
            description: "Which metric to report. 'all' returns everything.",
          },
        },
        required: ["metric"],
      },
    };
  }

  async execute(args: any, context: RockyContext): Promise<any> {
    const { metric } = args;

    try {
      const [cpu, mem, temp, timeData] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.cpuTemperature(),
        si.time(),
      ]);

      const toGB = (bytes: number) => Math.round((bytes / (1024 ** 3)) * 10) / 10;
      const cpuLoad = Math.round(cpu.currentLoad);
      const ramUsed = toGB(mem.active);
      const ramTotal = toGB(mem.total);
      const coreTemp = Math.round(temp.main || 0);
      const uptimeHours = Math.round((timeData.uptime || 0) / 3600);

      if (metric === "cpu") {
        return { success: true, data: `CPU Load: ${cpuLoad}%.` };
      }
      if (metric === "ram") {
        return { success: true, data: `RAM: ${ramUsed}GB / ${ramTotal}GB (${Math.round(ramUsed/ramTotal*100)}% used).` };
      }
      if (metric === "temperature") {
        return { success: true, data: `Core Temperature: ${coreTemp}°C.` };
      }
      if (metric === "uptime") {
        return { success: true, data: `System uptime: ${uptimeHours} hours.` };
      }

      // "all"
      return {
        success: true,
        data: `CPU: ${cpuLoad}% | RAM: ${ramUsed}/${ramTotal}GB | Temp: ${coreTemp}°C | Uptime: ${uptimeHours}h.`,
      };
    } catch (err: any) {
      return {
        success: false,
        data: `System metrics unavailable: ${err.message}`,
      };
    }
  }
}
