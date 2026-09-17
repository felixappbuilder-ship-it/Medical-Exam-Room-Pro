// convex/conversations/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// LEGACY MESSAGE HELPERS (keep for backward compatibility)
// ============================================================

export const createConversation = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversations", {
      userId: args.userId,
      title: args.title,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
  },
});

export const updateConversation = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    title: v.optional(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const updates: any = { updatedAt: args.updatedAt };
    if (args.title !== undefined) updates.title = args.title;
    await ctx.db.patch(args.conversationId, updates);
  },
});

export const deleteConversation = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    // Delete associated messages (legacy)
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversationId_timestamp", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }
    // Delete associated chunks
    const chunks = await ctx.db
      .query("conversation_chunks")
      .withIndex("by_conversationId_chunkNumber", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }
    // Delete associated summaries
    const summaries = await ctx.db
      .query("summaries")
      .withIndex("by_conversationId_createdAt", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    for (const summary of summaries) {
      await ctx.db.delete(summary._id);
    }
    // Delete the conversation metadata
    await ctx.db.delete(args.conversationId);
  },
});

export const getConversationById = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

export const getUserConversations = internalQuery({
  args: { userId: v.id("users"), limit: v.number(), cursor: v.optional(v.id("conversations")) },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("conversations")
      .withIndex("by_userId_updatedAt", (q) => q.eq("userId", args.userId));
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const conversations = await query.take(args.limit + 1);
    const hasMore = conversations.length > args.limit;
    const items = conversations.slice(0, args.limit);
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { items, nextCursor, hasMore };
  },
});

export const addMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      timestamp: args.timestamp,
    });
    // Update conversation's updatedAt
    await ctx.db.patch(args.conversationId, { updatedAt: args.timestamp });
  },
});

export const getMessages = internalQuery({
  args: { conversationId: v.id("conversations"), limit: v.number(), cursor: v.optional(v.id("messages")) },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("messages")
      .withIndex("by_conversationId_timestamp", (q) => q.eq("conversationId", args.conversationId));
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const messages = await query.take(args.limit + 1);
    const hasMore = messages.length > args.limit;
    const items = messages.slice(0, args.limit);
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { items, nextCursor, hasMore };
  },
});

// ============================================================
// SHARED LINKS
// ============================================================

export const createSharedLink = internalMutation({
  args: {
    targetType: v.union(v.literal("examResult"), v.literal("note"), v.literal("conversation")),
    targetId: v.string(),
    token: v.string(),
    expiry: v.number(),
    passwordHash: v.optional(v.string()),
    userId: v.id("users"), // ✅ added required field
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sharedLinks", {
      targetType: args.targetType,
      targetId: args.targetId,
      token: args.token,
      expiry: args.expiry,
      passwordHash: args.passwordHash,
      userId: args.userId, // ✅ include it
    });
  },
});

export const getSharedLinkByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sharedLinks")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
  },
});

export const deleteSharedLink = internalMutation({
  args: { linkId: v.id("sharedLinks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.linkId);
  },
});

// ============================================================
// NEW: CHUNK MANAGEMENT (AI memory)
// ============================================================

export const getLatestChunk = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("conversation_chunks")
      .withIndex("by_conversationId_chunkNumber", (q) => q.eq("conversationId", args.conversationId))
      .collect();
    if (chunks.length === 0) return null;
    return chunks.reduce((a, b) => a.chunkNumber > b.chunkNumber ? a : b);
  },
});

export const getChunkByNumber = internalQuery({
  args: { conversationId: v.id("conversations"), chunkNumber: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversation_chunks")
      .withIndex("by_conversationId_chunkNumber", (q) => q.eq("conversationId", args.conversationId).eq("chunkNumber", args.chunkNumber))
      .first();
  },
});

export const getAllChunks = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversation_chunks")
      .withIndex("by_conversationId_chunkNumber", (q) => q.eq("conversationId", args.conversationId))
      .collect();
  },
});

export const createChunk = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    chunkNumber: v.number(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        timestamp: v.number(),
      })
    ),
    tokenCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    embedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversation_chunks", {
      conversationId: args.conversationId,
      chunkNumber: args.chunkNumber,
      messages: args.messages,
      tokenCount: args.tokenCount,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
      summaryStatus: "none",
      embedding: args.embedding || [],
    });
  },
});

export const appendToChunk = internalMutation({
  args: {
    chunkId: v.id("conversation_chunks"),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        timestamp: v.number(),
      })
    ),
    tokenCount: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const chunk = await ctx.db.get(args.chunkId);
    if (!chunk) return;
    const newMessages = [...chunk.messages, ...args.messages];
    await ctx.db.patch(args.chunkId, {
      messages: newMessages,
      tokenCount: chunk.tokenCount + args.tokenCount,
      updatedAt: args.updatedAt,
    });
  },
});

export const deleteChunk = internalMutation({
  args: { chunkId: v.id("conversation_chunks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.chunkId);
  },
});

export const setChunkSummaryStatus = internalMutation({
  args: { chunkId: v.id("conversation_chunks"), status: v.union(v.literal("none"), v.literal("summarized")) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.chunkId, { summaryStatus: args.status });
  },
});

// ============================================================
// NEW: SUMMARY MANAGEMENT
// ============================================================

export const createSummary = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    summaryText: v.string(),
    chunkNumbers: v.array(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("summaries", {
      conversationId: args.conversationId,
      summaryText: args.summaryText,
      chunkNumbers: args.chunkNumbers,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
  },
});

export const getLatestSummaries = internalQuery({
  args: { conversationId: v.id("conversations"), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("summaries")
      .withIndex("by_conversationId_createdAt", (q) => q.eq("conversationId", args.conversationId))
      .order("desc")
      .take(args.limit);
  },
});

export const deleteOldSummary = internalMutation({
  args: { summaryId: v.id("summaries") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.summaryId);
  },
});