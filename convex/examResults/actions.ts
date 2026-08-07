"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error(result.message);
  const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId: result.data.userId });
  if (!user) throw new Error("User not found");
  return user;
}

export const getExamHistory = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("examResults")),
    since: v.optional(v.number()), // new: fetch only items updated after this timestamp
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const limit = args.limit || 50;
      const { items, nextCursor, hasMore } = await ctx.runQuery(
        internal.examResults.internal.getExamResultsByUser,
        { userId: user._id, limit, cursor: args.cursor }
      );
      // Filter by `since` if provided
      const filtered = args.since
        ? items.filter(r => (r.updatedAt || r.createdAt) > args.since)
        : items;
      const results = filtered.map((result) => ({
        _id: result._id,
        examId: result.examId,
        userId: result.userId,
        subject: result.subject || '',
        mode: result.mode || '',
        date: result.date || new Date(result.createdAt).toISOString(),
        totalQuestions: result.totalQuestions || 0,
        correctAnswers: result.correctAnswers || 0,
        scorePercentage: result.scorePercentage || 0,
        timeSpent: result.timeSpent || 0,
        averageTimePerQuestion: result.averageTimePerQuestion || 0,
        questions: result.questions || [],
        topicPerformance: result.topicPerformance || [],
        weakAreas: result.weakAreas || [],
        completedAt: result.createdAt,
        updatedAt: result.updatedAt || result.createdAt,
      }));
      return { success: true, data: { results, nextCursor, hasMore } };
    } catch (err) {
      console.error("[getExamHistory] Error:", err);
      return { success: false, error: err.message || "Failed to fetch exam history", message: err.message };
    }
  },
});

export const getExamResult = action({
  args: { token: v.string(), examResultId: v.id("examResults") },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const examResult = await ctx.runQuery(internal.examResults.internal.getExamResultById, {
        examResultId: args.examResultId,
      });
      if (!examResult || examResult.userId !== user._id) {
        return { success: false, error: "unauthorized", message: "You do not have access to this exam result." };
      }
      const answers = await ctx.db
        .query("examAnswers")
        .withIndex("by_examResultId", (q) => q.eq("examResultId", args.examResultId))
        .collect();
      const resultData = {
        _id: examResult._id,
        examId: examResult.examId,
        userId: examResult.userId,
        subject: examResult.subject || '',
        mode: examResult.mode || '',
        date: examResult.date || new Date(examResult.createdAt).toISOString(),
        totalQuestions: examResult.totalQuestions || 0,
        correctAnswers: examResult.correctAnswers || 0,
        scorePercentage: examResult.scorePercentage || 0,
        timeSpent: examResult.timeSpent || 0,
        averageTimePerQuestion: examResult.averageTimePerQuestion || 0,
        questions: examResult.questions || [],
        topicPerformance: examResult.topicPerformance || [],
        weakAreas: examResult.weakAreas || [],
        completedAt: examResult.createdAt,
        updatedAt: examResult.updatedAt || examResult.createdAt,
        answers: answers.map((a) => ({
          questionId: a.questionId,
          selectedAnswer: a.selectedAnswer,
          isCorrect: a.isCorrect,
          timeSpent: a.timeSpent,
        })),
      };
      return { success: true, data: resultData };
    } catch (err) {
      console.error("[getExamResult] Error:", err);
      return { success: false, error: err.message || "Failed to fetch exam result", message: err.message };
    }
  },
});