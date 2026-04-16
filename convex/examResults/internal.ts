// convex/examResults/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const upsertExamResult = internalMutation({
  args: {
    userId: v.id("users"),
    examId: v.string(),
    score: v.number(),
    topicPerformance: v.array(
      v.object({
        topic: v.string(),
        score: v.number(),
        timePerQuestion: v.number(),
      })
    ),
    weakAreas: v.array(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("examResults")
      .withIndex("by_userId_examId", (q) => q.eq("userId", args.userId).eq("examId", args.examId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        score: args.score,
        topicPerformance: args.topicPerformance,
        weakAreas: args.weakAreas,
        createdAt: args.createdAt,
      });
      return existing._id;
    } else {
      const id = await ctx.db.insert("examResults", {
        userId: args.userId,
        examId: args.examId,
        score: args.score,
        topicPerformance: args.topicPerformance,
        weakAreas: args.weakAreas,
        createdAt: args.createdAt,
      });
      return id;
    }
  },
});

export const getExamResultById = internalQuery({
  args: { examResultId: v.id("examResults") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.examResultId);
  },
});

export const getExamResultsByUser = internalQuery({
  args: { userId: v.id("users"), limit: v.number(), cursor: v.optional(v.id("examResults")) },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("examResults")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId));
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const results = await query.take(args.limit + 1);
    const hasMore = results.length > args.limit;
    const items = results.slice(0, args.limit);
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { items, nextCursor, hasMore };
  },
});

export const deleteExamResultById = internalMutation({
  args: { examResultId: v.id("examResults") },
  handler: async (ctx, args) => {
    // Also delete associated examAnswers
    const answers = await ctx.db
      .query("examAnswers")
      .withIndex("by_examResultId", (q) => q.eq("examResultId", args.examResultId))
      .collect();
    for (const ans of answers) {
      await ctx.db.delete(ans._id);
    }
    await ctx.db.delete(args.examResultId);
  },
});

export const createSharedLink = internalMutation({
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