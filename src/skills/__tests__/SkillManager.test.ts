import { describe, it, expect, vi } from "vitest";
import { skillManager } from "../SkillManager";
import { BaseSkill } from "../BaseSkill";

describe("SkillManager", () => {
  it("should have built-in skills registered", () => {
    const skills = skillManager.getAllSkills();
    expect(skills.length).toBeGreaterThan(5);
    
    const names = skills.map(s => (s as any).constructor.name);
    expect(names).toContain("LightControlSkill");
    expect(names).toContain("WeatherSkill");
  });

  it("should return definitions with context", () => {
    const mockContext: any = {
      system: {
        getState: () => ({
          availableDevices: ["light.test"],
          areas: { "area1": "Living Room" },
          lights: {},
          protocols: [],
          weather: { temp: 20, desc: "sunny", city: "Porto" }
        })
      }
    };

    const definitions = skillManager.getDefinitions(mockContext);
    expect(definitions).toBeDefined();
    expect(definitions.some(d => d.function.name === "control_device")).toBe(true);
  });

  it("should register new skills dynamically", () => {
    class CustomSkill extends BaseSkill {
      getDefinition() {
        return {
          name: "custom_action",
          description: "test",
          parameters: { type: "object", properties: {} }
        };
      }
      async execute() { return "ok"; }
    }

    const custom = new CustomSkill();
    skillManager.registerSkill(custom);
    
    const skills = skillManager.getAllSkills();
    expect(skills.some(s => s instanceof CustomSkill)).toBe(true);
  });
});
