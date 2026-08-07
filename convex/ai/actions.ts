// convex/ai/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { callAI, buildExecutionChains } from "./router";

// Build execution chains once when the module loads
buildExecutionChains();

// ==================== HELPERS ====================

async function verifyAuthAndSubscription(
  ctx: any,
  token: string
): Promise<{
  success: boolean;
  userId?: string;
  error?: string;
  message?: string;
}> {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, {
    token,
  });
  if (!result.success) {
    return {
      success: false,
      error: "invalid_token",
      message: "Invalid or expired token",
    };
  }
  const userId = result.data.userId;
  const user = await ctx.runQuery(internal.users.internal.getUserById, {
    userId,
  });
  if (!user || user.isLocked) {
    return {
      success: false,
      error: "account_locked",
      message: "Account locked or not found",
    };
  }
  const subscription = await ctx.runQuery(
    internal.subscriptions.internal.getActiveSubscriptionByUserId,
    { userId }
  );
  const isSubscribed =
    subscription !== null && subscription.expiryDate > Date.now();
  if (!isSubscribed) {
    return {
      success: false,
      error: "subscription_required",
      message: "Active subscription required for AI features",
    };
  }
  return { success: true, userId };
}

async function checkRateLimit(
  ctx: any,
  userId: string,
  endpoint: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const now = Date.now();
  const resetAt = now + 60 * 1000;
  const record = await ctx.runQuery(internal.auth.internal.getRateLimit, {
    key: `${userId}_${endpoint}`,
    endpoint,
  });
  if (record && record.count >= 10 && record.resetAt > now) {
    return {
      success: false,
      error: "rate_limit_exceeded",
      message: "Too many AI requests. Please wait a minute.",
    };
  }
  await ctx.runMutation(internal.auth.internal.incrementRateLimit, {
    key: `${userId}_${endpoint}`,
    endpoint,
    resetAt,
  });
  return { success: true };
}

/**
 * Call AI and parse structured response (JSON) with rich metadata.
 * Returns { text, richData, meta }
 * Falls back to plain text if parsing fails.
 */
async function callAIWithRichData(
  ctx: any,
  fn: string,
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    image?: string;
    audio?: string;
    document?: string;
  }
): Promise<{
  text: string;
  richData: any;
  meta: string | null;
}> {
  const raw = await callAI(fn as any, messages, options);

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      text: raw,
      richData: null,
      meta: null,
    };
  }

  const text = parsed.text || parsed.answer || raw;
  const richData = parsed.richData || null;
  const meta = parsed.meta || null;

  return { text, richData, meta };
}

// ==================== CONCISE SYSTEM PROMPT (MedHub AI) ====================
const MEDHUB_SYSTEM_PROMPT = `
You are MedHub AI, a medical educator for students. Prioritize correctness, understanding, and educational value. Adapt depth, tone, and structure to each query: simple greetings → brief; complex topics → detailed with relevant assets (tables, mnemonics, references) only when useful. Never be repetitive or robotic. Return JSON with:
- "text": main answer (Markdown)
- "richData": structured extras (formulas, mnemonics, references, sources, thinkingTime, modelUsed, images, etc.)
- "meta": short summary (e.g., "🧠 12.5s · MedHub AI")
Include modelUsed always; omit cost estimation. Omit references unless requested or clinically important.
`;

// ==================== AI ACTIONS ====================

export const askAI = action({
  args: {
    token: v.string(),
    question: v.string(),
    context: v.optional(v.union(v.string(), v.null())),
    conversationId: v.optional(v.id("conversations")), // NEW: enable memory
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) {
      return { success: false, error: auth.error, message: auth.message };
    }
    const userId = auth.userId!;

    const rate = await checkRateLimit(ctx, userId, "askAI");
    if (!rate.success) {
      return { success: false, error: rate.error, message: rate.message };
    }

    // If conversationId provided, delegate to conversation memory engine
    if (args.conversationId) {
      try {
        const result = await ctx.runAction(
          internal.conversations.actions.sendMessage,
          {
            token: args.token,
            conversationId: args.conversationId,
            message: args.question,
          }
        );
        if (!result.success) {
          throw new Error(result.message);
        }
        // Return in same format as legacy askAI for compatibility
        return {
          success: true,
          data: {
            answer: result.data.message,
            richData: null,
            meta: null,
          },
        };
      } catch (err: any) {
        throw new ConvexError(`AI chat with memory failed: ${err.message}`);
      }
    }

    // --- Legacy mode (no memory) ---
    const weakAreas = await ctx.runQuery(internal.ai.internal.getWeakAreas, {
      userId,
    });
    let weakAreasPrompt = "";
    if (weakAreas.length > 0) {
      weakAreasPrompt = `The user has weak areas in: ${weakAreas
        .slice(0, 3)
        .join(", ")}. Focus explanations on these topics.`;
    }

    const userContent = args.context
      ? `Context from notes: ${args.context}\n\nQuestion: ${args.question}`
      : args.question;

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT}\n${weakAreasPrompt}`,
      },
      {
        role: "user",
        content: userContent,
      },
    ];

    try {
      const { text, richData, meta } = await callAIWithRichData(
        ctx,
        "sendMessageToAI",
        messages
      );
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "ai_ask",
        targetId: userId,
        details: { questionLength: args.question.length },
      });
      return { success: true, data: { answer: text, richData, meta } };
    } catch (err: any) {
      console.error("AI ask error:", err);
      throw new ConvexError(`AI service error: ${err.message}`);
    }
  },
});

// ==================== OTHER ACTIONS (unchanged, but use concise prompt if needed) ====================
export const summarizeText = action({
  args: {
    token: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) {
      return { success: false, error: auth.error, message: auth.message };
    }
    const userId = auth.userId!;

    const rate = await checkRateLimit(ctx, userId, "summarizeText");
    if (!rate.success) {
      return { success: false, error: rate.error, message: rate.message };
    }

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Summarize the following medical text in 3-5 bullet points. Keep it educational and precise. Respond in JSON format with "text", "richData", and "meta".`,
      },
      { role: "user", content: args.text },
    ];
    try {
      const { text, richData, meta } = await callAIWithRichData(
        ctx,
        "summarizeText",
        messages
      );
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "ai_summarize",
        targetId: userId,
        details: { textLength: args.text.length },
      });
      return { success: true, data: { summary: text, richData, meta } };
    } catch (err: any) {
      throw new ConvexError(`Summarization failed: ${err.message}`);
    }
  },
});

export const generateFlashcards = action({
  args: {
    token: v.string(),
    text: v.string(),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) {
      return { success: false, error: auth.error, message: auth.message };
    }
    const userId = auth.userId!;

    const rate = await checkRateLimit(ctx, userId, "generateFlashcards");
    if (!rate.success) {
      return { success: false, error: rate.error, message: rate.message };
    }

    const count = args.count || 5;
    const messages = [
      {
        role: "system",
        content: `Extract ${count} key medical concepts from the following text. Return a JSON array of objects with "front" (question/concept) and "back" (answer/explanation). Only output valid JSON.`,
      },
      { role: "user", content: args.text },
    ];
    try {
      const response = await callAI("generateFlashcards", messages);
      let flashcards;
      try {
        flashcards = JSON.parse(response);
      } catch {
        const match = response.match(/\[[\s\S]*\]/);
        if (match) flashcards = JSON.parse(match[0]);
        else throw new Error("Invalid JSON response");
      }
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "ai_generate_flashcards",
        targetId: userId,
        details: { count: flashcards.length },
      });
      return { success: true, data: { flashcards } };
    } catch (err: any) {
      throw new ConvexError(`Flashcard generation failed: ${err.message}`);
    }
  },
});

export const getMnemonics = action({
  args: {
    token: v.string(),
    medicalTerm: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) {
      return { success: false, error: auth.error, message: auth.message };
    }
    const userId = auth.userId!;

    const rate = await checkRateLimit(ctx, userId, "getMnemonics");
    if (!rate.success) {
      return { success: false, error: rate.error, message: rate.message };
    }

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Create a memorable mnemonic or memory aid for the given medical term. Explain the mnemonic briefly. Respond in JSON format with "text" (explanation), "richData" (mnemonics), and "meta".`,
      },
      { role: "user", content: args.medicalTerm },
    ];
    try {
      const { text, richData, meta } = await callAIWithRichData(
        ctx,
        "generateMnemonics",
        messages
      );
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "ai_mnemonic",
        targetId: userId,
        details: { term: args.medicalTerm },
      });
      return { success: true, data: { mnemonic: text, richData, meta } };
    } catch (err: any) {
      throw new ConvexError(`Mnemonic generation failed: ${err.message}`);
    }
  },
});

export const semanticSearch = action({
  args: {
    token: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) {
      return { success: false, error: auth.error, message: auth.message };
    }
    const userId = auth.userId!;

    const rate = await checkRateLimit(ctx, userId, "semanticSearch");
    if (!rate.success) {
      return { success: false, error: rate.error, message: rate.message };
    }

    const limit = args.limit || 5;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "missing_api_key",
        message: "OPENAI_API_KEY not set for embeddings",
      };
    }

    let embedding: number[];
    try {
      const embedResponse = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: args.query,
        }),
      });

      if (!embedResponse.ok) {
        const errorText = await embedResponse.text();
        return {
          success: false,
          error: "embedding_failed",
          message: `Embedding API error: ${embedResponse.status}`,
        };
      }
      const embedData = await embedResponse.json();
      embedding = embedData.data[0].embedding;
    } catch (err: any) {
      throw new ConvexError(`Embedding generation failed: ${err.message}`);
    }

    const results = await ctx.runQuery(internal.ai.internal.semanticSearchQuestions, {
      embedding,
      limit,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "ai_semantic_search",
      targetId: userId,
      details: { queryLength: args.query.length, resultCount: results.length },
    });

    return { success: true, data: { results } };
  },
});

export const generateQuestions = action({
  args: {
    token: v.string(),
    topic: v.string(),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) {
      return { success: false, error: auth.error, message: auth.message };
    }
    const userId = auth.userId!;

    const rate = await checkRateLimit(ctx, userId, "generateQuestions");
    if (!rate.success) {
      return { success: false, error: rate.error, message: rate.message };
    }

    const count = args.count || 5;
    const messages = [
      {
        role: "system",
        content: `Generate ${count} multiple-choice medical questions on the topic "${args.topic}". Each question must have 4 options (A, B, C, D), indicate the correct letter, and provide a short explanation. Return as JSON array with objects: { questionText, options: {A, B, C, D}, correctAnswer, explanation }.`,
      },
    ];
    try {
      const response = await callAI("generateQuestions", messages);
      let questions;
      try {
        questions = JSON.parse(response);
      } catch {
        const match = response.match(/\[[\s\S]*\]/);
        if (match) questions = JSON.parse(match[0]);
        else throw new Error("Invalid JSON");
      }
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "ai_generate_questions",
        targetId: userId,
        details: { topic: args.topic, count: questions.length },
      });
      return { success: true, data: { questions } };
    } catch (err: any) {
      throw new ConvexError(`Question generation failed: ${err.message}`);
    }
  },
});

export const generateStudyPlan = action({
  args: {
    token: v.string(),
    targetExam: v.string(),
    weeksAvailable: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) {
      return { success: false, error: auth.error, message: auth.message };
    }
    const userId = auth.userId!;

    const rate = await checkRateLimit(ctx, userId, "generateStudyPlan");
    if (!rate.success) {
      return { success: false, error: rate.error, message: rate.message };
    }

    const weakAreas = await ctx.runQuery(internal.ai.internal.getWeakAreas, {
      userId,
    });

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Create a ${args.weeksAvailable}-week study plan for ${args.targetExam}. User's weak areas: ${weakAreas.join(", ")}. Return as a JSON array of weeks, each with topics and daily tasks. Include relevant rich metadata (e.g., key resources, mnemonics).`,
      },
    ];
    try {
      const { text, richData, meta } = await callAIWithRichData(
        ctx,
        "generateStudyPlan",
        messages
      );
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "ai_study_plan",
        targetId: userId,
        details: {
          targetExam: args.targetExam,
          weeks: args.weeksAvailable,
        },
      });
      return { success: true, data: { plan: text, richData, meta } };
    } catch (err: any) {
      throw new ConvexError(`Study plan generation failed: ${err.message}`);
    }
  },
});

// ==================== NEW ACTIONS (from registry) ====================

export const suggestTags = action({
  args: { token: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) return { success: false, error: auth.error, message: auth.message };
    const userId = auth.userId!;
    const rate = await checkRateLimit(ctx, userId, "suggestTags");
    if (!rate.success) return { success: false, error: rate.error, message: rate.message };

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Suggest 5–10 relevant medical tags for the given text. Return as comma-separated list.`,
      },
      { role: "user", content: args.text },
    ];
    const answer = await callAI("suggestTags", messages);
    return { success: true, data: { tags: answer } };
  },
});

export const explainTopic = action({
  args: { token: v.string(), topic: v.string() },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) return { success: false, error: auth.error, message: auth.message };
    const userId = auth.userId!;
    const rate = await checkRateLimit(ctx, userId, "explainTopic");
    if (!rate.success) return { success: false, error: rate.error, message: rate.message };

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Explain the following medical topic in clear, student-friendly terms. Include key concepts, examples, and relevant rich metadata (formulas, mnemonics, references) where applicable. Adapt depth to the topic: simple topics get a concise explanation, complex topics get more detail. Respond in JSON format with "text", "richData", and "meta".`,
      },
      { role: "user", content: args.topic },
    ];
    try {
      const { text, richData, meta } = await callAIWithRichData(
        ctx,
        "explainTopic",
        messages
      );
      return { success: true, data: { explanation: text, richData, meta } };
    } catch (err: any) {
      throw new ConvexError(`Topic explanation failed: ${err.message}`);
    }
  },
});

export const deepthink = action({
  args: { token: v.string(), question: v.string() },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) return { success: false, error: auth.error, message: auth.message };
    const userId = auth.userId!;
    const rate = await checkRateLimit(ctx, userId, "deepthink");
    if (!rate.success) return { success: false, error: rate.error, message: rate.message };

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Provide a detailed, step-by-step analysis of the medical scenario. Think deeply and explain your reasoning. Include rich metadata such as references, formulas, and your thinking process. Respond in JSON format with "text" (the detailed reasoning), "richData" (including "thinkingTime" in seconds, "modelUsed", "references", "formulas"), and "meta".`,
      },
      { role: "user", content: args.question },
    ];
    const start = Date.now();
    try {
      const { text, richData, meta } = await callAIWithRichData(
        ctx,
        "deepthink",
        messages,
        { maxTokens: 8192 }
      );
      const elapsed = (Date.now() - start) / 1000;
      const fullRich = {
        ...richData,
        thinkingTime: elapsed,
        modelUsed: "gemini-2.0-flash-thinking-exp",
      };
      const fullMeta = meta || `🧠 ${elapsed.toFixed(1)}s · MedHub AI`;
      return { success: true, data: { answer: text, richData: fullRich, meta: fullMeta } };
    } catch (err: any) {
      throw new ConvexError(`DeepThink failed: ${err.message}`);
    }
  },
});

export const searchWeb = action({
  args: { token: v.string(), query: v.string() },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) return { success: false, error: auth.error, message: auth.message };
    const userId = auth.userId!;
    const rate = await checkRateLimit(ctx, userId, "searchWeb");
    if (!rate.success) return { success: false, error: rate.error, message: rate.message };

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Search for the latest medical information on the query. Summarize findings concisely and include sources (URLs) and the number of pages read. Respond in JSON format with "text" (the summary), "richData" containing "sources" (array of URLs) and "webPagesRead" (number), and "meta".`,
      },
      { role: "user", content: args.query },
    ];
    try {
      const { text, richData, meta } = await callAIWithRichData(
        ctx,
        "searchWeb",
        messages
      );
      const fullRich = {
        sources: richData?.sources || [],
        webPagesRead: richData?.webPagesRead || 0,
        ...richData,
      };
      const fullMeta = meta || `🌐 ${fullRich.webPagesRead} pages read · MedHub AI`;
      return { success: true, data: { results: text, richData: fullRich, meta: fullMeta } };
    } catch (err: any) {
      throw new ConvexError(`Web search failed: ${err.message}`);
    }
  },
});

export const getReferences = action({
  args: { token: v.string(), topic: v.string() },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) return { success: false, error: auth.error, message: auth.message };
    const userId = auth.userId!;
    const rate = await checkRateLimit(ctx, userId, "getReferences");
    if (!rate.success) return { success: false, error: rate.error, message: rate.message };

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Provide 3–5 authoritative medical references (journal articles, guidelines) for the given topic. Format as a numbered list with DOI or PubMed ID if possible. Respond in JSON format with "text" (summary), "richData" containing "references" (array of strings), and "meta".`,
      },
      { role: "user", content: args.topic },
    ];
    try {
      const { text, richData, meta } = await callAIWithRichData(
        ctx,
        "getReferences",
        messages
      );
      const fullRich = {
        references: richData?.references || [],
        ...richData,
      };
      const fullMeta = meta || `📚 ${fullRich.references.length} references · MedHub AI`;
      return { success: true, data: { references: text, richData: fullRich, meta: fullMeta } };
    } catch (err: any) {
      throw new ConvexError(`References retrieval failed: ${err.message}`);
    }
  },
});

export const analyzeImage = action({
  args: {
    token: v.string(),
    imageUrl: v.string(),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) return { success: false, error: auth.error, message: auth.message };
    const userId = auth.userId!;
    const rate = await checkRateLimit(ctx, userId, "analyzeImage");
    if (!rate.success) return { success: false, error: rate.error, message: rate.message };

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Analyze the provided medical image. Describe findings, abnormalities, and possible diagnoses. Be precise. Include rich metadata if applicable (e.g., references, measurements). Respond in JSON format with "text", "richData", "meta".`,
      },
    ];
    if (args.prompt) messages.push({ role: "user", content: args.prompt });

    try {
      const { text, richData, meta } = await callAIWithRichData(
        ctx,
        "analyzeImage",
        messages,
        {
          image: args.imageUrl,
          maxTokens: 500,
        }
      );
      return { success: true, data: { analysis: text, richData, meta } };
    } catch (err: any) {
      throw new ConvexError(`Image analysis failed: ${err.message}`);
    }
  },
});

export const analyzeDocument = action({
  args: {
    token: v.string(),
    documentUrl: v.string(),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) return { success: false, error: auth.error, message: auth.message };
    const userId = auth.userId!;
    const rate = await checkRateLimit(ctx, userId, "analyzeDocument");
    if (!rate.success) return { success: false, error: rate.error, message: rate.message };

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Analyze the attached medical document. Provide a summary, key findings, and any critical alerts. Include rich metadata if applicable (e.g., references, statistics). Respond in JSON format with "text", "richData", "meta".`,
      },
    ];
    if (args.prompt) messages.push({ role: "user", content: args.prompt });

    try {
      const { text, richData, meta } = await callAIWithRichData(
        ctx,
        "analyzeDocument",
        messages,
        {
          document: args.documentUrl,
          maxTokens: 800,
        }
      );
      return { success: true, data: { analysis: text, richData, meta } };
    } catch (err: any) {
      throw new ConvexError(`Document analysis failed: ${err.message}`);
    }
  },
});

export const transcribeAudio = action({
  args: { token: v.string(), audioUrl: v.string() },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) return { success: false, error: auth.error, message: auth.message };
    const userId = auth.userId!;
    const rate = await checkRateLimit(ctx, userId, "transcribeAudio");
    if (!rate.success) return { success: false, error: rate.error, message: rate.message };

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Transcribe the following audio recording verbatim.`,
      },
    ];
    try {
      const transcript = await callAI("transcribeAudio", messages, {
        audio: args.audioUrl,
        maxTokens: 1000,
      });
      return { success: true, data: { transcript } };
    } catch (err: any) {
      throw new ConvexError(`Audio transcription failed: ${err.message}`);
    }
  },
});

export const generateExamQuestions = action({
  args: {
    token: v.string(),
    subject: v.string(),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) return { success: false, error: auth.error, message: auth.message };
    const userId = auth.userId!;
    const rate = await checkRateLimit(ctx, userId, "generateExamQuestions");
    if (!rate.success) return { success: false, error: rate.error, message: rate.message };

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} Create a set of ${args.count ?? 10} board-style exam questions on ${args.subject}. Each question should have 5 answer choices and a detailed explanation. Output as JSON array.`,
      },
      { role: "user", content: `Subject: ${args.subject}` },
    ];
    const answer = await callAI("generateExamQuestions", messages);
    return { success: true, data: { questions: answer } };
  },
});

export const autoGradeEssay = action({
  args: {
    token: v.string(),
    essay: v.string(),
    rubric: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await verifyAuthAndSubscription(ctx, args.token);
    if (!auth.success) return { success: false, error: auth.error, message: auth.message };
    const userId = auth.userId!;
    const rate = await checkRateLimit(ctx, userId, "autoGradeEssay");
    if (!rate.success) return { success: false, error: rate.error, message: rate.message };

    const rubricText = args.rubric
      ? `Use the following rubric:\n${args.rubric}`
      : "Evaluate the essay based on medical accuracy, coherence, and depth.";

    const messages = [
      {
        role: "system",
        content: `${MEDHUB_SYSTEM_PROMPT} ${rubricText} Provide a score (1–100) and detailed feedback.`,
      },
      { role: "user", content: args.essay },
    ];
    const answer = await callAI("autoGradeEssay", messages);
    return { success: true, data: { grade: answer } };
  },
});