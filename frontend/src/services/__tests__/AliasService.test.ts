import { describe, it, expect } from "vitest";
import { aliasService } from "../aliasService";

describe("AliasService", () => {
  it("should resolve exact light aliases", () => {
    // Based on the default aliases.json I created
    const resolved = aliasService.resolveLightAlias("techno mode");
    expect(resolved).toEqual(["light.studio_strip_1", "light.studio_strip_2"]);
  });

  it("should resolve fuzzy light aliases", () => {
    const resolved = aliasService.resolveLightAlias("turn on techno mode now");
    expect(resolved).toEqual(["light.studio_strip_1", "light.studio_strip_2"]);
  });

  it("should return null for unknown aliases", () => {
    const resolved = aliasService.resolveLightAlias("unknown command");
    expect(resolved).toBeNull();
  });

  it("should list available aliases", () => {
    const aliases = aliasService.getAvailableAliases();
    expect(aliases).toContain("techno mode");
    expect(aliases).toContain("studio lights");
  });
});
