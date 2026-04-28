import { createTag } from "../lib/logger";

const log = createTag("HA-Service");

const HA_TIMEOUT = 3000;
const HA_RETRIES = 2;

export interface HAResponse {
  success: boolean;
  error?: string;
}

const NAMED_COLORS: Record<string, number[]> = {
  red:     [255, 0,   0  ],
  green:   [0,   200, 0  ],
  blue:    [0,   0,   255],
  yellow:  [255, 255, 0  ],
  orange:  [255, 120, 0  ],
  purple:  [130, 0,   180],
  pink:    [255, 100, 150],
  white:   [255, 255, 255],
  cyan:    [0,   220, 255],
  magenta: [255, 0,   220],
  coral:   [255, 80,  80 ],
  gold:    [255, 200, 0  ],
  violet:  [180, 0,   255],
  lime:    [120, 255, 0  ],
  sky:     [0,   160, 255],
  warm:    [255, 170, 80 ],
  cool:    [180, 210, 255],
  "warm white": [255, 170, 80],
};

function hexToRgb(hex: string): number[] | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function kelvinToMireds(kelvin: number): number {
  return Math.round(1_000_000 / kelvin);
}

async function haRequest(endpoint: string, payload: any): Promise<HAResponse> {
  const HA_BASE_URL = process.env.HA_BASE_URL;
  const HA_ACCESS_TOKEN = process.env.HA_ACCESS_TOKEN;

  if (!HA_BASE_URL || !HA_ACCESS_TOKEN) {
    log.warn("Variables not configured. Simulation mode.");
    return { success: false, error: "Home Assistant not configured" };
  }

  log.debug(`HA Request: ${endpoint.split("/").pop()}`, { payload });

  try {
    const res = await fetch(`${HA_BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HA_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(HA_TIMEOUT),
    });

    if (!res.ok) {
      const errorMsg = `Home Assistant error (${res.status})`;
      log.warn(`Request failed`, { status: res.status, text: res.statusText });
      return { success: false, error: errorMsg };
    }

    return { success: true };
  } catch (e: any) {
    const isTimeout = e.name === "TimeoutError" || e.message?.includes("timeout");
    const errorMsg = isTimeout ? "Home Assistant connection timed out" : `HA error: ${e.message}`;
    log.error(`Request error`, { error: e.message });
    return { success: false, error: errorMsg };
  }
}

async function haRequestWithRetry(endpoint: string, payload: any): Promise<HAResponse> {
  for (let attempt = 0; attempt <= HA_RETRIES; attempt++) {
    const result = await haRequest(endpoint, payload);
    if (result.success) return result;
    if (attempt < HA_RETRIES) {
      const delay = 500 * (attempt + 1);
      log.debug(`HA request failed, retrying in ${delay}ms`, { attempt: attempt + 1, endpoint });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return { success: false, error: "Home Assistant request failed after retries" };
}

let _entityCache: any[] | null = null;
let _entityCacheTs = 0;

/**
 * Fetches all controllable entities from Home Assistant.
 */
export async function getHAEntities(bypassCache = false): Promise<any[]> {
  const HA_BASE_URL = process.env.HA_BASE_URL;
  const HA_ACCESS_TOKEN = process.env.HA_ACCESS_TOKEN;
  if (!HA_BASE_URL || !HA_ACCESS_TOKEN) return [];

  // 30-second cache to avoid hammering HA on entity resolution
  if (!bypassCache && _entityCache && Date.now() - _entityCacheTs < 30_000) {
    return _entityCache;
  }

  try {
    const res = await fetch(`${HA_BASE_URL}/api/states`, {
      headers: {
        Authorization: `Bearer ${HA_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(HA_TIMEOUT),
    });
    if (!res.ok) throw new Error(`HA ${res.status}`);
    const states = await res.json();
    
    const supportedDomains = ["light.", "switch.", "fan.", "input_boolean.", "media_player."];
    _entityCache = states.filter((s: any) => 
      supportedDomains.some(domain => s.entity_id.startsWith(domain))
    );
    _entityCacheTs = Date.now();
    return _entityCache!;
  } catch (err: any) {
    log.error("Error fetching entities", { error: err.message });
    return [];
  }
}

// Keep legacy export for compatibility if needed elsewhere, but point to new function
export const getHALights = getHAEntities;

async function resolveEntityId(device: string): Promise<string | null> {
  const supportedDomains = ["light.", "switch.", "fan.", "input_boolean.", "media_player."];
  if (supportedDomains.some(d => device.startsWith(d))) return device;

  const entities = await getHAEntities();
  const normalized = device.toLowerCase().replace(/\s+/g, "_");

  // Exact suffix match first (light.studio → studio)
  const exact = entities.find((l: any) => l.entity_id.split(".")[1] === normalized);
  if (exact) return exact.entity_id;

  // Partial match
  const partial = entities.find((l: any) =>
    l.entity_id.toLowerCase().includes(normalized) ||
    normalized.includes(l.entity_id.split(".")[1])
  );
  if (partial) {
    log.debug(`Resolved device`, { query: device, result: partial.entity_id });
    return partial.entity_id;
  }

  log.warn(`Device not found`, { device });
  return null;
}

function buildTurnOnPayload(entity_id: string, params: any): any {
  const payload: any = { entity_id };
  log.debug(`Building payload for ${entity_id}`, { params });

  if (params.brightness !== undefined) {
    payload.brightness_pct = Math.round(params.brightness);
  }

  // color_temp_kelvin is the standard parameter for light.turn_on in modern HA
  if (params.color_temp_kelvin !== undefined) {
    payload.color_temp_kelvin = params.color_temp_kelvin;
  } else if (params.color !== undefined) {
    const name = params.color.toLowerCase();
    const rgb = NAMED_COLORS[name] ?? (params.color.startsWith("#") ? hexToRgb(params.color) : null);
    if (rgb) payload.rgb_color = rgb;
  }

  if (params.transition !== undefined) {
    payload.transition = params.transition;
  }

  if (params.effect && params.effect !== "none") {
    // HA uses "flash" as a separate field, everything else goes in effect
    if (params.effect === "flash") {
      payload.flash = "short";
    } else {
      payload.effect = params.effect;
    }
  } else if (params.effect === "none") {
    payload.effect = "none";
  }

  return payload;
}

export async function controlHAEntity(
  device: string,
  action: string,
  params: any = {}
): Promise<HAResponse> {
  const HA_BASE_URL = process.env.HA_BASE_URL;
  const HA_ACCESS_TOKEN = process.env.HA_ACCESS_TOKEN;

  if (!HA_BASE_URL || !HA_ACCESS_TOKEN) {
    console.warn("[HA] Not configured. Simulation mode.");
    return { success: false, error: "Home Assistant not configured" };
  }

  // Fan-out for "all"
  if (device === "all") {
    const entities = await getHAEntities();
    log.info(`Fan-out to ALL entities`, { count: entities.length });
    const results = await Promise.all(
      entities.map((l: any) => controlHAEntity(l.entity_id, action, params))
    );
    const anySuccess = results.some(r => r.success);
    if (!anySuccess && results.length > 0) {
      return { success: false, error: results[0].error || "Failed to control devices" };
    }
    return { success: anySuccess };
  }

  const entity_id = await resolveEntityId(device);
  if (!entity_id) return { success: false, error: `Device "${device}" not found` };

  const domain = entity_id.split(".")[0];
  
  try {
    if (action === "toggle") {
      return haRequestWithRetry(`/api/services/${domain}/toggle`, { entity_id });
    }

    if (action === "off") {
      const payload: any = { entity_id };
      // Only include transition for lights
      if (params.transition !== undefined && domain === "light") {
        payload.transition = params.transition;
      }
      return haRequestWithRetry(`/api/services/${domain}/turn_off`, payload);
    }

    // on / set / dim / brighten → turn_on with attributes
    // Only send light-specific attributes (brightness, color, etc.) to the light domain
    const payload = domain === "light" 
      ? buildTurnOnPayload(entity_id, params) 
      : { entity_id };
      
    return haRequestWithRetry(`/api/services/${domain}/turn_on`, payload);
  } catch (err: any) {
    log.error(`Error controlling device`, { device: entity_id, error: err.message });
    return { success: false, error: err.message };
  }
}

// Keep legacy export for compatibility
export const controlHALight = controlHAEntity;

export async function checkHAHealth(): Promise<HAResponse> {
  const HA_BASE_URL = process.env.HA_BASE_URL;
  const HA_ACCESS_TOKEN = process.env.HA_ACCESS_TOKEN;

  if (!HA_BASE_URL || !HA_ACCESS_TOKEN) {
    return { success: false, error: "Variables HA_BASE_URL or HA_ACCESS_TOKEN are missing in .env" };
  }

  try {
    const res = await fetch(`${HA_BASE_URL}/api/config`, {
      headers: {
        Authorization: `Bearer ${HA_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(HA_TIMEOUT),
    });

    if (res.status === 401) {
      return { success: false, error: "Invalid HA_ACCESS_TOKEN (Unauthorized)" };
    }

    if (!res.ok) {
      return { success: false, error: `HA returned status ${res.status}` };
    }

    return { success: true };
  } catch (e: any) {
    const isTimeout = e.name === "TimeoutError" || e.message?.includes("timeout");
    return { 
      success: false, 
      error: isTimeout ? "Connection timed out (Check HA_BASE_URL)" : `Connection failed: ${e.message}` 
    };
  }
}
