// convex/sharedExams/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getExpiredSharedExams = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("sharedExams")
      .withIndex("by_expiry", (q) => q.lt("expiry", now))
      .collect();
    return expired;
  },
});

export const deleteSharedExam = internalMutation({
  args: { id: v.id("sharedExams") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// ============================================================
// CREATE SHARED EXAM (internal mutation for actions)
// ============================================================
export const createSharedExam = internalMutation({
  args: {
    userId: v.id("users"),
    token: v.string(),
    examData: v.any(),
    expiry: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("sharedExams", {
      token: args.token,
      examData: args.examData,
      userId: args.userId,
      createdAt: Date.now(),
      expiry: args.expiry,
    });
  },
});