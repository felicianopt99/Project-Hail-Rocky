/**
 * Checks if the text looks like a raw LLM tool schema dump.
 * Used to filter out noisy fallback responses.
 */
export function looksLikeToolSchemaDump(text: string): boolean {
  const normalized = (text || "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith("{\"name\"") ||
    normalized.includes("\"parameters\"") ||
    normalized.includes("\"properties\"") ||
    normalized.includes("function get_weather") ||
    normalized.includes("smart light controller") ||
    normalized.includes("available tools") ||
    (normalized.includes("{") && normalized.includes("}") && normalized.includes("\"name\":"))
  );
}

import { aliasService } from "../../services/aliasService";

/**
 * Parses a direct command for lights/devices as a fallback for the LLM.
 */
export function parseDirectLightCommand(
  message: string,
  devices: string[]
): { device: string; action: "on" | "off" | "toggle"; params?: any } | null {
  const text = (message || "").toLowerCase().trim();
  if (!text) return null;

  const action: "on" | "off" | "toggle" | null =
    /(turn on|switch on|power on|liga|ligar|acende|acender)\b/.test(text)
      ? "on"
      : /(turn off|switch off|power off|desliga|desligar|apaga|apagar)\b/.test(text)
      ? "off"
      : /(toggle|alterna|inverte)\b/.test(text)
      ? "toggle"
      : null;

  if (!action) return null;

  if (/\b(all|todas|todos|everything|lights)\b/.test(text)) {
    return { device: "all", action };
  }

  // 1. Check Aliases first
  const resolved = aliasService.resolveLightAlias(text);
  if (resolved) {
    // For direct command, we return the alias name as the "device" 
    // and the Skill will handle the multi-resolve.
    // Or we can return the first device. 
    // Let's return the alias name if it was a fuzzy match.
    const allAliases = aliasService.getAvailableAliases();
    const matchedAlias = allAliases.find(a => text.includes(a));
    if (matchedAlias) return { device: matchedAlias, action };
  }

  const normalized = text.replace(/[^\w\s]/g, " ");
  const candidates = (devices || []).map((d) => {
    const lower = d.toLowerCase();
    const pretty = lower.replace(/[._-]/g, " ");
    const tail = lower.includes(".") ? lower.split(".").pop()! : lower;
    const tailPretty = tail.replace(/[._-]/g, " ");
    return { original: d, variants: [lower, pretty, tail, tailPretty] };
  });

  for (const c of candidates) {
    if (c.variants.some((v) => v && normalized.includes(v))) {
      return { device: c.original, action };
    }
  }

  return null;
}
