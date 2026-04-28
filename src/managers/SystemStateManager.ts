import { EventEmitter } from "events";
import { prisma } from "../lib/db";
import { getHALights, controlHALight, HAResponse } from "../services/homeAssistantService";
import { haWS } from "../services/homeAssistantWS";
import si from "systeminformation";
import { createTag } from "../lib/logger";

const log = createTag("SystemStateManager");

export interface SystemState {
  lights: Record<string, any>;
  logs: { timestamp: number; message: string }[];
  systemMode: string;
  availableDevices: string[];
  protocols: any[];
  areas: Record<string, string>; // area_id → area_name
  weather: {
    temp: number;
    desc: string;
    city: string;
    tomorrow?: {
      tempMax: number;
      tempMin: number;
      desc: string;
    };
  };
}

export class SystemStateManager extends EventEmitter {
  private state: SystemState = {
    lights: {},
    logs: [],
    systemMode: "dashboard",
    availableDevices: [],
    protocols: [],
    areas: {},
    weather: { temp: 18, desc: "Clear Sky", city: "Local" },
  };

  private syncInterval: NodeJS.Timeout | null = null;
  private weatherInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;
  private persistTimeout: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  async initialize() {
    log.info("Initializing...");

    // Load state from DB
    let dbSystemState = await prisma.systemState.findUnique({ where: { id: "default" } });
    if (!dbSystemState) {
      dbSystemState = await prisma.systemState.create({
        data: {
          id: "default",
          mode: "dashboard",
          lights: JSON.stringify({ lights: {} }),
        },
      });
    }

    const dbLogs = await prisma.log.findMany({
      orderBy: { timestamp: "desc" },
      take: 50,
    });

    // Seed Protocols if empty
    const count = await prisma.protocol.count();
    if (count === 0) {
      log.info("Seeding default protocols...");
      const defaults = [
        { 
          id: "cinema", 
          label: "Cinema Mode", 
          description: "Optimized for theater immersion. Choose sub-modes for different viewing phases.", 
          icon: "Zap", 
          color: "text-yellow-500",
          settings: JSON.stringify({ 
            brightness: 10, 
            speed: 50, 
            color: "#ffaa00",
            transition: "smooth",
            subMode: "immersion",
            palette: ["#ffaa00", "#ff4400", "#000000"]
          })
        },
        { 
          id: "music", 
          label: "Music Sync", 
          description: "Neural reactivity engine. Professional-grade synchronization, Ape Labs style.", 
          icon: "Activity", 
          color: "text-magenta-500",
          settings: JSON.stringify({ 
            brightness: 80, 
            speed: 100, 
            color: "#ff00ff",
            sensitivity: 85,
            syncMode: "master",
            offBeatBrightness: 20,
            palette: ["#ff00ff", "#00ffff", "#4400ff"]
          })
        },
        { 
          id: "sunset", 
          label: "Sunset Mode", 
          description: "Atmospheric stellar transition. Smooth fade through multiple sunset spectra.", 
          icon: "Moon", 
          color: "text-orange-500",
          settings: JSON.stringify({ 
            brightness: 40, 
            speed: 20, 
            color: "#ff4400",
            transition: "smooth",
            palette: ["#ff4400", "#ff8800", "#4400ff", "#000044"]
          })
        },
        { 
          id: "focus", 
          label: "Focus Mode", 
          description: "Cool white light for maximum neural productivity and wavelength stability.", 
          icon: "Zap", 
          color: "text-cyan-400",
          settings: JSON.stringify({ 
            brightness: 100, 
            speed: 50, 
            color: "#ffffff",
            transition: "step"
          })
        }
      ];
      for (const d of defaults) {
        await prisma.protocol.create({ data: d });
      }
    }

    const protocols = await prisma.protocol.findMany();

    this.state = {
      ...this.state,
      systemMode: dbSystemState.mode,
      lights: JSON.parse(dbSystemState.lights).lights || {},
      logs: dbLogs.map((l) => ({ timestamp: l.timestamp.getTime(), message: l.message })),
      protocols: protocols.map((p) => ({ ...p, settings: JSON.parse(p.settings) })),
    };

    if (this.state.logs.length === 0) {
      this.addLog("System initialized. Rocky is ready, yes!");
    }

    // Initialize HA connection
    this.setupHomeAssistant();
    this.setupWeather();
    this.setupHardwareStats();

    // Initial syncs
    await this.syncHA();
    await this.syncWeather();

    log.info("Initialization complete.");
    this.emit("initialized", this.state);
  }

  stop() {
    log.info("Stopping intervals...");
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.weatherInterval) clearInterval(this.weatherInterval);
    if (this.statsInterval) clearInterval(this.statsInterval);
    if (this.persistTimeout) clearTimeout(this.persistTimeout);
    
    this.syncInterval = null;
    this.weatherInterval = null;
    this.statsInterval = null;
    this.persistTimeout = null;
  }

  private setupHomeAssistant() {
    haWS.connect();

    haWS.on("areas_loaded", ({ areaMap, entityAreaMap }: {
      areaMap: Map<string, string>;
      entityAreaMap: Map<string, string>;
    }) => {
      // Rebuild areas record from the map
      const areas: Record<string, string> = {};
      for (const [areaId, areaName] of areaMap.entries()) {
        areas[areaId] = areaName;
      }
      this.state.areas = areas;

      // Re-enrich all existing lights with area data
      for (const id of Object.keys(this.state.lights)) {
        const areaInfo = haWS.getAreaForEntity(id);
        this.state.lights[id] = {
          ...this.state.lights[id],
          areaId: areaInfo.areaId || undefined,
          areaName: areaInfo.areaName || undefined,
        };
      }
      this.state.areas = areas;

      this.emit("areas_updated", areas);
      log.info(`Areas loaded: ${Object.keys(areas).length} areas.`);

      // ─── KEY FIX: re-sync HA now that area registry is available ───────────
      // The initial syncHA() runs at startup before the WS auth+registry cycle
      // completes (~1-2s). Re-running it here guarantees every light gets its
      // areaId/areaName and the clients receive an updated state broadcast.
      this.syncHA().then(() => {
        this.emit("state_synced", this.state);
      }).catch((err) => {
        log.error("Re-sync after areas_loaded failed", { error: err.message });
      });
    });

    haWS.on("state_changed", (newState: any) => {
      const id = newState.entity_id;
      const name = id.split(".")[1];
      const areaInfo = haWS.getAreaForEntity(id);

      const isOff = ["off", "unavailable", "unknown", "idle", "paused", "standby"].includes(newState.state);
      this.state.lights[id] = {
        status: isOff ? "off" : "on",
        rawState: newState.state,
        color: newState.attributes.rgb_color
          ? `#${newState.attributes.rgb_color.map((c: number) => c.toString(16).padStart(2, "0")).join("")}`
          : "#ffffff",
        brightness: newState.attributes.brightness
          ? Math.round((newState.attributes.brightness / 255) * 100)
          : 100,
        color_temp_kelvin: newState.attributes.color_temp_kelvin || (newState.attributes.color_temp ? Math.round(1000000 / newState.attributes.color_temp) : undefined),
        min_color_temp_kelvin: newState.attributes.min_color_temp_kelvin || (newState.attributes.max_mireds ? Math.round(1000000 / newState.attributes.max_mireds) : undefined),
        max_color_temp_kelvin: newState.attributes.max_color_temp_kelvin || (newState.attributes.min_mireds ? Math.round(1000000 / newState.attributes.min_mireds) : undefined),
        areaId: areaInfo.areaId || undefined,
        areaName: areaInfo.areaName || undefined,
      };

      if (!this.state.availableDevices.includes(name)) {
        this.state.availableDevices.push(name);
      }

      this.emit("device_updated", { device: id, state: this.state.lights[id] });
      this.persistState();
    });

    this.syncInterval = setInterval(() => this.syncHA(), 300000); // 5 minutes
  }

  private setupWeather() {
    this.weatherInterval = setInterval(() => this.syncWeather(), 600000);
  }

  private setupHardwareStats() {
    this.statsInterval = setInterval(async () => {
      try {
        const [cpu, mem, temp] = await Promise.all([
          si.currentLoad(),
          si.mem(),
          si.cpuTemperature(),
        ]);

        const toGB = (bytes: number) => Math.round((bytes / (1024 ** 3)) * 10) / 10;
        const stats = {
          cpu: Math.round(cpu.currentLoad),
          ram: toGB(mem.active),
          totalRam: toGB(mem.total),
          temp: Math.round(temp.main || 45),
        };

        this.emit("stats_updated", stats);
      } catch (err: any) {
        log.debug("Hardware stats collection failed (likely normal in some environments)", { error: err.message });
      }
    }, 2000);
  }

  async syncHA() {
    log.info("Syncing with Home Assistant...");
    try {
      const haLights = await getHALights();
      if (haLights && haLights.length > 0) {
        const newLights: Record<string, any> = {};
        const dynamicDevices: string[] = [];

        haLights.forEach((haLight: any) => {
          const id = haLight.entity_id;
          const name = id.split(".")[1];
          dynamicDevices.push(name);

          const areaInfo = haWS.getAreaForEntity(id);
          newLights[id] = {
            status: ["off", "unavailable", "unknown", "idle", "paused", "standby"].includes(haLight.state) ? "off" : "on",
            rawState: haLight.state,
            color: haLight.attributes.rgb_color
              ? `#${haLight.attributes.rgb_color.map((c: number) => c.toString(16).padStart(2, "0")).join("")}`
              : "#ffffff",
            brightness: haLight.attributes.brightness
              ? Math.round((haLight.attributes.brightness / 255) * 100)
              : 100,
            color_temp_kelvin: haLight.attributes.color_temp_kelvin || (haLight.attributes.color_temp ? Math.round(1000000 / haLight.attributes.color_temp) : undefined),
            min_color_temp_kelvin: haLight.attributes.min_color_temp_kelvin || (haLight.attributes.max_mireds ? Math.round(1000000 / haLight.attributes.max_mireds) : undefined),
            max_color_temp_kelvin: haLight.attributes.max_color_temp_kelvin || (haLight.attributes.min_mireds ? Math.round(1000000 / haLight.attributes.min_mireds) : undefined),
            areaId: areaInfo.areaId || undefined,
            areaName: areaInfo.areaName || undefined,
          };
        });

        this.state.lights = newLights;
        this.state.availableDevices = Array.from(new Set(dynamicDevices));
        this.emit("state_synced", this.state);
        this.persistState();
      }
    } catch (error: any) {
      log.error("Error syncing HA", { error: error.message });
    }
  }

  async syncWeather() {
    try {
      const lat = process.env.WEATHER_LAT || 38.72;
      const lon = process.env.WEATHER_LON || -9.13;
      const city = process.env.WEATHER_CITY || "Lisboa";

      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto`
      );
      if (!res.ok) {
        log.warn("Weather API error", { status: res.status });
        return;
      }
      const data = await res.json();

      if (data.current) {
        const getWeatherDesc = (code: number) => {
          if (code === 0) return "Clear Sky";
          if (code >= 1 && code <= 3) return "Partly Cloudy";
          if (code >= 45 && code <= 48) return "Fog";
          if (code >= 51 && code <= 67) return "Light Rain";
          if (code >= 71 && code <= 77) return "Snow";
          if (code >= 80 && code <= 82) return "Showers";
          if (code >= 95) return "Thunderstorm";
          return "Variable";
        };

        this.state.weather = {
          temp: Math.round(data.current.temperature_2m),
          desc: getWeatherDesc(data.current.weather_code),
          city: city as string,
          tomorrow: {
            tempMax: Math.round(data.daily.temperature_2m_max[1]),
            tempMin: Math.round(data.daily.temperature_2m_min[1]),
            desc: getWeatherDesc(data.daily.weather_code[1]),
          },
        };
        this.emit("weather_updated", this.state.weather);
      }
    } catch (e: any) {
      log.error("Error fetching weather", { error: e.message });
    }
  }

  getState(): SystemState {
    return { ...this.state };
  }

  async setMode(mode: string, overrideSettings?: any) {
    log.info(`Setting mode: ${mode}`);
    this.state.systemMode = mode;
    this.emit("mode_updated", mode);

    this.addLog(`System mode shifted to ${mode.toUpperCase()}. Adjusting nodes, yes.`);

    await prisma.systemState.update({
      where: { id: "default" },
      data: { mode: mode },
    });

    try {
      const protocol = this.state.protocols.find((p) => p.id === mode);
      let settings = protocol ? protocol.settings : null;

      if (overrideSettings) {
        settings = { ...settings, ...overrideSettings };
      }

      if (settings) {
        const { brightness, color, targetLights } = settings;
        const entitiesToControl = targetLights && targetLights.length > 0
          ? targetLights
          : Object.keys(this.state.lights);

        for (const entity of entitiesToControl) {
          await this.controlDevice(entity, "on", { brightness, color });
        }
      }
    } catch (e: any) {
      log.error("Error applying mode settings", { error: e.message });
    }

    // Re-sync after mode change to confirm states
    setTimeout(() => this.syncHA(), 2000);
  }

  async controlDevice(device: string, action: string, params?: any): Promise<HAResponse> {
    log.info(`controlDevice: ${device} ${action}`, { params });
    const result = await controlHALight(device, action, params);
    log.info(`controlDevice result: ${device} ${result.success}`, { error: result.error });
    if (result.success && this.state.lights[device]) {
      if (action === "toggle") {
        this.state.lights[device].status = this.state.lights[device].status === "on" ? "off" : "on";
      } else if (action === "set" && params) {
        Object.assign(this.state.lights[device], params);
      } else if (action === "on" || action === "off") {
        this.state.lights[device].status = action;
      }
      this.emit("device_updated", { device, state: this.state.lights[device] });
      this.addLog(`Light ${device.split(".")[1] || device} ${action} confirmed. Good, good, good.`);
    } else if (!result.success) {
      this.addLog(`Failed to ${action} ${device.split(".")[1] || device}: ${result.error || "Unknown error"}`);
    }
    return result;
  }

  async controlArea(areaIdOrName: string, action: string, params?: any) {
    // Try to find by name first if not an ID
    let areaId = areaIdOrName;
    const areas = this.state.areas;
    
    if (!areas[areaId]) {
      const entry = Object.entries(areas).find(([_, name]) => name.toLowerCase() === areaIdOrName.toLowerCase());
      if (entry) areaId = entry[0];
    }

    if (!areas[areaId]) {
      log.warn("Area not found for control", { area: areaIdOrName });
      return false;
    }

    log.info(`Control Area: ${areas[areaId]} (${areaId}) -> ${action}`, { params });

    // Map "on/off" to HA light services
    const domain = "light";
    const service = action === "on" ? "turn_on" : action === "off" ? "turn_off" : action === "toggle" ? "toggle" : "turn_on";
    
    // Build service data
    const serviceData: any = { area_id: areaId };
    if (params) {
      if (params.brightness !== undefined) serviceData.brightness_pct = params.brightness;
      if (params.color) serviceData.rgb_color = this.hexToRgb(params.color);
      if (params.color_temp_kelvin) serviceData.color_temp_kelvin = params.color_temp_kelvin;
      if (params.transition) serviceData.transition = params.transition;
    }

    haWS.callService(domain, service, serviceData);
    
    this.addLog(`Room ${areas[areaId]} ${action} triggered. Efficient, yes.`);
    
    // Optimistic state update (partial)
    for (const [id, info] of Object.entries(this.state.lights)) {
      if ((info as any).areaId === areaId) {
        if (action === "on" || action === "off") (this.state.lights[id] as any).status = action;
        if (params?.brightness) (this.state.lights[id] as any).brightness = params.brightness;
      }
    }
    
    this.emit("state_synced", this.state);
    return true;
  }

  private hexToRgb(hex: string): [number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : [255, 255, 255];
  }

  async executeRoutine(routineId: string) {
    const entities = Object.keys(this.state.lights);
    let message = "";

    if (routineId === "home") {
      for (const entity of entities) {
        await this.controlDevice(entity, "on", { brightness: 100, color: "#ffffff" });
      }
      message = "Routine 'I'm Home' activated. All lights on, yes.";
    } else if (routineId === "night") {
      for (const entity of entities) {
        await this.controlDevice(entity, "on", { brightness: 10, color: "#ff8800" });
      }
      message = "Routine 'Night Mode' activated. Minimum intensity, sleep well, yes.";
    } else if (routineId === "away") {
      for (const entity of entities) {
        await this.controlDevice(entity, "off");
      }
      message = "Routine 'Going Out' activated. Lights off. Save energy, very good.";
    }

    if (message) {
      this.addLog(message);
      setTimeout(() => this.syncHA(), 2000);
    }
  }

  async controlMediaPlayer(entity: string, action: string, params?: { volume?: number; source?: string }): Promise<{ success: boolean; error?: string }> {
    const HA_BASE_URL = process.env.HA_BASE_URL;
    if (!HA_BASE_URL) return { success: false, error: "Home Assistant not configured" };

    const serviceMap: Record<string, string> = {
      play:          "media_play",
      pause:         "media_pause",
      stop:          "media_stop",
      next:          "media_next_track",
      previous:      "media_previous_track",
      turn_on:       "turn_on",
      turn_off:      "turn_off",
      volume_up:     "volume_up",
      volume_down:   "volume_down",
      volume_set:    "volume_set",
      select_source: "select_source",
    };
    const service = serviceMap[action];
    if (!service) return { success: false, error: `Unknown media action: ${action}` };

    const serviceData: any = { entity_id: entity };
    if (action === "volume_set" && params?.volume !== undefined) serviceData.volume_level = params.volume / 100;
    if (action === "select_source" && params?.source) serviceData.source = params.source;

    haWS.callService("media_player", service, serviceData);
    this.addLog(`Media ${action} → ${entity.split(".")[1] || entity}. Amaze!`);
    return { success: true };
  }

  addLog(message: string) {
    const logEntry = { timestamp: Date.now(), message };
    this.state.logs.unshift(logEntry);
    if (this.state.logs.length > 50) this.state.logs.pop();
    
    this.emit("new_log", logEntry);
    
    prisma.log.create({ data: { message } }).catch((err) => {
      log.error("Failed to save log to DB", { error: err.message });
    });
  }

  private async persistState() {
    if (this.persistTimeout) return; // Already debouncing

    this.persistTimeout = setTimeout(async () => {
      try {
        await prisma.systemState.update({
          where: { id: "default" },
          data: {
            lights: JSON.stringify({ lights: this.state.lights }),
            mode: this.state.systemMode,
          },
        });
      } catch (e: any) {
        log.error("Persistence error", { error: e.message });
      } finally {
        this.persistTimeout = null;
      }
    }, 5000); // Debounce database writes to every 5s
  }

  async saveProtocol(data: any) {
    const updated = await prisma.protocol.update({
      where: { id: data.id },
      data: { settings: JSON.stringify(data.settings) },
    });
    
    const idx = this.state.protocols.findIndex((p) => p.id === data.id);
    if (idx !== -1) {
      this.state.protocols[idx].settings = data.settings;
    } else {
      const parsed = { ...updated, settings: JSON.parse(updated.settings) };
      this.state.protocols.push(parsed);
    }

    this.emit("protocol_updated", { id: data.id, settings: data.settings });
    this.addLog(`Protocol ${data.id.toUpperCase()} updated in neural memory, yes.`);
  }

  async createProtocol(data: any) {
    const newProtocol = await prisma.protocol.create({
      data: {
        id: data.id,
        label: data.label,
        description: data.description || "Custom neural protocol",
        icon: data.icon || "Cpu",
        color: data.color || "text-white",
        settings: JSON.stringify(data.settings || { brightness: 100, speed: 500, color: "#ffffff", targetLights: [] }),
      },
    });
    const parsed = { ...newProtocol, settings: JSON.parse(newProtocol.settings) };
    this.state.protocols.push(parsed);
    this.emit("protocol_created", parsed);
    this.addLog(`New neural protocol ${data.id.toUpperCase()} integrated.`);
  }

  async deleteProtocol(id: string) {
    await prisma.protocol.delete({ where: { id } });
    this.state.protocols = this.state.protocols.filter((p) => p.id !== id);
    this.emit("protocol_deleted", { id });
    this.addLog(`Protocol ${id.toUpperCase()} erased from memory.`);
  }
}

export const systemStateManager = new SystemStateManager();
