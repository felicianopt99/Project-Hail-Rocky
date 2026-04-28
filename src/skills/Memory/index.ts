import { BaseSkill, SkillDefinition, RockyContext } from "../BaseSkill";
import { prisma } from "../../lib/db";

export class MemorySkill extends BaseSkill {
  getDefinition(context: RockyContext): SkillDefinition {
    return {
      name: "save_memory",
      description:
        `Save a fact, preference, or reminder to Rocky's long-term memory. ` +
        `Use when the user says "remember that...", "I like...", "my favorite is...", ` +
        `"don't forget...", or shares a personal preference or important fact. ` +
        `Also use to store habits ("I usually wake up at 7am") or tasks ("I need to buy milk").`,
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The fact or preference to remember.",
          },
          category: {
            type: "string",
            enum: ["preference", "habit", "fact", "task"],
            description: "Type of memory: preference (likes/dislikes), habit (routines), fact (info), task (to-do).",
          },
        },
        required: ["content", "category"],
      },
    };
  }

  async execute(args: any, context: RockyContext): Promise<any> {
    const { content, category } = args;

    if (!content?.trim()) {
      return { success: false, message: "Cannot store empty memory." };
    }

    try {
      await prisma.memory.create({
        data: {
          content: content.trim(),
          category: category || "fact",
        },
      });

      return {
        success: true,
        message: `Stored in memory: "${content.trim()}". I will not forget, yes.`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to save memory: ${err.message}`,
      };
    }
  }
}
