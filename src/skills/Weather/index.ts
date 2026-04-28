import { BaseSkill, SkillDefinition, RockyContext } from "../BaseSkill";
import { createTag } from "../../lib/logger";

const log = createTag("Skill:Weather");

export class WeatherSkill extends BaseSkill {
  getDefinition(context: RockyContext): SkillDefinition {
    const weather = context.system.getState().weather;
    return {
      name: "get_weather",
      description: `Get real-time weather and forecasts. Current: ${weather.temp}°C, ${weather.desc} in ${weather.city}.`,
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description: "Target period for the weather query.",
            enum: ["current", "tomorrow", "forecast"]
          },
          detail: {
            type: "boolean",
            description: "Whether to provide a detailed technical breakdown."
          }
        },
        required: ["period"]
      }
    };
  }

  async execute(args: any, context: RockyContext): Promise<any> {
    const { period, detail } = args;
    const weather = context.system.getState().weather;
    
    log.info("Executing weather query", { period, detail });

    if (period === "tomorrow" && weather.tomorrow) {
      const resp = `Tomorrow in ${weather.city}: Expected highs of ${weather.tomorrow.tempMax}°C and lows of ${weather.tomorrow.tempMin}°C. Atmospheric state: ${weather.tomorrow.desc}.`;
      return { success: true, message: resp, data: weather.tomorrow };
    }

    if (period === "forecast" && weather.tomorrow) {
      const resp = `Short-term forecast for ${weather.city}: Current ${weather.temp}°C (${weather.desc}). Tomorrow: ${weather.tomorrow.tempMax}°C/${weather.tomorrow.tempMin}°C (${weather.tomorrow.desc}).`;
      return { success: true, message: resp, data: weather };
    }
    
    const currentResp = `Current readout for ${weather.city}: Temperature is exactly ${weather.temp}°C. Visual spectrum indicates ${weather.desc}.`;
    return { 
      success: true, 
      message: currentResp,
      data: {
        temp: weather.temp,
        desc: weather.desc,
        city: weather.city
      }
    };
  }
}
