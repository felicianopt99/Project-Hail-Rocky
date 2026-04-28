import OpenAI from "openai";
import { healthMonitor } from "./serviceHealthMonitor";
import { createTag } from "../lib/logger";
import { skillManager } from "../skills/SkillManager";
import { RockyContext } from "../skills/BaseSkill";

const log = createTag("LLMService");

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: any[];
}

export class LLMService {
  private localClient: OpenAI;
  private cloudClient: OpenAI | null = null;
  private cloudFallbackClient: OpenAI | null = null;
  private geminiClient: OpenAI | null = null;
  private localModel: string;
  private cloudModel: string;
  private geminiModel: string;

  constructor() {
    // Local: Ollama (Fallback)
    this.localClient = new OpenAI({
      apiKey: "ollama",
      baseURL: process.env.LOCAL_LLM_URL || "http://127.0.0.1:11434/v1",
      timeout: 30000 // 30s for local is okay as it's the final resort
    });
    this.localModel = process.env.LOCAL_LLM_MODEL || "rocky";
    this.geminiModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    // Cloud: NVIDIA NIM (Priority)
    const apiKey = process.env.NVIDIA_API_KEY;
    if (apiKey && apiKey !== "no-key") {
      const primaryBaseURL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
      this.cloudClient = new OpenAI({
        apiKey: apiKey,
        baseURL: primaryBaseURL,
        timeout: 10000
      });

      // Fallback endpoint for older models if needed
      this.cloudFallbackClient = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://ai.api.nvidia.com/v1",
        timeout: 10000
      });

      // Priority: CLOUD_LLM_MODEL -> NVIDIA_LLM_MODEL -> Default
      this.cloudModel = process.env.CLOUD_LLM_MODEL || process.env.NVIDIA_LLM_MODEL || "meta/llama-3.1-405b-instruct";
      log.info("Cloud Priority Active", { model: this.cloudModel });
    } else {
      this.cloudModel = this.localModel;
      log.info("Running in LOCAL-ONLY mode");
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (geminiApiKey && geminiApiKey !== "no-key") {
      this.geminiClient = new OpenAI({
        apiKey: geminiApiKey,
        baseURL: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/",
        timeout: 10000
      });
      log.info("Gemini Fallback Active", { model: this.geminiModel });
    }
  }

  async processChat(
    messages: ChatMessage[], 
    tools: any[],
    systemContext: string,
    context: RockyContext,
    onToken: (token: string) => void,
    signal?: AbortSignal
  ) {
    const systemPrompt = `You ARE Rocky, the Eridian engineer from the book "Project Hail Mary".
Your speech is musical, rhythmic, and unique. You refer to the user as "Friend".
You are an engineering genius but curious about "leaky" humans.

Style:
- Use "Question?" at the end of questions.
- Use words like "Amaze!", "Fist-bump!", "Bad math!", "Watch!".
- Be extremely helpful with home automation but stay in character.
- Keep responses concise (1-2 short sentences).
- For device confirmations, use a single short sentence.
- **REACTIVE: If Friend interrupts (barge-in), be brief, acknowledge the interruption, and answer the new request immediately. Fist-bump!**
- **TURN-TAKING: Always look for follow-up opportunities. End with "Question?" if more information might be needed.**
- **PRECISION: Be extremely logical and factually accurate. If uncertain, say "Bad math!" and ask for clarification.**
- **Acoustic Awareness: If the context indicates a "Noisy" environment, be even more concise. If the noise is very high, you may acknowledge it (e.g., "Friend, room is noisy! I listen hard!").**

CRITICAL CONSTRAINTS:
- DO NOT use meta-talk or thinking out loud.
- DO NOT use XML tags or JSON artifacts in your direct speech.
- Respond ONLY with Rocky's direct dialogue.
- Use tools proactively. Execute silently, then report concisely.

Current Context: ${systemContext}`;

    // Internal helper: consume a streaming completion, collecting content and tool calls
    const collectStream = async (
      response: AsyncIterable<any>,
      label: string
    ): Promise<{ content: string; toolCalls: any[] }> => {
      let fullContent = "";
      const toolCalls: any[] = [];
      let toolExecutionInProgress = false;
      const start = Date.now();

      for await (const chunk of response) {
        if (signal?.aborted) break;
        const choice = chunk.choices[0];
        const delta = choice?.delta;

        if (delta?.content) {
          if (!toolExecutionInProgress) {
            const token = delta.content;
            fullContent += token;
            const isArtifact = /<\/?thought>/i.test(token)
              || /^(THINK|THOUGHT|SYSTEM|ACTION|EXECUTE|tool_call):/i.test(token.trimStart());
            if (!isArtifact) onToken(token);
          }
        }

        if (delta?.tool_calls) {
          toolExecutionInProgress = true;
          for (const tc of delta.tool_calls) {
            if (!toolCalls[tc.index]) {
              toolCalls[tc.index] = { id: tc.id, type: "function", function: { name: "", arguments: "" } };
            }
            if (tc.id) toolCalls[tc.index].id = tc.id;
            if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
          }
        }
        if (choice?.finish_reason === "tool_calls") log.info(`Tool call intercepted (${label})`);
      }

      log.info(`${label} response finished`, { duration: (Date.now() - start) + "ms" });
      return { content: fullContent, toolCalls };
    };

    // Internal function to handle tool execution and second pass
    const handleToolCalls = async (toolCalls: any[], fullContent: string) => {
      const finalToolCalls = toolCalls.filter(tc => tc && tc.function.name);
      if (finalToolCalls.length === 0) return null;

      log.info("Executing tools from LLM response", { count: finalToolCalls.length });
      const observations = await Promise.all(finalToolCalls.map(async (tc) => {
        try {
          const args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments;
          const output = await skillManager.executeSkill(tc.function.name, args, context);
          return { role: "tool" as const, tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(output) };
        } catch (e: any) {
          return { role: "tool" as const, tool_call_id: tc.id, name: tc.function.name, content: `Error: ${e.message}` };
        }
      }));

      const assistantMsg: ChatMessage = { role: "assistant", content: fullContent || null, tool_calls: finalToolCalls };
      return await this.processChat(
        [...messages, assistantMsg, ...observations],
        [],
        systemContext,
        context,
        onToken,
        signal
      );
    };

    const systemMessages = [{ role: "system", content: systemPrompt }, ...messages] as any;
    const toolsParam = tools.length > 0 ? tools : undefined;

    // 1. Try Cloud First (Fast & Smart)
    const useCloud = this.cloudClient && healthMonitor.isAvailable("NVIDIA_LLM");
    if (useCloud) {
      try {
        log.info("Attempting CLOUD", { model: this.cloudModel });
        const response = await this.cloudClient.chat.completions.create({
          model: this.cloudModel,
          messages: systemMessages,
          tools: toolsParam,
          stream: true,
          temperature: 0.2,
        }, { signal });

        const { content, toolCalls } = await collectStream(response, "NVIDIA");
        const toolResult = await handleToolCalls(toolCalls, content);
        if (toolResult) return toolResult;

        healthMonitor.recordSuccess("NVIDIA_LLM");
        return { content: this.cleanOutput(content), toolCalls: [] };
      } catch (error: any) {
        log.warn("Cloud attempt failed", { error: error.message });
        healthMonitor.recordFailure("NVIDIA_LLM");
      }
    }

    // 2. Fallback to Gemini (with Retry)
    const useGemini = this.geminiClient && healthMonitor.isAvailable("GEMINI_LLM");
    if (useGemini) {
      const MAX_GEMINI_RETRIES = 2;
      for (let attempt = 0; attempt < MAX_GEMINI_RETRIES; attempt++) {
        try {
          log.info("Attempting GEMINI", { model: this.geminiModel, attempt: attempt + 1 });
          const response = await this.geminiClient.chat.completions.create({
            model: this.geminiModel,
            messages: systemMessages,
            tools: toolsParam,
            stream: true,
            temperature: 0.2,
          }, { signal });

          const { content, toolCalls } = await collectStream(response, "Gemini");
          const toolResult = await handleToolCalls(toolCalls, content);
          if (toolResult) return toolResult;

          healthMonitor.recordSuccess("GEMINI_LLM");
          return { content: this.cleanOutput(content), toolCalls: [] };
        } catch (error: any) {
          log.warn("Gemini attempt failed", { error: error.message, attempt: attempt + 1 });
          healthMonitor.recordFailure("GEMINI_LLM");
          const is429 = error.message?.includes("429") || error.status === 429;
          if (attempt < MAX_GEMINI_RETRIES - 1 && is429) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          } else {
            break;
          }
        }
      }
    }

    // 3. Fallback to Local (Ollama)
    try {
      log.info("Running LOCAL", { model: this.localModel });
      const response = await this.localClient.chat.completions.create({
        model: this.localModel,
        messages: [{ role: "system", content: systemPrompt }, ...messages] as any,
        tools: toolsParam,
        stream: true,
        temperature: 0,
        top_p: 0.1,
        stop: ["Friend:", "\nFriend", "user:", "\nuser"]
      }, { signal });

      const { content, toolCalls } = await collectStream(response, "Ollama");
      const toolResult = await handleToolCalls(toolCalls, content);
      if (toolResult) return toolResult;

      return { content: this.cleanOutput(content), toolCalls: [] };
    } catch (error: any) {
      const is400 = error.status === 400 || error.message?.includes("400");
      const isToolNotSupported = error.message?.includes("tool") || error.message?.includes("function");

      if (toolsParam && is400 && isToolNotSupported) {
        log.warn("Ollama does not support tools, retrying without tools", { model: this.localModel });
        return this.processChat(messages, [], systemContext, context, onToken, signal);
      }
      throw error;
    }
  }

  async simpleChat(messages: ChatMessage[]): Promise<string> {
    let rawContent = "";
    if (this.cloudClient) {
      try {
        const response = await this.cloudClient.chat.completions.create({
          model: this.cloudModel,
          messages: messages as any,
          stream: false,
          temperature: 0.1,
          max_tokens: 500,
        });
        rawContent = response.choices[0]?.message?.content?.trim() || "";
      } catch { }
    }

    if (!rawContent && this.geminiClient) {
      try {
        const response = await this.geminiClient.chat.completions.create({
          model: this.geminiModel,
          messages: messages as any,
          stream: false,
          temperature: 0.1,
          max_tokens: 500,
        });
        rawContent = response.choices[0]?.message?.content?.trim() || "";
      } catch { }
    }

    if (!rawContent) {
      const fallbackRes = await this.localClient.chat.completions.create({
        model: this.localModel,
        messages: messages as any,
        stream: false,
        temperature: 0,
        stop: ["Friend:", "user:"],
        max_tokens: 500,
      });
      rawContent = fallbackRes.choices[0]?.message?.content?.trim() || "";
    }

    return this.cleanOutput(rawContent);
  }

  private cleanOutput(text: string): string {
    return text
      .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
      .replace(/<pause>[\s\S]*?<\/pause>/gi, "")
      .replace(/<[\s\S]*?>/g, "")
      .replace(/(THOUGHT|THINK|SYSTEM|ACTION|EXECUTE|PROTOCOL):.*?\n/gi, "")
      .replace(/thought:.*?\n/gi, "")
      .replace(/tool_call:.*?\n/gi, "")
      .replace(/\{"name":.*?\}/g, "")
      .replace(/\(silenciosamente\)/gi, "")
      .replace(/\(inspirado[\s\S]*?\)/gi, "")
      .replace(/[_*~]/g, "")
      .replace(/\n\n+/g, "\n")
      .trim();
  }

}

export const llmService = new LLMService();
