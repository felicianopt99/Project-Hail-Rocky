import { prisma } from "../lib/db";
import { llmService } from "../services/llmService";
import { systemStateManager } from "./SystemStateManager";
import { createTag } from "../lib/logger";

const log = createTag("MemoryManager");

export class MemoryManager {
  private lastAnalysis: number = 0;
  private ANALYSIS_INTERVAL = 1000 * 60 * 60; // 1 hour

  async analyzeHabits() {
    const now = Date.now();
    if (now - this.lastAnalysis < this.ANALYSIS_INTERVAL) return;
    
    log.info("Analyzing user habits from message history...");
    this.lastAnalysis = now;

    // Get last 200 messages to find patterns
    const recentMessages = await prisma.message.findMany({
      orderBy: { timestamp: "desc" },
      take: 200,
    });

    if (recentMessages.length < 10) return;

    const analysisPrompt = `Analyze the following message history and identify behavioral patterns or "habits".
Look for things like:
- Specific times the user asks for things (e.g., "every morning at 8am").
- Sequences of actions (e.g., "when I turn on the TV, dim the lights").
- Preferences (e.g., "I like the kitchen bright").

Respond with a JSON array of "habit" objects:
{
  "pattern": "description of the pattern",
  "confidence": 0-1,
  "action": "suggested proactive action"
}

History:
${recentMessages.reverse().map(m => `${m.role}: ${m.text}`).join("\n")}

JSON Response:`;

    try {
      const response = await llmService.simpleChat([{ role: "system", content: analysisPrompt }]);
      const habitsMatch = response.match(/\[[\s\S]*?\]/);
      if (habitsMatch) {
        const habits = JSON.parse(habitsMatch[0]);
        for (const habit of habits) {
          if (habit.confidence > 0.7) {
            log.info("New habit identified", { pattern: habit.pattern, confidence: habit.confidence });
            await prisma.memory.create({
              data: {
                content: `Habit: ${habit.pattern}. Recommended Action: ${habit.action}`,
                category: "habit",
              }
            });
          }
        }
      }
    } catch (e: any) {
      log.error("Habit analysis failed", { error: e.message });
    }
  }

  async getProactiveSuggestions() {
    const habits = await prisma.memory.findMany({
      where: { category: "habit" },
      orderBy: { timestamp: "desc" },
      take: 3
    });
    return habits;
  }
}

export const memoryManager = new MemoryManager();
