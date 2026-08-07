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