// convex/notes/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ===== EXISTING (unchanged) =====
export const getNoteById = internalQuery({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.noteId);
  },
});

export const getUserNotesInternal = internalQuery({
  args: { userId: v.id("users"), limit: v.number(), cursor: v.optional(v.id("notes")) },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("notes")
      .withIndex("by_userId_updatedAt", (q) => q.eq("userId", args.userId));
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const notes = await query.take(args.limit + 1);
    const hasMore = notes.length > args.limit;
    const items = notes.slice(0, args.limit);
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { notes: items, nextCursor, hasMore };
  },
});

export const insertNote = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    content: v.string(),
    plainText: v.string(),
    isProtected: v.boolean(),
    passwordHash: v.optional(v.string()),
    subject: v.optional(v.union(v.string(), v.null())),
    topic: v.optional(v.union(v.string(), v.null())),
    questionId: v.optional(v.union(v.string(), v.null())),
    tags: v.optional(v.array(v.string())),
    attachments: v.optional(v.array(v.object({ type: v.string(), url: v.string(), name: v.string() }))),
    flashcards: v.optional(v.array(v.object({ front: v.string(), back: v.string() }))),
    shareWith: v.optional(v.array(v.id("users"))),
    sharedPublic: v.optional(v.boolean()),
    sharedToken: v.optional(v.union(v.string(), v.null())),
    lastReviewed: v.optional(v.number()),
    reviewCount: v.optional(v.number()),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const subject = args.subject === null ? undefined : args.subject;
    const topic = args.topic === null ? undefined : args.topic;
    const questionId = args.questionId === null ? undefined : args.questionId;
    const sharedToken = args.sharedToken === null ? undefined : args.sharedToken;

    const id = await ctx.db.insert("notes", {
      userId: args.userId,
      title: args.title,
      content: args.content,
      plainText: args.plainText,
      isProtected: args.isProtected,
      passwordHash: args.passwordHash,
      subject,
      topic,
      questionId,
      tags: args.tags || [],
      attachments: args.attachments || [],
      flashcards: args.flashcards || [],
      shareWith: args.shareWith || [],
      sharedPublic: args.sharedPublic || false,
      sharedToken,
      lastReviewed: args.lastReviewed,
      reviewCount: args.reviewCount || 0,
      clientId: args.clientId,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

export const updateNoteInternal = internalMutation({
  args: {
    noteId: v.id("notes"),
    updates: v.object({
      title: v.optional(v.string()),
      content: v.optional(v.string()),
      plainText: v.optional(v.string()),
      isProtected: v.optional(v.boolean()),
      passwordHash: v.optional(v.string()),
      subject: v.optional(v.union(v.string(), v.null())),
      topic: v.optional(v.union(v.string(), v.null())),
      questionId: v.optional(v.union(v.string(), v.null())),
      tags: v.optional(v.array(v.string())),
      attachments: v.optional(v.array(v.object({ type: v.string(), url: v.string(), name: v.string() }))),
      flashcards: v.optional(v.array(v.object({ front: v.string(), back: v.string() }))),
      shareWith: v.optional(v.array(v.id("users"))),
      sharedPublic: v.optional(v.boolean()),
      sharedToken: v.optional(v.union(v.string(), v.null())),
      lastReviewed: v.optional(v.number()),
      reviewCount: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const patch: any = { ...args.updates, updatedAt: Date.now() };
    if (patch.subject === null) patch.subject = undefined;
    if (patch.topic === null) patch.topic = undefined;
    if (patch.questionId === null) patch.questionId = undefined;
    if (patch.sharedToken === null) patch.sharedToken = undefined;
    await ctx.db.patch(args.noteId, patch);
  },
});

export const deleteNoteInternal = internalMutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.noteId);
    const links = await ctx.db
      .query("sharedLinks")
      .filter((q) =>
        q.and(
          q.eq(q.field("targetType"), "note"),
          q.eq(q.field("targetId"), args.noteId)
        )
      )
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
  },
});

export const createSharedLink = internalMutation({
  args: {
    userId: v.id("users"),
    targetType: v.union(v.literal("examResult"), v.literal("note"), v.literal("conversation")),
    targetId: v.string(),
    token: v.string(),
    expiry: v.number(),
    passwordHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sharedLinks", {
      userId: args.userId,
      targetType: args.targetType,
      targetId: args.targetId,
      token: args.token,
      expiry: args.expiry,
      passwordHash: args.passwordHash,
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

export const getSharedLinksByUserAndType = internalQuery({
  args: { userId: v.id("users"), targetType: v.string(), limit: v.number(), cursor: v.optional(v.id("sharedLinks")) },
  handler: async (ctx, args) => {
    const allLinks = await ctx.db
      .query("sharedLinks")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("targetType"), args.targetType)
        )
      )
      .collect();
    const sorted = allLinks.sort((a, b) => b.expiry - a.expiry);
    const start = args.cursor ? sorted.findIndex(l => l._id === args.cursor) + 1 : 0;
    const items = sorted.slice(start, start + args.limit);
    const hasMore = start + args.limit < sorted.length;
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { links: items, nextCursor, hasMore };
  },
});

export const deleteSharedLink = internalMutation({
  args: { linkId: v.id("sharedLinks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.linkId);
  },
});

// ===== SHARE NOTE HELPERS (unchanged) =====
export const getExistingSharedLink = internalQuery({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sharedLinks")
      .filter((q) =>
        q.and(
          q.eq(q.field("targetType"), "note"),
          q.eq(q.field("targetId"), args.noteId),
          q.gt(q.field("expiry"), Date.now())
        )
      )
      .first();
  },
});

export const markNoteShared = internalMutation({
  args: {
    noteId: v.id("notes"),
    sharedToken: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.noteId, {
      sharedToken: args.sharedToken,
      sharedPublic: true,
    });
  },
});

// ===== NEW: RESOLVE NOTE BY EITHER ID OR CLIENT ID =====
export const resolveNote = internalQuery({
  args: { noteId: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    // Try as a Convex document ID
    try {
      const note = await ctx.db.get(args.noteId as any);
      if (note) return note;
    } catch {}
    // Fallback: search by clientId and userId
    return await ctx.db
      .query("notes")
      .filter((q) =>
        q.and(
          q.eq(q.field("clientId"), args.noteId),
          q.eq(q.field("userId"), args.userId)
        )
      )
      .first();
  },
});