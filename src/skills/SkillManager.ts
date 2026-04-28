import { BaseSkill, RockyContext } from "./BaseSkill";
import { LightControlSkill } from "./LightControl";
import { WeatherSkill } from "./Weather";
import { ExecuteRoutineSkill } from "./ExecuteRoutine";
import { TimerSkill } from "./Timer";
import { VolumeSkill } from "./Volume";
import { MemorySkill } from "./Memory";
import { RecallMemorySkill } from "./RecallMemory";
import { SystemStatusSkill } from "./SystemStatus";
import { MediaControlSkill } from "./MediaControl";

export class SkillManager {
  private skills: Map<string, BaseSkill> = new Map();
  
  // Shortcuts for core skills that need direct access
  public timerSkill!: TimerSkill;
  public volumeSkill!: VolumeSkill;

  constructor() {
    this.loadBuiltinSkills();
  }

  /**
   * Loads all core skills into the registry.
   */
  private loadBuiltinSkills() {
    this.timerSkill = new TimerSkill();
    this.volumeSkill = new VolumeSkill();

    const builtins = [
      new LightControlSkill(),
      new WeatherSkill(),
      new ExecuteRoutineSkill(),
      this.timerSkill,
      this.volumeSkill,
      new MemorySkill(),
      new RecallMemorySkill(),
      new SystemStatusSkill(),
      new MediaControlSkill(),
    ];

    builtins.forEach(skill => this.registerSkill(skill));
  }

  /**
   * Registers a new skill in the system.
   * Can be used for dynamic plugin loading.
   */
  public registerSkill(skill: BaseSkill) {
    // We use a dummy context to get the name for the registry key.
    // In a real plugin system, the name would be a static property or metadata.
    const mockContext: any = { system: { getState: () => ({ availableDevices: [], areas: {}, lights: {}, weather: {} }) } };
    try {
      const definition = skill.getDefinition(mockContext);
      this.skills.set(definition.name, skill);
    } catch (e) {
      // Fallback to class name if getDefinition fails without full context
      this.skills.set(skill.constructor.name.toLowerCase(), skill);
    }
  }

  /**
   * Returns OpenAI-compatible tool definitions for all registered skills.
   */
  public getDefinitions(context: RockyContext) {
    return Array.from(this.skills.values()).map(skill => ({
      type: "function",
      function: skill.getDefinition(context)
    }));
  }

  /**
   * Executes a skill by name.
   */
  public async executeSkill(name: string, args: any, context: RockyContext) {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill "${name}" not found in registry.`);
    }
    return await skill.execute(args, context);
  }

  /**
   * Returns all registered skill instances.
   */
  public getAllSkills() {
    return Array.from(this.skills.values());
  }
}

export const skillManager = new SkillManager();
