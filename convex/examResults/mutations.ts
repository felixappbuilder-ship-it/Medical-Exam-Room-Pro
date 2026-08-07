"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const syncExamResults = action({
  args: {
    token: v.string(),
    results: v.array(
      v.object({
        examId: v.string(),
        subject: v.optional(v.string()),
        mode: v.optional(v.string()),
        date: v.optional(v.string()),
        totalQuestions: v.optional(v.number()),
        correctAnswers: v.optional(v.number()),
        scorePercentage: v.optional(v.number()),
        timeSpent: v.optional(v.number()),
        averageTimePerQuestion: v.optional(v.number()),
        questions: v.optional(v.array(v.any())),
        topicPerformance: v.optional(
          v.array(
            v.object({
              topic: v.string(),
              questions: v.number(),
              correct: v.number(),
              percentage: v.number(),
              averageTime: v.number(),
            })
          )
        ),
        weakAreas: v.optional(v.array(v.string())),
        completedAt: v.number(),
        answers: v.optional(
          v.array(
            v.object({
              questionId: v.string(),
              selectedAnswer: v.string(),
              isCorrect: v.boolean(),
              timeSpent: v.number(),
            })
          )
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    console.log("[syncExamResults] Received", args.results.length, "results");

    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.error("[syncExamResults] Token verification failed:", result.message);
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
      console.log("[syncExamResults] Token verified for userId:", payload.userId);
    } catch (err) {
      console.error("[syncExamResults] Token verification error:", err);
      return { success: false, error: "token_verification_failed", message: "Failed to verify authentication token." };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) {
      console.error("[syncExamResults] User not found:", userId);
      return { success: false, error: "user_not_found", message: "User not found." };
    }
    if (user.isLocked) {
      console.error("[syncExamResults] Account locked:", userId);
      return { success: false, error: "account_locked", message: `Account locked: ${user.lockReason}` };
    }

    const savedResults = [];
    for (const result of args.results) {
      console.log(`[syncExamResults] Processing exam: ${result.examId}`);

      // Transform topicPerformance if provided in frontend format
      let topicPerformance = result.topicPerformance || [];
      if (Array.isArray(topicPerformance) && topicPerformance.length > 0 && typeof topicPerformance[0] === 'object') {
        // If it's frontend format (with questions/correct/percentage), convert to backend format (score/timePerQuestion)
        if ('questions' in topicPerformance[0] || 'correct' in topicPerformance[0]) {
          topicPerformance = topicPerformance.map((tp: any) => ({
            topic: tp.topic || '',
            score: tp.percentage ?? (tp.correct / tp.questions * 100) ?? 0,
            timePerQuestion: tp.averageTime ?? 0,
          }));
        }
      }

      const upsertData: any = {
        userId,
        examId: result.examId,
        score: result.scorePercentage ?? 0,
        topicPerformance,
        weakAreas: result.weakAreas || [],
        createdAt: result.completedAt,
        subject: result.subject || '',
        mode: result.mode || '',
        date: result.date || new Date(result.completedAt).toISOString(),
        totalQuestions: result.totalQuestions || 0,
        correctAnswers: result.correctAnswers || 0,
        scorePercentage: result.scorePercentage || 0,
        timeSpent: result.timeSpent || 0,
        averageTimePerQuestion: result.averageTimePerQuestion || 0,
        questions: result.questions || [],
      };

      const examResultId = await ctx.runMutation(internal.examResults.internal.upsertExamResult, upsertData);
      console.log(`[syncExamResults] Upserted exam result ID: ${examResultId}`);

      // Store answers
      if (result.answers && result.answers.length > 0) {
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
      }
      savedResults.push(examResultId);
    }

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "sync_exam_results",
      targetId: userId,
      details: { count: args.results.length },
    });

    console.log("[syncExamResults] Saved", savedResults.length, "exam results.");
    return { success: true, data: { savedCount: savedResults.length } };
  },
});

export const deleteExamResult = action({
  args: {
    token: v.string(),
    examResultId: v.id("examResults"),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      return { success: false, error: "token_verification_failed", message: "Failed to verify authentication token." };
    }

    const userId = payload.userId;
    const examResult = await ctx.runQuery(internal.examResults.internal.getExamResultById, {
      examResultId: args.examResultId,
    });
    if (!examResult || examResult.userId !== userId) {
      return { success: false, error: "unauthorized", message: "You do not own this exam result." };
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

    return { success: true, data: { message: "Exam result deleted." } };
  },
});

export const shareExamResult = action({
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
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      return { success: false, error: "token_verification_failed", message: "Failed to verify authentication token." };
    }

    const userId = payload.userId;
    const examResult = await ctx.runQuery(internal.examResults.internal.getExamResultById, {
      examResultId: args.examResultId,
    });
    if (!examResult || examResult.userId !== userId) {
      return { success: false, error: "unauthorized", message: "You cannot share this exam result." };
    }

    const expiryHours = args.expiryHours || 168;
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