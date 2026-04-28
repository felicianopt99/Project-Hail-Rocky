import { BaseSkill, SkillDefinition, RockyContext } from "../BaseSkill";
import { prisma } from "../../lib/db";

export class RecallMemorySkill extends BaseSkill {
  getDefinition(_context: RockyContext): SkillDefinition {
    return {
      name: "recall_memory",
      description:
        "Search Rocky's long-term memory for stored facts, preferences, habits, or tasks. " +
        "Use when Friend asks 'do you remember...', 'what do you know about...', " +
        "'what are my tasks', 'what do I like', or any question that might have been answered before.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword or phrase to search for in memory content. Leave empty to list all.",
          },
          category: {
            type: "string",
            enum: ["preference", "habit", "fact", "task"],
            description: "Filter by category. Omit to search all categories.",
          },
          limit: {
            type: "number",
            minimum: 1,
            maximum: 20,
            description: "Maximum number of memories to return. Defaults to 10.",
          },
        },
        required: [],
      },
    };
  }

  async execute(args: any, _context: RockyContext): Promise<any> {
    const { query, category, limit = 10 } = args;

    try {
      const where: any = {};
      if (category) where.category = category;
      if (query?.trim()) {
        where.content = { contains: query.trim() };
      }

      const memories = await prisma.memory.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: Math.min(limit, 20),
      });

      if (memories.length === 0) {
        return {
          success: true,
          found: 0,
          message: query
            ? `No memories found matching "${query}". Never stored, yes.`
            : "Memory bank empty. Nothing stored yet.",
          memories: [],
        };
      }

      return {
        success: true,
        found: memories.length,
        memories: memories.map(m => ({
          content: m.content,
          category: m.category,
          stored: m.timestamp.toISOString().split("T")[0],
        })),
      };
    } catch (err: any) {
      return { success: false, message: `Memory recall failed: ${err.message}` };
    }
  }
}
