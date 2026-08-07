// convex/sharedExams/actions.ts
"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";

export const cleanupExpiredSharedExams = action({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.runQuery(internal.sharedExams.internal.getExpiredSharedExams, {});
    for (const exam of expired) {
      await ctx.runMutation(internal.sharedExams.internal.deleteSharedExam, { id: exam._id });
    }
    return { deletedCount: expired.length };
  },
});