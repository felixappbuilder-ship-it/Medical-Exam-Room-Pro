// convex/system/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const cleanupExpiredShares = action({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.runQuery(internal.system.internal.getExpiredSharedLinks, {});
    for (const link of expired) {
      await ctx.runMutation(internal.system.internal.deleteSharedLink, { linkId: link._id });
    }
    return { deletedCount: expired.length };
  },
});

export const handleStalePayments = action({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.runQuery(internal.payments.internal.getPendingPaymentsOlderThan, {
      minutes: 30,
    });
    for (const payment of stale) {
      if (payment.merchantRequestId) {
        await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
          merchantRequestId: payment.merchantRequestId,
          status: "expired",
        });
      }
    }
    return { updatedCount: stale.length };
  },
});