import { SystemStateManager } from "../managers/SystemStateManager";
import { EventBus } from "../lib/eventBus";

/**
 * RockyContext provides skills with access to system services 
 * without relying on global singletons.
 */
export interface RockyContext {
  sessionId: string;
  system: SystemStateManager;
  events: EventBus;
}

export interface SkillDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export abstract class BaseSkill {
  /**
   * Returns the definition of the skill for the LLM tool calling.
   * Can use context to provide live state (e.g., current devices).
   */
  abstract getDefinition(context: RockyContext): SkillDefinition;

  /**
   * Executes the skill logic.
   * @param args Arguments passed by the LLM.
   * @param context System context for this execution.
   */
  abstract execute(args: any, context: RockyContext): Promise<any>;
}
