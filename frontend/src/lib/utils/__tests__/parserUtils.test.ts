import { describe, it, expect } from "vitest";
import { parseDirectLightCommand } from "../parserUtils";

describe("parseDirectLightCommand", () => {
  const devices = ["light.living_room", "switch.kitchen_fan", "light.bedroom", "light.quarto"];

  it("should parse English 'on' commands", () => {
    expect(parseDirectLightCommand("turn on living room", devices)).toEqual({
      device: "light.living_room",
      action: "on"
    });
  });

  it("should parse Portuguese 'liga' commands", () => {
    expect(parseDirectLightCommand("liga a luz do quarto", devices)).toEqual({
      device: "light.quarto",
      action: "on"
    });
  });

  it("should parse 'off' commands", () => {
    expect(parseDirectLightCommand("turn off kitchen fan", devices)).toEqual({
      device: "switch.kitchen_fan",
      action: "off"
    });
  });

  it("should parse 'all' commands", () => {
    expect(parseDirectLightCommand("turn off all lights", devices)).toEqual({
      device: "all",
      action: "off"
    });
  });

  it("should return null for unrelated text", () => {
    expect(parseDirectLightCommand("what is the weather?", devices)).toBeNull();
  });

  it("should handle mixed casing", () => {
    expect(parseDirectLightCommand("LIGA O QUARTO", devices)).toEqual({
      device: "light.quarto",
      action: "on"
    });
  });
});
