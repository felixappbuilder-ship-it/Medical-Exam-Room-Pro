import { v } from "convex/values";
import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { z } from "zod";

const getExamHistorySchema = z.object({
  limit: v.optional(v.number()),
  offset: v.optional(v.number()),
});

const getExamResultSchema = z.object({
  examId: v.string(),
});

const getSharedExamSchema = z.object({
  token: v.string(),
});

// -----------------------------------------------------------------------------
// Get user's exam history (paginated)
// -----------------------------------------------------------------------------
export const getExamHistory = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const validated = getExamHistorySchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const limit = validated.limit ?? 20;
    const offset = validated.offset ?? 0;

    const results = await ctx.db
      .query("examResults")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .order("desc")
      .take(limit + offset);

    const paginated = results.slice(offset, offset + limit);

    // Return without sensitive internal fields? No sensitive fields in examResults.
    return paginated;
  },
});

// -----------------------------------------------------------------------------
// Get specific exam result by examId
// -----------------------------------------------------------------------------
export const getExamResult = query({
  args: {
    examId: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = getExamResultSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    // examId is unique, but we need to ensure it belongs to user
    const examResult = await ctx.db
      .query("examResults")
      .withIndex("by_examId", (q: any) => q.eq("examId", validated.examId))
      .first();

    if (!examResult) throw new ConvexError("Exam result not found");
    if (examResult.userId !== userId) throw new ConvexError("Unauthorized");

    return examResult;
  },
});

// -----------------------------------------------------------------------------
// Get shared exam result by token (public)
// -----------------------------------------------------------------------------
export const getSharedExam = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = getSharedExamSchema.parse(args);

    // Find the shared link
    const sharedLink = await ctx.db
      .query("sharedLinks")
      .withIndex("by_token", (q: any) => q.eq("token", validated.token))
      .first();

    if (!sharedLink) throw new ConvexError("Invalid share link");
    if (sharedLink.type !== "exam") throw new ConvexError("Invalid share link type");

    // Check expiration
    if (sharedLink.expiresAt < Date.now()) {
      throw new ConvexError("Share link has expired");
    }

    // Get the exam result
    const examResult = await ctx.db.get(sharedLink.targetId as Id<"examResults">);
    if (!examResult) throw new ConvexError("Exam result not found");

    // Return the exam result (publicly accessible)
    return examResult;
  },
});