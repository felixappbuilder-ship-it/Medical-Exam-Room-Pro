// convex/examResults/actions.ts
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

// ============================================================
// 1. GET EXAM HISTORY
// ============================================================
export const getExamHistory = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("examResults")),
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const limit = args.limit || 50;
      const { items, nextCursor, hasMore } = await ctx.runQuery(
        internal.examResults.internal.getExamResultsByUser,
        { userId: user._id, limit, cursor: args.cursor }
      );
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

// ============================================================
// 2. GET EXAM RESULT (fixed: uses internal query for answers)
// ============================================================
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
      const answers = await ctx.runQuery(internal.examResults.internal.getExamAnswersByResultId, {
        examResultId: args.examResultId,
      });
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

// ============================================================
// 3. SEND EXAM ENCOURAGEMENT NOTIFICATIONS (fixed: no ctx.db)
// ============================================================
export const sendExamEncouragementNotifications = action({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const minInterval = 4 * 24 * 60 * 60 * 1000; // 4 days
    const users = await ctx.runQuery(internal.users.internal.getAllUsers, {});
    let sentCount = 0;

    for (const user of users) {
      if (user.examEncouragementOptOut) continue;
      const lastSent = user.lastExamEncouragementSentAt || 0;
      if (now - lastSent < minInterval) continue;

      const examHistory = await ctx.runQuery(
        internal.examResults.internal.getExamResultsByUser,
        { userId: user._id, limit: 1000 }
      );
      if (examHistory.items.length === 0) continue;

      const totalExams = examHistory.items.length;
      const averageScore = examHistory.items.reduce((sum, e) => sum + (e.scorePercentage || 0), 0) / totalExams;
      const weakAreas = examHistory.items.flatMap(e => e.weakAreas || []);
      const topWeak = weakAreas.length > 0
        ? weakAreas
            .sort((a, b) => weakAreas.filter(v => v === a).length - weakAreas.filter(v => v === b).length)
            .slice(0, 3)
        : [];

      const encouragement = averageScore > 70
        ? "Great job! Keep up the excellent work."
        : averageScore > 50
        ? "You're making progress! Stay consistent."
        : "Keep going! Every practice brings you closer to mastery.";

      const message = `
        <p><strong>📚 Keep Practicing, ${user.displayName || user.name}!</strong></p>
        <p>You've completed <strong>${totalExams}</strong> exams with an average score of <strong>${Math.round(averageScore)}%</strong>.</p>
        ${topWeak.length > 0 ? `<p>Focus on <strong>${topWeak.join(', ')}</strong> for improvement.</p>` : ''}
        <p>${encouragement}</p>
        <p>Ready for another challenge?</p>
        <button data-action="navigate" data-route="subjects">Start an Exam</button>
        <button data-action="api:examResults/actions:toggleExamEncouragementOptOut" data-optOut="true" data-dismiss="true">Opt Out</button>
      `;

      await ctx.runMutation(internal.notifications.internal.insertNotification, {
        userId: user._id,
        type: "exam_encouragement",
        title: "Exam Practice Encouragement",
        message,
        data: { route: "subjects" },
      });

      // Update last sent timestamp via internal mutation
      await ctx.runMutation(internal.users.internal.updateUserById, {
        userId: user._id,
        updates: { lastExamEncouragementSentAt: now },
      });

      sentCount++;
    }
    return { sent: sentCount };
  },
});

// ============================================================
// 4. TOGGLE EXAM ENCOURAGEMENT OPT‑OUT (fixed: uses internal mutation)
// ============================================================
export const toggleExamEncouragementOptOut = action({
  args: {
    token: v.string(),
    optOut: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      await ctx.runMutation(internal.users.internal.updateUserById, {
        userId: user._id,
        updates: { examEncouragementOptOut: args.optOut },
      });
      return { success: true, data: { optOut: args.optOut } };
    } catch (err) {
      console.error("[toggleExamEncouragementOptOut] Error:", err);
      return {
        success: false,
        error: err.message || "Failed to update preference",
        message: err.message,
      };
    }
  },
});