// convex/conversations/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

// ==================== ENVIRONMENT & CONSTANTS ====================

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.AI_MODEL_DEEPSEEK_CHAT || "deepseek-chat";
const MAX_CHUNK_TOKENS = 140000; // 60% of ~1MB document limit
const MAX_SUMMARIES = 4;        // Keep only last 4 summaries per conversation

// ==================== HELPERS ====================

async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) {
    throw new Error(result.message);
  }
  const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId: result.data.userId });
  if (!user) throw new Error("User not found");
  return user;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4); // rough approximation
}

/**
 * Call DeepSeek API for chat completions.
 * Used for: summarization, chat responses, and other internal AI tasks.
 */
async function callDeepSeek(messages: Array<{ role: string; content: string }>): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    throw new ConvexError("DEEPSEEK_API_KEY not configured");
  }
  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.7,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ConvexError(`DeepSeek API error: ${response.status} - ${text}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

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

async function getRecentContext(ctx: any, conversationId: any, targetTokens: number): Promise<Array<{ role: string; content: string }>> {
  const chunks = await ctx.runQuery(internal.conversations.internal.getAllChunks, { conversationId });
  if (chunks.length === 0) return [];

  let tokens = 0;
  let messages: Array<{ role: string; content: string }> = [];
  // Iterate from newest to oldest
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const chunkMessages = chunk.messages.map((m: any) => ({ role: m.role, content: m.content }));
    // Prepend older messages to maintain chronological order (older first)
    messages = [...chunkMessages, ...messages];
    tokens += chunk.tokenCount;
    if (tokens >= targetTokens) break;
  }
  return messages;
}

async function getChunkCount(ctx: any, conversationId: any): Promise<number> {
  const chunks = await ctx.runQuery(internal.conversations.internal.getAllChunks, { conversationId });
  return chunks.length;
}

/**
 * Analyze a file via the appropriate AI action based on its MIME type.
 * Returns a string summary/analysis to be injected into the conversation context.
 */
async function analyzeFile(ctx: any, token: string, fileUrl: string, fileType: string): Promise<string | null> {
  if (!fileUrl || !fileType) return null;

  // Determine which AI action to call
  if (fileType.startsWith("image/")) {
    const result = await ctx.runAction(internal.ai.actions.analyzeImage, {
      token,
      imageUrl: fileUrl,
      prompt: "Describe this medical image in detail.",
    });
    return result.success ? result.data.analysis : null;
  } else if (fileType === "application/pdf" || fileType.startsWith("text/") || fileType === "application/msword") {
    const result = await ctx.runAction(internal.ai.actions.analyzeDocument, {
      token,
      documentUrl: fileUrl,
      prompt: "Provide a summary and key findings from this document.",
    });
    return result.success ? result.data.analysis : null;
  } else if (fileType.startsWith("audio/")) {
    const result = await ctx.runAction(internal.ai.actions.transcribeAudio, {
      token,
      audioUrl: fileUrl,
    });
    return result.success ? result.data.transcript : null;
  }
  return null; // unsupported file type
}

// ==================== EXISTING ACTIONS ====================

export const getConversations = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("conversations")),
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const limit = args.limit || 20;
      const { items, nextCursor, hasMore } = await ctx.runQuery(
        internal.conversations.internal.getUserConversations,
        { userId: user._id, limit, cursor: args.cursor }
      );
      const filtered = args.since
        ? items.filter(c => (c.updatedAt || c.createdAt) > args.since!)
        : items;
      return {
        success: true,
        data: { conversations: filtered, nextCursor, hasMore },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "conversations_fetch_failed",
        message: errorMessage,
      };
    }
  },
});

export const getConversation = action({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const conversation = await ctx.runQuery(internal.conversations.internal.getConversationById, {
        conversationId: args.conversationId,
      });
      if (!conversation || conversation.userId !== user._id) {
        return {
          success: false,
          error: "unauthorized",
          message: "Conversation not found or you don't own it",
        };
      }
      const limit = args.limit || 50;
      const { items: messages, nextCursor, hasMore } = await ctx.runQuery(
        internal.conversations.internal.getMessages,
        { conversationId: args.conversationId, limit, cursor: args.cursor }
      );
      return {
        success: true,
        data: {
          conversation: { title: conversation.title, createdAt: conversation.createdAt },
          messages,
          nextCursor,
          hasMore,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "conversation_fetch_failed",
        message: errorMessage,
      };
    }
  },
});

export const saveConversation = action({
  args: {
    token: v.string(),
    conversationId: v.optional(v.id("conversations")),
    title: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const userId = user._id;
      const now = Date.now();
      let conversationId = args.conversationId;

      if (!conversationId) {
        conversationId = await ctx.runMutation(internal.conversations.internal.createConversation, {
          userId,
          title: args.title,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const existing = await ctx.runQuery(internal.conversations.internal.getConversationById, {
          conversationId,
        });
        if (!existing || existing.userId !== userId) {
          return {
            success: false,
            error: "unauthorized",
            message: "Conversation not found or access denied",
          };
        }
        await ctx.runMutation(internal.conversations.internal.updateConversation, {
          conversationId,
          title: args.title,
          updatedAt: now,
        });
      }

      for (const msg of args.messages) {
        await ctx.runMutation(internal.conversations.internal.addMessage, {
          conversationId: conversationId!,
          role: msg.role,
          content: msg.content,
          timestamp: now,
        });
      }

      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "save_conversation",
        targetId: conversationId,
        details: { messageCount: args.messages.length },
      });

      return { success: true, data: { conversationId } };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "save_conversation_failed",
        message: errorMessage,
      };
    }
  },
});

export const deleteConversation = action({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const conversation = await ctx.runQuery(internal.conversations.internal.getConversationById, {
        conversationId: args.conversationId,
      });
      if (!conversation || conversation.userId !== user._id) {
        return {
          success: false,
          error: "unauthorized",
          message: "Conversation not found",
        };
      }
      await ctx.runMutation(internal.conversations.internal.deleteConversation, {
        conversationId: args.conversationId,
      });
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: user._id,
        action: "delete_conversation",
        targetId: args.conversationId,
        details: {},
      });
      return { success: true, data: { message: "Conversation deleted" } };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "delete_conversation_failed",
        message: errorMessage,
      };
    }
  },
});

export const shareConversation = action({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    expiryHours: v.optional(v.number()),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const conversation = await ctx.runQuery(internal.conversations.internal.getConversationById, {
        conversationId: args.conversationId,
      });
      if (!conversation || conversation.userId !== user._id) {
        return {
          success: false,
          error: "unauthorized",
          message: "Cannot share this conversation",
        };
      }
      const expiryHours = args.expiryHours || 168;
      const expiry = Date.now() + expiryHours * 60 * 60 * 1000;
      const shareToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      let passwordHash: string | undefined = undefined;
      if (args.password) {
        passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, { password: args.password });
      }
      // ✅ Pass userId to satisfy the sharedLinks schema
      await ctx.runMutation(internal.conversations.internal.createSharedLink, {
        targetType: "conversation",
        targetId: args.conversationId,
        token: shareToken,
        expiry,
        passwordHash,
        userId: user._id, // ✅ required field
      });
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: user._id,
        action: "share_conversation",
        targetId: args.conversationId,
        details: { shareToken, expiryHours, hasPassword: !!args.password },
      });
      // Return absolute URL (use SITE_URL or fallback to relative)
      const baseUrl = process.env.SITE_URL || "";
      const shareUrl = baseUrl
        ? `${baseUrl}/ai.html?ref=shared&token=${shareToken}`
        : `/ai.html?ref=shared&token=${shareToken}`;
      return {
        success: true,
        data: { shareToken, shareUrl, expiry },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "share_conversation_failed",
        message: errorMessage,
      };
    }
  },
});

// ==================== NEW: SEND MESSAGE (AI chat with memory, file, modes) ====================

export const sendMessage = action({
  args: {
    token: v.string(),
    conversationId: v.optional(v.id("conversations")),
    message: v.string(),
    fileUrl: v.optional(v.string()),
    fileType: v.optional(v.string()),
    modes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const userId = user._id;

      // Rate limit check
      const rateOk = await checkRateLimit(ctx, userId, "sendMessage");
      if (!rateOk) {
        return {
          success: false,
          error: "rate_limit_exceeded",
          message: "Too many messages. Please wait a moment.",
        };
      }

      let conversationId = args.conversationId;
      const now = Date.now();

      // Create conversation if new
      if (!conversationId) {
        const title = args.message.slice(0, 50) + (args.message.length > 50 ? "..." : "");
        conversationId = await ctx.runMutation(internal.conversations.internal.createConversation, {
          userId,
          title,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        // Verify ownership
        const conv = await ctx.runQuery(internal.conversations.internal.getConversationById, { conversationId });
        if (!conv || conv.userId !== userId) {
          return {
            success: false,
            error: "unauthorized",
            message: "Conversation not found or access denied",
          };
        }
      }

      // Get latest chunk
      let latestChunk = await ctx.runQuery(internal.conversations.internal.getLatestChunk, { conversationId });
      let currentChunkId = latestChunk?._id;
      let currentChunkNumber = latestChunk?.chunkNumber || 0;
      let messages = latestChunk?.messages || [];
      let tokenCount = latestChunk?.tokenCount || 0;

      const userMessageObj = { role: "user" as const, content: args.message, timestamp: now };
      const userTokenCount = estimateTokens(args.message);

      // Append or create chunk
      if (tokenCount + userTokenCount > MAX_CHUNK_TOKENS) {
        const newChunkNumber = currentChunkNumber + 1;
        const newChunkId = await ctx.runMutation(internal.conversations.internal.createChunk, {
          conversationId,
          chunkNumber: newChunkNumber,
          messages: [userMessageObj],
          tokenCount: userTokenCount,
          createdAt: now,
          updatedAt: now,
          embedding: [],
        });
        currentChunkId = newChunkId;
        currentChunkNumber = newChunkNumber;
        messages = [userMessageObj];
        tokenCount = userTokenCount;
      } else {
        if (currentChunkId) {
          await ctx.runMutation(internal.conversations.internal.appendToChunk, {
            chunkId: currentChunkId,
            messages: [userMessageObj],
            tokenCount: userTokenCount,
            updatedAt: now,
          });
        } else {
          // First chunk ever
          const newChunkId = await ctx.runMutation(internal.conversations.internal.createChunk, {
            conversationId,
            chunkNumber: 1,
            messages: [userMessageObj],
            tokenCount: userTokenCount,
            createdAt: now,
            updatedAt: now,
            embedding: [],
          });
          currentChunkId = newChunkId;
          currentChunkNumber = 1;
          messages = [userMessageObj];
          tokenCount = userTokenCount;
        }
      }

      // --- Process file attachment (if any) ---
      let fileAnalysis: string | null = null;
      if (args.fileUrl && args.fileType) {
        fileAnalysis = await analyzeFile(ctx, args.token, args.fileUrl, args.fileType);
      }

      // --- Process modes ---
      let modeContextMessages: Array<{ role: string; content: string }> = [];
      if (args.modes && args.modes.length > 0) {
        for (const mode of args.modes) {
          switch (mode) {
            case "websearch":
              // Perform web search and inject results
              const searchResult = await ctx.runAction(internal.ai.actions.searchWeb, {
                token: args.token,
                query: args.message,
              });
              if (searchResult.success) {
                modeContextMessages.push({
                  role: "system",
                  content: `Web search results:\n${searchResult.data.result}`,
                });
              }
              break;
            case "deepthink":
              // For deepthink, we'll later adjust the system prompt or call a different AI
              // Add a system message to request deep reasoning
              modeContextMessages.push({
                role: "system",
                content: "Provide a detailed, step-by-step analysis with deep reasoning.",
              });
              break;
            case "references":
              // Fetch references and inject
              const refResult = await ctx.runAction(internal.ai.actions.getReferences, {
                token: args.token,
                topic: args.message,
              });
              if (refResult.success) {
                modeContextMessages.push({
                  role: "system",
                  content: `Relevant references:\n${refResult.data.references}`,
                });
              }
              break;
            // Add more modes as needed
          }
        }
      }

      // Build context messages
      const contextMessages = await getRecentContext(ctx, conversationId, 400);

      // Add file analysis if present
      if (fileAnalysis) {
        contextMessages.push({
          role: "system",
          content: `Analysis of the attached file:\n${fileAnalysis}`,
        });
      }

      // Add mode-specific context messages (placed before user message)
      const allMessages = [...modeContextMessages, ...contextMessages];

      // Call AI (DeepSeek) with all context
      const aiResponse = await callAIWithContext(allMessages, args.message);

      // Store AI response
      const aiMessageObj = { role: "assistant" as const, content: aiResponse, timestamp: Date.now() };
      const aiTokenCount = estimateTokens(aiResponse);
      if (currentChunkId) {
        await ctx.runMutation(internal.conversations.internal.appendToChunk, {
          chunkId: currentChunkId,
          messages: [aiMessageObj],
          tokenCount: aiTokenCount,
          updatedAt: Date.now(),
        });
      }

      // Update conversation updatedAt
      await ctx.runMutation(internal.conversations.internal.updateConversation, {
        conversationId,
        updatedAt: Date.now(),
      });

      // Trigger summarization if enough chunks
      const chunkCount = await getChunkCount(ctx, conversationId);
      if (chunkCount >= 6) {
        await ctx.scheduler.runAfter(0, internal.conversations.actions.summarizeChunks, { conversationId });
      }

      // Audit log
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: userId,
        action: "send_message",
        targetId: conversationId,
        details: {
          messageLength: args.message.length,
          hasFile: !!args.fileUrl,
          modes: args.modes || [],
        },
      });

      return {
        success: true,
        data: {
          conversationId,
          message: aiResponse,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "send_message_failed",
        message: errorMessage,
      };
    }
  },
});

// ==================== INTERNAL HELPER FOR AI CHAT ====================

async function callAIWithContext(contextMessages: Array<{ role: string; content: string }>, userMessage: string): Promise<string> {
  const systemPrompt =
    "You are a helpful medical exam tutor assistant. Use the provided conversation history and any additional context to answer the user's question accurately and concisely.";
  const messages = [
    { role: "system", content: systemPrompt },
    ...contextMessages,
    { role: "user", content: userMessage },
  ];
  return await callDeepSeek(messages);
}

// ==================== SUMMARIZE CHUNKS (background job using DeepSeek) ====================

export const summarizeChunks = action({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    try {
      const allChunks = await ctx.runQuery(internal.conversations.internal.getAllChunks, { conversationId: args.conversationId });
      const unsummarized = allChunks
        .filter(c => c.summaryStatus === "none")
        .sort((a, b) => a.chunkNumber - b.chunkNumber);

      if (unsummarized.length < 6) return;

      // Take the oldest two unsummarized chunks
      const chunksToSummarize = unsummarized.slice(0, 2);
      const chunkIds = chunksToSummarize.map(c => c._id);
      const chunkNumbers = chunksToSummarize.map(c => c.chunkNumber);

      const textToSummarize = chunksToSummarize
        .flatMap(c => c.messages.map((m: any) => `${m.role}: ${m.content}`))
        .join("\n");

      // Use DeepSeek for summarization
      const summary = await callDeepSeek([
        { role: "system", content: "Summarize the following conversation in a concise paragraph (max 100 words)." },
        { role: "user", content: textToSummarize },
      ]);

      const now = Date.now();
      await ctx.runMutation(internal.conversations.internal.createSummary, {
        conversationId: args.conversationId,
        summaryText: summary,
        chunkNumbers,
        createdAt: now,
        updatedAt: now,
      });

      for (const chunkId of chunkIds) {
        await ctx.runMutation(internal.conversations.internal.setChunkSummaryStatus, {
          chunkId,
          status: "summarized",
        });
      }

      // Keep only latest MAX_SUMMARIES summaries
      const summaries = await ctx.runQuery(internal.conversations.internal.getLatestSummaries, {
        conversationId: args.conversationId,
        limit: MAX_SUMMARIES + 1,
      });
      if (summaries.length > MAX_SUMMARIES) {
        const oldest = summaries.pop();
        if (oldest) {
          await ctx.runMutation(internal.conversations.internal.deleteOldSummary, { summaryId: oldest._id });
        }
      }
    } catch (err) {
      console.error("Summarization failed:", err);
      // Non-critical, so we don't throw
    }
  },
});

// ==================== REQUEST MORE HISTORY (AI-initiated) ====================

export const requestMoreHistory = action({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    additionalTokens: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const chunks = await ctx.runQuery(internal.conversations.internal.getAllChunks, { conversationId: args.conversationId });
      chunks.sort((a, b) => b.chunkNumber - a.chunkNumber);
      // Skip the most recent chunk (already in context)
      const olderChunks = chunks.slice(1);
      let tokens = 0;
      let messages: Array<{ role: string; content: string }> = [];
      for (const chunk of olderChunks) {
        if (tokens >= args.additionalTokens) break;
        const chunkMessages = chunk.messages.map((m: any) => ({ role: m.role, content: m.content }));
        messages = [...chunkMessages, ...messages];
        tokens += chunk.tokenCount;
      }
      return {
        success: true,
        data: { messages, tokenCount: tokens },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "request_more_history_failed",
        message: errorMessage,
      };
    }
  },
});

// ==================== VECTOR SEARCH (placeholder) ====================

export const vectorSearchConversations = action({
  args: {
    token: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      // This will be implemented with proper embedding support later.
      return {
        success: true,
        data: [],
        message: "Vector search requires embedding support, coming soon.",
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "vector_search_failed",
        message: errorMessage,
      };
    }
  },
});