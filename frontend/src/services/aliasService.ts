import fs from "fs";
import path from "path";
import { createTag } from "../lib/logger";

const log = createTag("AliasService");
const ALIAS_FILE = path.join(process.cwd(), "src/config/aliases.json");

interface AliasConfig {
  lights: Record<string, string[]>;
}

export class AliasService {
  private config: AliasConfig = { lights: {} };

  constructor() {
    this.loadConfig();
  }

  private loadConfig() {
    try {
      if (fs.existsSync(ALIAS_FILE)) {
        const raw = fs.readFileSync(ALIAS_FILE, "utf-8");
        this.config = JSON.parse(raw);
        log.info("Aliases loaded", { count: Object.keys(this.config.lights).length });
      }
    } catch (err: any) {
      log.error("Failed to load aliases", { error: err.message });
    }
  }

  /**
   * Resolves a natural language name to one or more device IDs.
   * Returns null if no alias is found.
   */
  resolveLightAlias(name: string): string[] | null {
    const normalized = name.toLowerCase().trim();
    
    // 1. Direct match
    if (this.config.lights[normalized]) {
      return this.config.lights[normalized];
    }

    // 2. Fuzzy match (if the name contains an alias)
    for (const [alias, ids] of Object.entries(this.config.lights)) {
      if (normalized.includes(alias)) {
        return ids;
      }
    }

    return null;
  }

  /**
   * Returns all known aliases for LLM context.
   */
  getAvailableAliases(): string[] {
    return Object.keys(this.config.lights);
  }
}

export const aliasService = new AliasService();
