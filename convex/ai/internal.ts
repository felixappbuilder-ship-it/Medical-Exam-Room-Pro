// convex/ai/internal.ts
import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getWeakAreas = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("examResults")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();
    return result?.weakAreas || [];
  },
});

export const semanticSearchQuestions = internalQuery({
  args: { embedding: v.array(v.float64()), limit: v.number() },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("questions")
      .withVectorIndex("by_embedding", {
        vector: args.embedding,
        limit: args.limit,
      })
      .collect();
    return results.map((q) => ({
      _id: q._id,
      text: q.text,
      explanation: q.explanation,
      category: q.category,
      difficulty: q.difficulty,
    }));
  },
});