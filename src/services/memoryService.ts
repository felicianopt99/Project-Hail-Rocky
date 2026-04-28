import { prisma } from "../lib/db";
import { llmService } from "./llmService";
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
    // Get more than limit to allow for relevance sorting
    const rawMemories = await prisma.memory.findMany({
      orderBy: { timestamp: 'desc' },
      take: 20,
    });

    if (!query || query.length < 3) {
      return rawMemories.slice(0, limit);
    }

    // Simple relevance pass: keywords from query
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 3);
    
    const scored = rawMemories.map(m => {
      let score = 0;
      const content = m.content.toLowerCase();
      for (const kw of keywords) {
        if (content.includes(kw)) score += 1;
      }
      return { ...m, score };
    });

    // Sort by score then by date
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

  /**
   * Brainstorming / Extraction: 
   * Uses the LLM to look at recent history and identify if something worth remembering was said.
   */
  async extractMemoriesFromChat(history: { role: string, content: string }[]) {
    if (history.length < 2) return;

    const extractionPrompt = `Analyze the chat history and extract ONLY NEW personal facts or preferences about the user.
Exclude examples or general information. 
If no new facts are present, return an empty array [].
Respond with a JSON array of strings.

Chat History:
${history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

JSON Response:`;

    try {
      // We use a simplified call here to avoid recursion with tools
      const response = await llmService.simpleChat([
        { role: "user", content: extractionPrompt }
      ]);

      const factsMatch = response.match(/\[[\s\S]*?\]/);
      if (factsMatch) {
        try {
          const facts = JSON.parse(factsMatch[0]);
          for (const fact of facts) {
            await this.addMemory(fact, "user_preference");
          }
        } catch (parseErr) {
          log.warn("Failed to parse extracted memories JSON", { response });
        }
      }
    } catch (e: any) {
      log.error("Failed to extract memories", { error: e.message });
    }
  }
}

export const memoryService = new MemoryService();
