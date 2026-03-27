import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { z } from "zod";

const syncExamResultsSchema = z.object({
  results: z.array(
    z.object({
      examId: z.string(),
      subject: z.string(),
      mode: z.string(),
      date: z.number(),
      totalQuestions: z.number().positive(),
      correctAnswers: z.number().min(0),
      timeSpent: z.number().positive(),
      questions: z.array(
        z.object({
          questionId: z.string(),
          userAnswer: z.optional(z.string()),
          timeSpent: z.number(),
          flagged: z.boolean(),
          correct: z.boolean(),
        })
      ),
      topicPerformance: z.array(
        z.object({
          topic: z.string(),
          correct: z.number(),
          total: z.number(),
          avgTime: z.number(),
        })
      ),
      weakAreas: z.array(z.string()),
    })
  ),
});

const deleteExamResultSchema = z.object({
  examId: v.string(),
});

const shareExamResultSchema = z.object({
  examId: v.string(),
  expiresInDays: v.optional(v.number()),
});

// -----------------------------------------------------------------------------
// Sync offline exam results (upsert)
// -----------------------------------------------------------------------------
export const syncExamResults = mutation({
  args: {
    results: v.array(
      v.object({
        examId: v.string(),
        subject: v.string(),
        mode: v.string(),
        date: v.number(),
        totalQuestions: v.number(),
        correctAnswers: v.number(),
        timeSpent: v.number(),
        questions: v.array(
          v.object({
            questionId: v.string(),
            userAnswer: v.optional(v.string()),
            timeSpent: v.number(),
            flagged: v.boolean(),
            correct: v.boolean(),
          })
        ),
        topicPerformance: v.array(
          v.object({
            topic: v.string(),
            correct: v.number(),
            total: v.number(),
            avgTime: v.number(),
          })
        ),
        weakAreas: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const validated = syncExamResultsSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    let syncedCount = 0;

    for (const result of validated.results) {
      // Check if exam result with this examId already exists
      const existing = await ctx.db
        .query("examResults")
        .withIndex("by_examId", (q: any) => q.eq("examId", result.examId))
        .first();

      if (existing) {
        // Update existing (only if it belongs to the user)
        if (existing.userId !== userId) {
          // This should not happen, but skip if mismatch
          continue;
        }
        await ctx.db.patch(existing._id, {
          ...result,
          userId, // ensure userId remains same
        });
      } else {
        // Insert new
        await ctx.db.insert("examResults", {
          ...result,
          userId,
        });
      }
      syncedCount++;
    }

    return { syncedCount };
  },
});

// -----------------------------------------------------------------------------
// Delete an exam result (user or admin)
// -----------------------------------------------------------------------------
export const deleteExamResult = mutation({
  args: {
    examId: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = deleteExamResultSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    // Find the exam result
    const examResult = await ctx.db
      .query("examResults")
      .withIndex("by_examId", (q: any) => q.eq("examId", validated.examId))
      .first();

    if (!examResult) throw new ConvexError("Exam result not found");

    // Check if user owns it or is admin
    const user = await ctx.db.get(userId);
    const isAdmin = user?.role === "admin";

    if (examResult.userId !== userId && !isAdmin) {
      throw new ConvexError("Unauthorized");
    }

    // Delete any associated shared links
    const sharedLinks = await ctx.db
      .query("sharedLinks")
      .withIndex("by_target", (q: any) =>
        q.eq("type", "exam").eq("targetId", examResult._id)
      )
      .collect();
    for (const link of sharedLinks) {
      await ctx.db.delete(link._id);
    }

    // Delete the exam result
    await ctx.db.delete(examResult._id);

    return { success: true };
  },
});

// -----------------------------------------------------------------------------
// Share an exam result (generate public link)
// -----------------------------------------------------------------------------
export const shareExamResult = mutation({
  args: {
    examId: v.string(),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const validated = shareExamResultSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    // Find the exam result
    const examResult = await ctx.db
      .query("examResults")
      .withIndex("by_examId", (q: any) => q.eq("examId", validated.examId))
      .first();

    if (!examResult) throw new ConvexError("Exam result not found");
    if (examResult.userId !== userId) throw new ConvexError("Unauthorized");

    // Check if already shared? We'll allow multiple shares, so always create new link.

    // Generate unique token
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const now = Date.now();
    const expiresInMs = (validated.expiresInDays || 7) * 24 * 60 * 60 * 1000; // default 7 days
    const expiresAt = now + expiresInMs;

    // Create shared link entry
    await ctx.db.insert("sharedLinks", {
      token,
      type: "exam",
      targetId: examResult._id,
      createdAt: now,
      expiresAt,
      createdBy: userId,
    });

    return {
      shareToken: token,
      url: `/shared/exam/${token}`, // frontend route
    };
  },
});