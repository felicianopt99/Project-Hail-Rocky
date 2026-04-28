import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function testProvider(name: string, client: OpenAI, model: string) {
  console.log(`\nTesting ${name} (${model})...`);
  const start = Date.now();
  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [{ role: "user", content: "Say 'Hello Friend' briefly." }],
      max_tokens: 20,
    });
    const duration = Date.now() - start;
    console.log(`[${name}] SUCCESS (${duration}ms): "${response.choices[0]?.message?.content?.trim()}"`);
    return true;
  } catch (err: any) {
    console.error(`[${name}] FAILED: ${err.message}`);
    return false;
  }
}

async function runTests() {
  // 1. NVIDIA
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  if (nvidiaKey && nvidiaKey !== "no-key") {
    const client = new OpenAI({
      apiKey: nvidiaKey,
      baseURL: process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
      timeout: 5000,
    });
    const model = process.env.CLOUD_LLM_MODEL || process.env.NVIDIA_LLM_MODEL || "meta/llama-3.1-70b-instruct";
    await testProvider("NVIDIA", client, model);
  } else {
    console.log("NVIDIA_API_KEY not configured.");
  }

  // 2. GEMINI
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && geminiKey !== "no-key") {
    const client = new OpenAI({
      apiKey: geminiKey,
      baseURL: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/",
      timeout: 10000,
    });
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
    await testProvider("GEMINI", client, model);
  } else {
    console.log("GEMINI_API_KEY not configured.");
  }

  // 3. LOCAL
  const localClient = new OpenAI({
    apiKey: "ollama",
    baseURL: process.env.LOCAL_LLM_URL || "http://127.0.0.1:11434/v1",
    timeout: 10000,
  });
  const localModel = process.env.LOCAL_LLM_MODEL || "rocky";
  await testProvider("LOCAL", localClient, localModel);
}

runTests().catch(console.error);
