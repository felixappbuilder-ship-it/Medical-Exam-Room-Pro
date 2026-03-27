import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export const getUserExamResults = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("examResults")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .collect();
  },
});