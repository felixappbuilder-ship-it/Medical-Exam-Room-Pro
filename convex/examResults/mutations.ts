// convex/examResults/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

export const syncExamResults = mutation({
  args: {
    token: v.string(),
    results: v.array(
      v.object({
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
        completedAt: v.number(),
        answers: v.array(
          v.object({
            questionId: v.string(),
            selectedAnswer: v.string(),
            isCorrect: v.boolean(),
            timeSpent: v.number(),
          })
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Verify JWT
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
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User not found.",
      };
    }
    if (user.isLocked) {
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}.`,
      };
    }

    const savedResults = [];
    for (const result of args.results) {
      // Upsert exam result
      const examResultId = await ctx.runMutation(internal.examResults.internal.upsertExamResult, {
        userId,
        examId: result.examId,
        score: result.score,
        topicPerformance: result.topicPerformance,
        weakAreas: result.weakAreas,
        createdAt: result.completedAt,
      });

      // Store answers in normalized examAnswers table (R9)
      for (const answer of result.answers) {
        const existingAnswer = await ctx.db
          .query("examAnswers")
          .filter((q) =>
            q.and(
              q.eq(q.field("examResultId"), examResultId),
              q.eq(q.field("questionId"), answer.questionId)
            )
          )
          .first();
        if (existingAnswer) {
          await ctx.db.patch(existingAnswer._id, {
            selectedAnswer: answer.selectedAnswer,
            isCorrect: answer.isCorrect,
            timeSpent: answer.timeSpent,
          });
        } else {
          await ctx.db.insert("examAnswers", {
            examResultId,
            questionId: answer.questionId,
            selectedAnswer: answer.selectedAnswer,
            isCorrect: answer.isCorrect,
            timeSpent: answer.timeSpent,
          });
        }
      }
      savedResults.push(examResultId);
    }

    // Audit log (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "sync_exam_results",
      targetId: userId,
      details: { count: args.results.length },
    });

    return {
      success: true,
      data: { savedCount: savedResults.length },
    };
  },
});

export const deleteExamResult = mutation({
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
    if (!examResult) {
      return {
        success: false,
        error: "not_found",
        message: "Exam result not found.",
      };
    }
    if (examResult.userId !== userId) {
      return {
        success: false,
        error: "unauthorized",
        message: "You do not own this exam result.",
      };
    }

    await ctx.runMutation(internal.examResults.internal.deleteExamResultById, {
      examResultId: args.examResultId,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "delete_exam_result",
      targetId: args.examResultId,
      details: { examId: examResult.examId },
    });

    return {
      success: true,
      data: { message: "Exam result deleted." },
    };
  },
});

export const shareExamResult = mutation({
  args: {
    token: v.string(),
    examResultId: v.id("examResults"),
    expiryHours: v.optional(v.number()),
    password: v.optional(v.string()),
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
        message: "You cannot share this exam result.",
      };
    }

    const expiryHours = args.expiryHours || 168; // Default 7 days
    const expiry = Date.now() + expiryHours * 60 * 60 * 1000;
    const shareToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    let passwordHash: string | undefined = undefined;
    if (args.password) {
      passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, {
        password: args.password,
      });
    }

    const linkId = await ctx.runMutation(internal.examResults.internal.createSharedLink, {
      targetType: "examResult",
      targetId: args.examResultId,
      token: shareToken,
      expiry,
      passwordHash,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "share_exam_result",
      targetId: args.examResultId,
      details: { shareToken, expiryHours, hasPassword: !!args.password },
    });

    return {
      success: true,
      data: {
        shareToken,
        shareUrl: `/shared/exam/${shareToken}`,
        expiry,
      },
    };
  },
});