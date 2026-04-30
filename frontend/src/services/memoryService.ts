import { prisma } from "../lib/db";
import { createTag } from "../lib/logger";

const log = createTag("MemoryService");

export class MemoryService {
  async addMemory(content: string, category: string = "general") {
    log.info("Adding new memory", { content, category });
    return await prisma.memory.create({
      data: {
        content,
        category,
      }
    });
  }

  async getRecentMemories(limit: number = 5, query?: string) {
    const rawMemories = await prisma.memory.findMany({
      orderBy: { timestamp: 'desc' },
      take: 20,
    });

    if (!query || query.length < 3) {
      return rawMemories.slice(0, limit);
    }

    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 3);

    const scored = rawMemories.map(m => {
      let score = 0;
      const content = m.content.toLowerCase();
      for (const kw of keywords) {
        if (content.includes(kw)) score += 1;
      }
      return { ...m, score };
    });

    return scored
      .sort((a, b) => b.score - a.score || b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async getMemoriesByCategory(category: string) {
    return await prisma.memory.findMany({
      where: { category },
      orderBy: { timestamp: 'desc' },
    });
  }

  async extractMemoriesFromChat(history: { role: string, content: string }[]) {
    if (history.length < 2) return;
    log.debug("Would extract memories from chat history", { count: history.length });
  }
}

export const memoryService = new MemoryService();
