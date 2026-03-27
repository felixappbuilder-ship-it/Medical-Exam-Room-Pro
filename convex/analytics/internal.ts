import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export const getWeakAreas = internalQuery({
  args: { threshold: v.number() },
  handler: async (ctx, args) => {
    // This is a simplified version; in production you'd reuse logic from analytics/queries.ts
    // We'll implement a minimal version.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const userId = identity.subject as Id<"users">;
    const examResults = await ctx.db
      .query("examResults")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .collect();
    const topicStats: Record<string, { correct: number; total: number }> = {};
    for (const exam of examResults) {
      for (const tp of exam.topicPerformance || []) {
        if (!topicStats[tp.topic]) {
          topicStats[tp.topic] = { correct: 0, total: 0 };
        }
        topicStats[tp.topic].correct += tp.correct;
        topicStats[tp.topic].total += tp.total;
      }
    }
    const weak: Array<{ topic: string; score: number }> = [];
    for (const [topic, stats] of Object.entries(topicStats)) {
      if (stats.total > 0) {
        const score = (stats.correct / stats.total) * 100;
        if (score < args.threshold) {
          weak.push({ topic, score });
        }
      }
    }
    return weak;
  },
});