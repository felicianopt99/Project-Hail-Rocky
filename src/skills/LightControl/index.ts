import { BaseSkill, SkillDefinition, RockyContext } from "../BaseSkill";
import { aliasService } from "../../services/aliasService";

const COLOR_TEMP_PRESETS: Record<string, number> = {
  candle:   2000,
  warm:     2700,
  soft:     3000,
  neutral:  4000,
  cool:     5500,
  daylight: 6500,
  focus:    6500,
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function currentBrightness(device: string, lights: Record<string, any>): number {
  const entry = Object.entries(lights).find(([id]) => id.includes(device));
  return entry ? (entry[1]?.brightness ?? 100) : 100;
}

export class LightControlSkill extends BaseSkill {
  getDefinition(context: RockyContext): SkillDefinition {
    const state = context.system.getState();
    const devices = [...state.availableDevices, "all"];
    const areas = Object.values(state.areas);
    const aliases = aliasService.getAvailableAliases();

    const liveSnapshot = Object.entries(state.lights)
      .map(([id, s]: [string, any]) => {
        const name = id.split(".")[1];
        const area = s.areaName ? `@${s.areaName}` : "";
        const temp = s.color_temp_kelvin ? ` ${s.color_temp_kelvin}K` : "";
        return `${name}${area}=${s.status} ${s.brightness ?? "?"}%${temp}`;
      })
      .join(" | ");

    return {
      name: "control_device",
      description:
        `Smart light controller. Live state → [${liveSnapshot || "no devices"}]. ` +
        `Devices: ${devices.join(", ")}. "all" targets every light simultaneously. ` +
        `AREAS: ${areas.join(", ")}. Use "area" parameter to control a whole room. ` +
        `ALIASES: ${aliases.join(", ")}. Use these for mood/vibe commands. ` +
        `ACTIONS: on (turn on + optional params), off (turn off), toggle (flip), ` +
        `set (adjust attributes while preserving power state), ` +
        `dim (reduce brightness, default −20%), brighten (increase brightness, default +20%). ` +
        `PARAMS: brightness 0–100, brightness_delta −100…+100 (relative), ` +
        `color (#RRGGBB or name: red/green/blue/yellow/orange/purple/pink/white/cyan/magenta/coral/gold/violet/lime/sky), ` +
        `color_temp preset (candle 2000K·warm 2700K·soft 3000K·neutral 4000K·cool 5500K·daylight/focus 6500K) ` +
        `or exact Kelvin as string, ` +
        `transition seconds (0.5–10), ` +
        `effect (flash·strobe·colorloop·none). ` +
        `EXAMPLES: "dim by 30%" → dim + brightness_delta:-30; ` +
        `"techno mode" → on + device:techno mode + color:magenta + effect:colorloop; ` +
        `"warm evening light" → on + color_temp:warm + brightness:40.`,
      parameters: {
        type: "object",
        properties: {
          device: {
            type: "string",
            description: `Device name, alias, or "all". Options: ${[...devices, ...aliases].join(", ")}.`,
          },
          area: {
            type: "string",
            description: `Area (room) name to control a whole room at once. Options: ${areas.join(", ")}.`,
            enum: areas,
          },
          action: {
            type: "string",
            enum: ["on", "off", "toggle", "set", "dim", "brighten"],
          },
          params: {
            type: "object",
            properties: {
              brightness: {
                type: "number",
                description: "Absolute brightness 0–100.",
              },
              brightness_delta: {
                type: "number",
                description: "Relative change. −30 = dim by 30%, +50 = brighten by 50%.",
              },
              color: {
                type: "string",
                description: "Color as #RRGGBB or name (red, green, blue, yellow, orange, purple, pink, white, cyan, magenta, coral, gold, violet, lime, sky).",
              },
              color_temp: {
                type: "string",
                description: "candle (2000K), warm (2700K), soft (3000K), neutral (4000K), cool (5500K), daylight/focus (6500K), or a Kelvin number.",
              },
              transition: {
                type: "number",
                description: "Fade duration in seconds (0.5–10).",
              },
              effect: {
                type: "string",
                enum: ["flash", "strobe", "colorloop", "none"],
                description: "flash=blink, strobe=rapid flash, colorloop=cycle colors, none=clear effect.",
              },
            },
          },
        },
        required: ["action"],
      },
    };
  }

  async execute(args: any, context: RockyContext): Promise<any> {
    let { device, action, params = {} } = args;
    const state = context.system.getState();

    // 0. Resolve Aliases
    if (device) {
      const resolvedIds = aliasService.resolveLightAlias(device);
      if (resolvedIds) {
        if (resolvedIds.length === 1 && resolvedIds[0] === "light.all") {
          device = "all";
        } else {
          // If it resolves to multiple, we treat it as a batch operation
          const results = await Promise.all(
            resolvedIds.map(id => context.system.controlDevice(id, action, params))
          );
          const ok = results.filter(r => r.success).length;
          return {
            success: ok > 0,
            alias: device,
            resolved: resolvedIds,
            message: ok > 0 
              ? `Alias "${device}" triggered: ${ok}/${resolvedIds.length} devices responding.`
              : `Alias "${device}" failed: ${results[0]?.error || "Home Assistant unreachable"}.`
          };
        }
      }
    }

    // Resolve color_temp preset → kelvin number
    if (params.color_temp !== undefined) {
      const raw = String(params.color_temp).toLowerCase().trim();
      let presetKey = raw;
      if (raw.includes("warm")) presetKey = "warm";
      else if (raw.includes("soft")) presetKey = "soft";
      else if (raw.includes("cool")) presetKey = "cool";
      else if (raw.includes("candle")) presetKey = "candle";
      else if (raw.includes("neutral")) presetKey = "neutral";
      else if (raw.includes("daylight") || raw.includes("focus")) presetKey = "daylight";

      params.color_temp_kelvin = COLOR_TEMP_PRESETS[presetKey] ?? (parseInt(raw) || 4000);
      delete params.color_temp;
    }

    if (params.color) {
      const c = params.color.toLowerCase().trim();
      if (c === "warm white" || c === "warmwhite") params.color = "warm";
    }

    let effectiveAction = action;
    if (action === "dim" || action === "brighten") {
      effectiveAction = "set";
      // For "all", brightness is resolved per-entity below; only pre-compute for single device
      if (params.brightness === undefined && device !== "all") {
        const delta = params.brightness_delta ?? (action === "dim" ? -20 : 20);
        const current = currentBrightness(device, state.lights);
        params.brightness = clamp(current + delta, 0, 100);
        delete params.brightness_delta;
      }
    }

    if (params.brightness_delta !== undefined && params.brightness === undefined) {
      const referenceDevice = args.area ? (Object.entries(state.lights).find(([_, info]) => (info as any).areaName === args.area)?.[0] || "") : (device === "all" ? Object.keys(state.lights)[0] ?? "" : device);
      const current = currentBrightness(referenceDevice, state.lights);
      params.brightness = clamp(current + params.brightness_delta, 0, 100);
      delete params.brightness_delta;
    }

    if (args.area) {
      const success = await context.system.controlArea(args.area, effectiveAction, params);
      return {
        success,
        area: args.area,
        action: effectiveAction,
        params,
        message: success 
          ? `Room ${args.area} set to ${effectiveAction}. Amaze!`
          : `Failed to control room ${args.area}. Bad math!`
      };
    }

    if (!device) return { success: false, message: "No device or area specified. Bad math!" };
    if (device === "all") {
      const entities = Object.keys(state.lights);
      if (!entities.length) return { success: false, message: "No devices available." };

      const results = await Promise.all(
        entities.map(async (entityId) => {
          const perParams = { ...params };
          if (action === "dim" || action === "brighten") {
            // Resolve brightness per-entity so each light dims from its own current level
            const delta = args.params?.brightness_delta ?? (action === "dim" ? -20 : 20);
            const cur = currentBrightness(entityId.split(".")[1], state.lights);
            perParams.brightness = clamp(cur + delta, 0, 100);
            delete perParams.brightness_delta;
          }
          return context.system.controlDevice(entityId, effectiveAction, perParams);
        })
      );

      const ok = results.filter(r => r.success).length;
      return {
        success: ok > 0,
        affected: ok,
        total: entities.length,
        message: ok > 0 
          ? `${ok}/${entities.length} lights set to ${effectiveAction}. Amaze!`
          : `Failed to control all lights: ${results[0]?.error || "HA Link offline"}. Bad math!`,
      };
    }

    const result = await context.system.controlDevice(device, effectiveAction, params);

    const updated = context.system.getState();
    const fullId = Object.keys(updated.lights).find((k) => k.includes(device));
    const newState = fullId ? updated.lights[fullId] : null;

    return {
      success: result.success,
      device,
      action: effectiveAction,
      params,
      newState,
      message: result.success
        ? `${device}: ${effectiveAction}` +
          (params.brightness !== undefined ? ` at ${params.brightness}%` : "") +
          (params.color ? ` color ${params.color}` : "") +
          (params.color_temp_kelvin ? ` ${params.color_temp_kelvin}K` : "") +
          (params.effect && params.effect !== "none" ? ` effect:${params.effect}` : "") +
          "."
        : `Failed to control ${device}: ${result.error || "Check device availability"}. Bad math!`,
    };
  }
}
