// convex/notes/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const createNoteInternal = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    content: v.string(),
    plainText: v.string(),
    isProtected: v.boolean(),
    passwordHash: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const noteId = await ctx.db.insert("notes", {
      userId: args.userId,
      title: args.title,
      content: args.content,
      plainText: args.plainText,
      isProtected: args.isProtected,
      passwordHash: args.passwordHash,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
    return noteId;
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
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.noteId, args.updates);
  },
});

export const deleteNoteInternal = internalMutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.noteId);
  },
});

export const getNoteById = internalQuery({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.noteId);
  },
});

export const getUserNotes = internalQuery({
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
    return { items, nextCursor, hasMore };
  },
});

export const createSharedLinkForNote = internalMutation({
  args: {
    targetType: v.union(v.literal("examResult"), v.literal("note"), v.literal("conversation")),
    targetId: v.string(),
    token: v.string(),
    expiry: v.number(),
    passwordHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sharedLinks", {
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

export const deleteSharedLink = internalMutation({
  args: { linkId: v.id("sharedLinks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.linkId);
  },
});