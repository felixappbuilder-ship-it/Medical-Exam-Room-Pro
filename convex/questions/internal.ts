// convex/questions/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getQuestionById = internalQuery({
  args: { questionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("questions")
      .filter((q) => q.eq(q.field("_id"), args.questionId))
      .first();
  },
});

export const getQuestionsByIds = internalQuery({
  args: { questionIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const results = [];
    for (const id of args.questionIds) {
      const question = await ctx.db.get(id as any); // Cast because id is string but Convex expects Id
      if (question) results.push(question);
    }
    return results;
  },
});

export const getSeenQuestions = internalQuery({
  args: { userId: v.id("users"), subject: v.string(), topic: v.string() },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("seenQuestions")
      .withIndex("by_user_subject_topic", (q) =>
        q.eq("userId", args.userId).eq("subject", args.subject).eq("topic", args.topic)
      )
      .first();
    return seen?.questionIds || [];
  },
});

export const upsertSeenQuestions = internalMutation({
  args: {
    userId: v.id("users"),
    subject: v.string(),
    topic: v.string(),
    questionIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("seenQuestions")
      .withIndex("by_user_subject_topic", (q) =>
        q.eq("userId", args.userId).eq("subject", args.subject).eq("topic", args.topic)
      )
      .first();
    if (existing) {
      // Merge and deduplicate
      const merged = Array.from(new Set([...existing.questionIds, ...args.questionIds]));
      await ctx.db.patch(existing._id, { questionIds: merged });
    } else {
      await ctx.db.insert("seenQuestions", {
        userId: args.userId,
        subject: args.subject,
        topic: args.topic,
        questionIds: args.questionIds,
      });
    }
  },
});

export const resetSeenQuestions = internalMutation({
  args: {
    userId: v.id("users"),
    subject: v.string(),
    topic: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("seenQuestions")
      .withIndex("by_user_subject_topic", (q) =>
        q.eq("userId", args.userId).eq("subject", args.subject).eq("topic", args.topic)
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});