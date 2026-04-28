import { BaseSkill, SkillDefinition, RockyContext } from "../BaseSkill";
import { RockyEvents } from "../../lib/eventBus";

export class VolumeSkill extends BaseSkill {
  private currentLevel: number = 80;

  getDefinition(): SkillDefinition {
    return {
      name: "adjust_volume",
      description:
        `Control Rocky's speech volume. Current: ${this.currentLevel}%. ` +
        `Use for: "louder", "quieter", "volume up", "mute", "set volume to 50".`,
      parameters: {
        type: "object",
        properties: {
          level: {
            type: "number",
            description: "Absolute volume 0-100. Use this if user says a specific number.",
          },
          direction: {
            type: "string",
            enum: ["up", "down", "mute", "unmute"],
            description: "Relative adjustment direction.",
          },
          step: {
            type: "number",
            description: "Amount to change by (default 20). Only used with direction.",
          },
        },
      },
    };
  }

  async execute(args: any, context: RockyContext): Promise<any> {
    const { level, direction, step = 20 } = args;

    if (direction === "mute") {
      this.currentLevel = 0;
    } else if (direction === "unmute") {
      this.currentLevel = 80;
    } else if (direction === "up") {
      this.currentLevel = Math.min(100, this.currentLevel + step);
    } else if (direction === "down") {
      this.currentLevel = Math.max(0, this.currentLevel - step);
    } else if (level !== undefined) {
      this.currentLevel = Math.max(0, Math.min(100, level));
    } else {
      return { success: false, message: "Specify a level or direction." };
    }

    // Emit event for the socket layer to forward to the client
    context.events.emit(RockyEvents.UI_HINT, { 
      sessionId: context.sessionId, 
      type: "set_volume", 
      value: { level: this.currentLevel } 
    });

    return {
      success: true,
      volume: this.currentLevel,
      message: this.currentLevel === 0
        ? "Muted. I am silent now, yes."
        : `Volume set to ${this.currentLevel}%.`,
    };
  }
}
