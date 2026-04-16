// convex/examResults/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getExamHistory = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("examResults")),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
    } catch (err) {
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    const userId = payload.userId;
    const limit = args.limit || 20;
    const { items, nextCursor, hasMore } = await ctx.runQuery(
      internal.examResults.internal.getExamResultsByUser,
      {
        userId,
        limit,
        cursor: args.cursor,
      }
    );

    // For each exam result, optionally include answers summary (not full answers to save bandwidth)
    const enriched = items.map((result) => ({
      _id: result._id,
      examId: result.examId,
      score: result.score,
      weakAreas: result.weakAreas,
      completedAt: result.createdAt,
    }));

    return {
      success: true,
      data: {
        results: enriched,
        nextCursor,
        hasMore,
      },
    };
  },
});

export const getExamResult = query({
  args: {
    token: v.string(),
    examResultId: v.id("examResults"),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
    } catch (err) {
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    const userId = payload.userId;
    const examResult = await ctx.runQuery(internal.examResults.internal.getExamResultById, {
      examResultId: args.examResultId,
    });
    if (!examResult || examResult.userId !== userId) {
      return {
        success: false,
        error: "unauthorized",
        message: "You do not have access to this exam result.",
      };
    }

    // Fetch answers from normalized table
    const answers = await ctx.db
      .query("examAnswers")
      .withIndex("by_examResultId", (q) => q.eq("examResultId", args.examResultId))
      .collect();

    return {
      success: true,
      data: {
        examId: examResult.examId,
        score: examResult.score,
        topicPerformance: examResult.topicPerformance,
        weakAreas: examResult.weakAreas,
        completedAt: examResult.createdAt,
        answers: answers.map((a) => ({
          questionId: a.questionId,
          selectedAnswer: a.selectedAnswer,
          isCorrect: a.isCorrect,
          timeSpent: a.timeSpent,
        })),
      },
    };
  },
});

export const getSharedExam = query({
  args: {
    shareToken: v.string(),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.runQuery(internal.examResults.internal.getSharedLinkByToken, {
      token: args.shareToken,
    });
    if (!link) {
      return {
        success: false,
        error: "not_found",
        message: "Shared link not found or expired.",
      };
    }
    if (link.expiry < Date.now()) {
      // Expired – optionally delete
      await ctx.runMutation(internal.examResults.internal.deleteSharedLink, { linkId: link._id });
      return {
        success: false,
        error: "expired",
        message: "This shared link has expired.",
      };
    }
    if (link.passwordHash) {
      if (!args.password) {
        return {
          success: false,
          error: "password_required",
          message: "This shared exam is password protected.",
        };
      }
      const isValid = await ctx.runAction(internal.auth.helpers.comparePassword, {
        password: args.password,
        hash: link.passwordHash,
      });
      if (!isValid) {
        return {
          success: false,
          error: "invalid_password",
          message: "Incorrect password.",
        };
      }
    }

    const examResult = await ctx.runQuery(internal.examResults.internal.getExamResultById, {
      examResultId: link.targetId as any,
    });
    if (!examResult) {
      return {
        success: false,
        error: "not_found",
        message: "The exam result no longer exists.",
      };
    }

    // Do NOT include user identifying info
    const answers = await ctx.db
      .query("examAnswers")
      .withIndex("by_examResultId", (q) => q.eq("examResultId", link.targetId))
      .collect();

    return {
      success: true,
      data: {
        score: examResult.score,
        topicPerformance: examResult.topicPerformance,
        weakAreas: examResult.weakAreas,
        completedAt: examResult.createdAt,
        answers: answers.map((a) => ({
          questionId: a.questionId,
          selectedAnswer: a.selectedAnswer,
          isCorrect: a.isCorrect,
        })),
      },
    };
  },
});