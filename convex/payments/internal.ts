import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";

// -----------------------------------------------------------------------------
// Internal query to find payment by merchantRequestId or checkoutRequestId
// -----------------------------------------------------------------------------
export const findPaymentByMerchantRequest = internalQuery({
  args: {
    merchantRequestId: v.optional(v.string()),
    checkoutRequestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.merchantRequestId) {
      const payment = await ctx.db
        .query("payments")
        .withIndex("by_merchantRequestId", (q: any) =>
          q.eq("merchantRequestId", args.merchantRequestId)
        )
        .first();
      if (payment) return payment;
    }
    if (args.checkoutRequestId) {
      const payment = await ctx.db
        .query("payments")
        .withIndex("by_checkoutRequestId", (q: any) =>
          q.eq("checkoutRequestId", args.checkoutRequestId)
        )
        .first();
      if (payment) return payment;
    }
    return null;
  },
});

// -----------------------------------------------------------------------------
// Internal mutation to update payment status and details
// -----------------------------------------------------------------------------
export const updatePaymentStatus = internalMutation({
  args: {
    paymentId: v.id("payments"),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("refunded")
    ),
    merchantRequestId: v.optional(v.string()),
    checkoutRequestId: v.optional(v.string()),
    mpesaReceipt: v.optional(v.string()),
    resultCode: v.optional(v.number()),
    resultDesc: v.optional(v.string()),
    details: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new ConvexError("Payment not found");

    const updates: any = {
      status: args.status,
    };
    if (args.merchantRequestId !== undefined) updates.merchantRequestId = args.merchantRequestId;
    if (args.checkoutRequestId !== undefined) updates.checkoutRequestId = args.checkoutRequestId;
    if (args.mpesaReceipt !== undefined) updates.mpesaReceipt = args.mpesaReceipt;
    if (args.resultCode !== undefined) updates.resultCode = args.resultCode;
    if (args.resultDesc !== undefined) updates.resultDesc = args.resultDesc;
    if (args.details !== undefined) updates.details = args.details;

    if (args.status === "completed" || args.status === "failed") {
      updates.completedAt = Date.now();
    }

    await ctx.db.patch(args.paymentId, updates);
  },
});

// -----------------------------------------------------------------------------
// Internal mutation to create or update subscription after successful payment
// -----------------------------------------------------------------------------
export const activateSubscriptionAfterPayment = internalMutation({
  args: {
    paymentId: v.id("payments"),
    userId: v.id("users"),
    metadata: v.any(), // contains planId, durationDays
  },
  handler: async (ctx, args) => {
    const { planId, durationDays } = args.metadata;
    const now = Date.now();
    const expiryDate = now + durationDays * 24 * 60 * 60 * 1000;

    // Check if user already has an active subscription for this plan
    const existingSub = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .first();

    if (existingSub) {
      // Update existing subscription (extend or replace)
      await ctx.db.patch(existingSub._id, {
        plan: planId,
        startDate: now,
        expiryDate,
        isActive: true,
        paymentHistory: [...(existingSub.paymentHistory || []), args.paymentId],
      });
    } else {
      // Create new subscription
      await ctx.db.insert("subscriptions", {
        userId: args.userId,
        plan: planId,
        startDate: now,
        expiryDate,
        isActive: true,
        autoRenew: false, // default
        paymentHistory: [args.paymentId],
      });
    }

    // Link payment to subscription
    const payment = await ctx.db.get(args.paymentId);
    if (payment) {
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
        .first();
      if (sub) {
        await ctx.db.patch(args.paymentId, { subscriptionId: sub._id });
      }
    }
  },
});