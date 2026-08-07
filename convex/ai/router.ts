// convex/ai/router.ts

import { AI_REGISTRY, AiFunction } from "./registry";
import { ConvexError } from "convex/values";

// ---------- Friendly name → Environment variable mapping ----------
//
// These environment variable names are used to enable specific models.
// Set them in your Convex dashboard with the exact API model ID (see below).
//
// Recommended model IDs (as of July 2026):
//
// OpenAI (GPT-5 series):
//   - gpt-5.3-instant   (fast, everyday use)
//   - gpt-5.4-thinking  (advanced reasoning)
//   - gpt-5.4-pro       (most capable)
//   Set AI_MODEL_GPT_5 = gpt-5.3-instant (or your preferred ID)
//
// Google Gemini:
//   - gemini-2.5-flash       (best price-performance)
//   - gemini-2.5-flash-lite  (fastest, cheapest)
//   - gemini-2.5-pro         (most advanced)
//   - gemini-3.5-flash       (preview, frontier-class)
//   Set AI_MODEL_GEMINI_FLASH = gemini-2.5-flash (example)
//
// DeepSeek:
//   - deepseek-v4-flash      (speed and economy)
//   - deepseek-v4-pro        (complex tasks)
//   Set AI_MODEL_DEEPSEEK_V3 = deepseek-v4-flash (example)
//
// Anthropic Claude:
//   - claude-fable-5          (most capable)
//   - claude-sonnet-5         (best speed/intelligence)
//   - claude-haiku-4-5-20251001 (fastest)
//   Set AI_MODEL_CLAUDE_OPUS_4 = claude-fable-5 (example)
//
// xAI Grok:
//   - grok-4.5                (flagship)
//   - grok-4.3                (primary coding/chat)
//   - grok-code-fast-1        (fast agentic coding)
//   Set AI_MODEL_GROK_4 = grok-4.5 (example)
//
// IMPORTANT: Only models that have BOTH:
//   1) The provider API key set (e.g., GEMINI_API_KEY)
//   2) Its AI_MODEL_* environment variable set to a valid model ID
// will be used. All others are ignored. This gives you full control over
// which models are active, keeping costs predictable.

const FRIENDLY_TO_ENV: Record<string, string> = {
  "GPT-5": "AI_MODEL_GPT_5",
  "GPT-5 Mini": "AI_MODEL_GPT_5_MINI",
  "GPT-5 Nano": "AI_MODEL_GPT_5_NANO",
  "GPT o3": "AI_MODEL_GPT_O3",
  "GPT-5 Pro": "AI_MODEL_GPT_5_PRO",
  "Gemini Pro": "AI_MODEL_GEMINI_PRO",
  "Gemini Flash": "AI_MODEL_GEMINI_FLASH",
  "Gemini Flash Lite": "AI_MODEL_GEMINI_FLASH_LITE",
  "Gemini Flash Thinking": "AI_MODEL_GEMINI_FLASH_THINKING",
  "Gemini Pro Deep Think": "AI_MODEL_GEMINI_PRO_DEEP_THINK",
  "DeepSeek V3": "AI_MODEL_DEEPSEEK_V3",
  "DeepSeek Chat": "AI_MODEL_DEEPSEEK_CHAT",
  "DeepSeek R1": "AI_MODEL_DEEPSEEK_R1",
  "DeepSeek R1 Distill": "AI_MODEL_DEEPSEEK_R1_DISTILL",
  "DeepSeek Coder V2": "AI_MODEL_DEEPSEEK_CODER_V2",
  "Claude Opus 4": "AI_MODEL_CLAUDE_OPUS_4",
  "Claude Sonnet 4": "AI_MODEL_CLAUDE_SONNET_4",
  "Claude Haiku 4": "AI_MODEL_CLAUDE_HAIKU_4",
  "Claude Opus Thinking": "AI_MODEL_CLAUDE_OPUS_THINKING",
  "Claude Sonnet Thinking": "AI_MODEL_CLAUDE_SONNET_THINKING",
  "Grok 4": "AI_MODEL_GROK_4",
  "Grok Mini": "AI_MODEL_GROK_MINI",
  "Grok Fast": "AI_MODEL_GROK_FAST",
  "Grok 4 Heavy": "AI_MODEL_GROK_4_HEAVY",
  "Grok Code": "AI_MODEL_GROK_CODE",
};

// ---------- Provider → required API key environment variable ----------
const PROVIDER_API_KEY_ENV: Record<string, string> = {
  "GPT": "OPENAI_API_KEY",
  "Gemini": "GEMINI_API_KEY",
  "DeepSeek": "DEEPSEEK_API_KEY",
  "Claude": "CLAUDE_API_KEY",
  "Grok": "XAI_API_KEY",
};

// ---------- Sanitize model ID ----------
function sanitizeModelId(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^\/+/, "");
  if (cleaned.startsWith("models/")) {
    cleaned = cleaned.replace(/^models\//, "");
  }
  return cleaned;
}

// ---------- Determine provider from friendly name ----------
function getProvider(friendly: string): string | null {
  if (friendly.startsWith("GPT")) return "GPT";
  if (friendly.startsWith("Gemini")) return "Gemini";
  if (friendly.startsWith("DeepSeek")) return "DeepSeek";
  if (friendly.startsWith("Claude")) return "Claude";
  if (friendly.startsWith("Grok")) return "Grok";
  return null;
}

/**
 * Returns the set of friendly model names that the user has explicitly enabled
 * by setting both the provider's API key AND the corresponding AI_MODEL_* env var.
 */
function getAvailableModels(): Set<string> {
  const available = new Set<string>();

  for (const [friendly, envVar] of Object.entries(FRIENDLY_TO_ENV)) {
    // 1. Check if the user set the specific model env var
    const modelValue = process.env[envVar];
    if (!modelValue || modelValue.trim() === "") {
      continue; // model not configured – skip
    }

    // 2. Check if the provider's API key is also set
    const provider = getProvider(friendly);
    if (!provider) continue;
    const apiKeyEnv = PROVIDER_API_KEY_ENV[provider];
    if (!apiKeyEnv) continue;
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey || apiKey.trim() === "") {
      console.warn(`Provider ${provider} API key missing, model "${friendly}" skipped.`);
      continue;
    }

    // Both conditions met – model is available
    available.add(friendly);
  }

  return available;
}

// Pre‑compute execution chains for all AI functions
const executionChains: Map<AiFunction, string[]> = new Map();

export function buildExecutionChains(): void {
  const available = getAvailableModels();
  if (available.size === 0) {
    console.warn("[AI Router] No AI models are configured. Check your environment variables.");
  }

  for (const [fn, priorityList] of Object.entries(AI_REGISTRY) as [
    AiFunction,
    string[],
  ][]) {
    const chain = priorityList.filter((model) => available.has(model));
    executionChains.set(fn, chain);
    console.debug(`[AI Router] Chain for ${fn}:`, chain);
  }
}

function getChain(fn: AiFunction): string[] {
  const chain = executionChains.get(fn);
  if (!chain) {
    throw new Error(`No execution chain for function: ${fn}`);
  }
  if (chain.length === 0) {
    throw new Error(
      `No available models for function: ${fn}. Check your AI_MODEL_* environment variables and API keys.`
    );
  }
  return chain;
}

// ---------- Main caller ----------
export async function callAI(
  fn: AiFunction,
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    image?: string;
    audio?: string;
    document?: string;
  }
): Promise<string> {
  const chain = getChain(fn);
  let lastError: Error | null = null;

  for (const model of chain) {
    try {
      const response = await callModel(model, messages, options);
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[AI Router] Model "${model}" failed for ${fn}:`,
        lastError.message
      );
    }
  }

  throw new ConvexError(
    `All AI models failed for ${fn}. Last error: ${lastError?.message || "Unknown error"}`
  );
}

// ---------- Resolve actual model ID ----------
function resolveModelId(friendly: string): string {
  const envVar = FRIENDLY_TO_ENV[friendly];
  if (!envVar) {
    throw new Error(`No environment variable mapping for model "${friendly}"`);
  }
  const modelId = process.env[envVar];
  if (!modelId || modelId.trim() === "") {
    throw new Error(`Environment variable ${envVar} is not set for model "${friendly}"`);
  }
  return sanitizeModelId(modelId);
}

// ---------- Model dispatcher ----------
async function callModel(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    image?: string;
    audio?: string;
    document?: string;
  }
): Promise<string> {
  if (model.startsWith("GPT")) {
    return callOpenAI(model, messages, options);
  } else if (model.startsWith("Gemini")) {
    return callGemini(model, messages, options);
  } else if (model.startsWith("DeepSeek")) {
    return callDeepSeek(model, messages, options);
  } else if (model.startsWith("Claude")) {
    return callClaude(model, messages, options);
  } else if (model.startsWith("Grok")) {
    return callXAI(model, messages, options);
  } else {
    throw new Error(`Unsupported model: ${model}`);
  }
}

// ---------- Provider Implementations ----------

async function callOpenAI(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: { temperature?: number; maxTokens?: number; image?: string }
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const resolvedModel = resolveModelId(model);
  const isReasoningModel = /^o[134]/i.test(resolvedModel);

  const formattedMessages: any[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  if (options?.image) {
    formattedMessages.push({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: options.image } },
      ],
    });
  }

  const body: Record<string, any> = {
    model: resolvedModel,
    messages: formattedMessages,
  };

  // [FIX] Default to 4096 tokens to prevent cut-offs
  if (isReasoningModel) {
    body.max_completion_tokens = options?.maxTokens ?? 4096;
  } else {
    body.temperature = options?.temperature ?? 0.7;
    body.max_tokens = options?.maxTokens ?? 4096;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error (${model} -> ${resolvedModel}): ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callGemini(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: { temperature?: number; maxTokens?: number; image?: string }
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const resolvedModel = resolveModelId(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`;

  const systemMessage = messages.find((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const contents = chatMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  if (options?.image) {
    contents.push({
      role: "user",
      parts: [{ inline_data: { mime_type: "image/jpeg", data: options.image } }],
    });
  }

  const body: Record<string, any> = {
    contents,
    generationConfig: {
      temperature: options?.temperature ?? 0.7,
      // [FIX] Default to 4096 tokens
      maxOutputTokens: options?.maxTokens ?? 4096,
    },
  };

  if (systemMessage) {
    body.system_instruction = {
      parts: [{ text: systemMessage.content }],
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${model} -> ${resolvedModel}): ${response.status} - ${error}`);
  }

  const data = await response.json();
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error(`Gemini returned an empty candidate response (${model} -> ${resolvedModel})`);
  }
  return data.candidates[0].content.parts[0].text;
}

async function callDeepSeek(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  const resolvedModel = resolveModelId(model);

  // [FIX] Default to 4096 tokens
  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error (${model} -> ${resolvedModel}): ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callClaude(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("CLAUDE_API_KEY not set");

  const resolvedModel = resolveModelId(model);

  const systemMessage = messages.find((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const anthropicMessages = chatMessages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const body: Record<string, any> = {
    model: resolvedModel,
    messages: anthropicMessages,
    // [FIX] Default to 4096 tokens
    max_tokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature ?? 0.7,
  };

  if (systemMessage) {
    body.system = systemMessage.content;
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error (${model} -> ${resolvedModel}): ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callXAI(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY not set");

  const resolvedModel = resolveModelId(model);

  // [FIX] Default to 4096 tokens
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`xAI API error (${model} -> ${resolvedModel}): ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}