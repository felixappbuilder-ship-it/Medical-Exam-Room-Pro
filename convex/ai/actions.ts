// convex/ai/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

// Helper to call OpenAI with retry logic
async function callOpenAI(
  messages: Array<{ role: string; content: string }>,
  model: string = process.env.AI_MODEL || "gpt-4"
): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY not set");

  const isTestMode = process.env.IS_TEST_MODE === "true";
  if (isTestMode) {
    // Mock response (R19)
    return "This is a mock AI response for testing purposes.";
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Rate limiting helper
async function checkRateLimit(ctx: any, userId: string, endpoint: string): Promise<boolean> {
  const now = Date.now();
  const resetAt = now + 60 * 1000;
  const record = await ctx.runQuery(internal.auth.internal.getRateLimit, {
    key: `${userId}_${endpoint}`,
    endpoint,
  });
  if (record && record.count >= 10 && record.resetAt > now) {
    return false;
  }
  await ctx.runMutation(internal.auth.internal.incrementRateLimit, {
    key: `${userId}_${endpoint}`,
    endpoint,
    resetAt,
  });
  return true;
}

// Verify token and subscription
async function verifyAuthAndSubscription(ctx: any, token: string): Promise<{ userId: string; isSubscribed: boolean }> {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) {
    throw new ConvexError("Invalid or expired token");
  }
  const userId = result.data.userId;
  const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
  if (!user || user.isLocked) {
    throw new ConvexError("Account locked or not found");
  }
  const subscription = await ctx.runQuery(internal.subscriptions.internal.getActiveSubscriptionByUserId, { userId });
  const isSubscribed = subscription !== null && subscription.expiryDate > Date.now();
  if (!isSubscribed) {
    throw new ConvexError("Active subscription required for AI features");
  }
  return { userId, isSubscribed };
}

export const askAI = action({
  args: {
    token: v.string(),
    question: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, isSubscribed } = await verifyAuthAndSubscription(ctx, args.token);
    if (!isSubscribed) {
      return {
        success: false,
        error: "subscription_required",
        message: "Active subscription required to use AI tutor.",
      };
    }

    // Rate limiting (R15)
    const allowed = await checkRateLimit(ctx, userId, "askAI");
    if (!allowed) {
      return {
        success: false,
        error: "rate_limit_exceeded",
        message: "Too many AI requests. Please wait a minute.",
      };
    }

    // Fetch user's weak areas from examResults to personalize (optional)
    const weakAreasResult = await ctx.db
      .query("examResults")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    let weakAreasPrompt = "";
    if (weakAreasResult && weakAreasResult.weakAreas.length > 0) {
      weakAreasPrompt = `The user has weak areas in: ${weakAreasResult.weakAreas.slice(0, 3).join(", ")}. Focus explanations on these topics.`;
    }

    const messages = [
      {
        role: "system",
        content: `You are a medical exam tutor for Kenyan medical students. Provide accurate, concise, and educational answers. ${weakAreasPrompt}`,
      },
      {
        role: "user",
        content: args.context ? `Context from notes: ${args.context}\n\nQuestion: ${args.question}` : args.question,
      },
    ];

    try {
      const answer = await callOpenAI(messages);
      // Audit log (R16)
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "ai_ask",
        targetId: userId,
        details: { questionLength: args.question.length },
      });
      return {
        success: true,
        data: { answer },
      };
    } catch (err: any) {
      console.error("AI ask error:", err);
      throw new ConvexError(`AI service error: ${err.message}`);
    }
  },
});

export const summarizeText = action({
  args: {
    token: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, isSubscribed } = await verifyAuthAndSubscription(ctx, args.token);
    if (!isSubscribed) {
      return {
        success: false,
        error: "subscription_required",
        message: "Active subscription required to use AI summarization.",
      };
    }
    const allowed = await checkRateLimit(ctx, userId, "summarizeText");
    if (!allowed) {
      return {
        success: false,
        error: "rate_limit_exceeded",
        message: "Too many requests. Please wait a minute.",
      };
    }
    const messages = [
      {
        role: "system",
        content: "Summarize the following medical text in 3-5 bullet points. Keep it educational and precise.",
      },
      { role: "user", content: args.text },
    ];
    try {
      const summary = await callOpenAI(messages);
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "ai_summarize",
        targetId: userId,
        details: { textLength: args.text.length },
      });
      return { success: true, data: { summary } };
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
    const { userId, isSubscribed } = await verifyAuthAndSubscription(ctx, args.token);
    if (!isSubscribed) {
      return {
        success: false,
        error: "subscription_required",
        message: "Active subscription required to generate flashcards.",
      };
    }
    const allowed = await checkRateLimit(ctx, userId, "generateFlashcards");
    if (!allowed) {
      return {
        success: false,
        error: "rate_limit_exceeded",
        message: "Too many requests. Please wait a minute.",
      };
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
      const response = await callOpenAI(messages);
      let flashcards;
      try {
        flashcards = JSON.parse(response);
      } catch {
        // Fallback: try to extract JSON from markdown
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
    const { userId, isSubscribed } = await verifyAuthAndSubscription(ctx, args.token);
    if (!isSubscribed) {
      return {
        success: false,
        error: "subscription_required",
        message: "Active subscription required to generate mnemonics.",
      };
    }
    const allowed = await checkRateLimit(ctx, userId, "getMnemonics");
    if (!allowed) {
      return {
        success: false,
        error: "rate_limit_exceeded",
        message: "Too many requests. Please wait a minute.",
      };
    }
    const messages = [
      {
        role: "system",
        content: "Create a memorable mnemonic or memory aid for the given medical term. Explain the mnemonic briefly.",
      },
      { role: "user", content: args.medicalTerm },
    ];
    try {
      const mnemonic = await callOpenAI(messages);
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "ai_mnemonic",
        targetId: userId,
        details: { term: args.medicalTerm },
      });
      return { success: true, data: { mnemonic } };
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
    const { userId, isSubscribed } = await verifyAuthAndSubscription(ctx, args.token);
    if (!isSubscribed) {
      return {
        success: false,
        error: "subscription_required",
        message: "Active subscription required for semantic search.",
      };
    }
    const allowed = await checkRateLimit(ctx, userId, "semanticSearch");
    if (!allowed) {
      return {
        success: false,
        error: "rate_limit_exceeded",
        message: "Too many requests. Please wait a minute.",
      };
    }
    const limit = args.limit || 5;
    const isTestMode = process.env.IS_TEST_MODE === "true";
    if (isTestMode) {
      // Mock vector search results
      return {
        success: true,
        data: {
          results: [
            { _id: "mock1", text: "Mock question 1", explanation: "Mock explanation", score: 0.95 },
            { _id: "mock2", text: "Mock question 2", explanation: "Mock explanation", score: 0.89 },
          ],
        },
      };
    }

    // In production, we need to generate an embedding for the query using OpenAI
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) throw new ConvexError("AI_API_KEY not set");
    const embedResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-ada-002",
        input: args.query,
      }),
    });
    if (!embedResponse.ok) {
      throw new ConvexError("Failed to generate embedding for search query");
    }
    const embedData = await embedResponse.json();
    const embedding = embedData.data[0].embedding;

    // Perform vector search on questions table (R18)
    const results = await ctx.db
      .query("questions")
      .withVectorIndex("by_embedding", {
        vector: embedding,
        limit: limit,
      })
      .collect();

    // Return relevant fields only
    const sanitized = results.map((q) => ({
      _id: q._id,
      text: q.text,
      explanation: q.explanation,
      category: q.category,
      difficulty: q.difficulty,
    }));

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "ai_semantic_search",
      targetId: userId,
      details: { queryLength: args.query.length, resultCount: sanitized.length },
    });

    return { success: true, data: { results: sanitized } };
  },
});

export const generateQuestions = action({
  args: {
    token: v.string(),
    topic: v.string(),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, isSubscribed } = await verifyAuthAndSubscription(ctx, args.token);
    if (!isSubscribed) {
      return {
        success: false,
        error: "subscription_required",
        message: "Active subscription required to generate questions.",
      };
    }
    const allowed = await checkRateLimit(ctx, userId, "generateQuestions");
    if (!allowed) {
      return {
        success: false,
        error: "rate_limit_exceeded",
        message: "Too many requests. Please wait a minute.",
      };
    }
    const count = args.count || 5;
    const messages = [
      {
        role: "system",
        content: `Generate ${count} multiple-choice medical questions on the topic "${args.topic}". Each question must have 4 options (A, B, C, D), indicate the correct letter, and provide a short explanation. Return as JSON array with objects: { questionText, options: {A, B, C, D}, correctAnswer, explanation }.`,
      },
    ];
    try {
      const response = await callOpenAI(messages);
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

export const getStudyPlan = action({
  args: {
    token: v.string(),
    targetExam: v.string(),
    weeksAvailable: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, isSubscribed } = await verifyAuthAndSubscription(ctx, args.token);
    if (!isSubscribed) {
      return {
        success: false,
        error: "subscription_required",
        message: "Active subscription required to generate study plan.",
      };
    }
    const allowed = await checkRateLimit(ctx, userId, "getStudyPlan");
    if (!allowed) {
      return {
        success: false,
        error: "rate_limit_exceeded",
        message: "Too many requests. Please wait a minute.",
      };
    }
    // Fetch user's weak areas from exam results
    const weakAreasResult = await ctx.db
      .query("examResults")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    let weakAreas = weakAreasResult?.weakAreas || [];
    const messages = [
      {
        role: "system",
        content: `You are a medical exam study planner. Create a ${args.weeksAvailable}-week study plan for ${args.targetExam}. User's weak areas: ${weakAreas.join(", ")}. Return as a JSON array of weeks, each with topics and daily tasks.`,
      },
    ];
    try {
      const plan = await callOpenAI(messages);
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "ai_study_plan",
        targetId: userId,
        details: { targetExam: args.targetExam, weeks: args.weeksAvailable },
      });
      return { success: true, data: { plan } };
    } catch (err: any) {
      throw new ConvexError(`Study plan generation failed: ${err.message}`);
    }
  },
});