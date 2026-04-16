// convex/payments/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const updatePaymentStatus = internalMutation({
  args: {
    merchantRequestId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("expired")),
    receipt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_merchantRequestId", (q) => q.eq("merchantRequestId", args.merchantRequestId))
      .first();
    if (!payment) return;
    // Idempotency: only update if still pending (already enforced in http.ts, but double-check)
    if (payment.status !== "pending") return;
    const updates: any = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.receipt) {
      updates.mpesaReceipt = args.receipt;
    }
    await ctx.db.patch(payment._id, updates);
    // If payment completed, activate subscription
    if (args.status === "completed") {
      await ctx.runMutation(internal.payments.internal.activateSubscriptionAfterPayment, {
        paymentId: payment._id,
      });
    }
  },
});

export const getPaymentByMerchantRequestId = internalQuery({
  args: { merchantRequestId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_merchantRequestId", (q) => q.eq("merchantRequestId", args.merchantRequestId))
      .first();
  },
});

export const getPendingPaymentsOlderThan = internalQuery({
  args: { minutes: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.minutes * 60 * 1000;
    return await ctx.db
      .query("payments")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending").lt("createdAt", cutoff))
      .collect();
  },
});

export const activateSubscriptionAfterPayment = internalMutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return;
    const user = await ctx.db.get(payment.userId);
    if (!user) return;

    // Get plan details from appConfig (need to infer plan from amount or store planName in payment)
    // For simplicity, assume payment.transactionId contains plan info or we need to add planName to payments table.
    // Blueprint didn't add planName to payments schema, so we'll fetch the plan by amount matching.
    const config = await ctx.db.query("appConfig").first();
    if (!config) return;
    const matchedPlan = config.subscriptionPlans.find((p) => p.price === payment.amount);
    if (!matchedPlan) return;

    const startDate = Date.now();
    const expiryDate = startDate + matchedPlan.days * 24 * 60 * 60 * 1000;

    // Check if user already has active subscription – if so, extend
    const existingSub = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", payment.userId))
      .first();
    if (existingSub && existingSub.expiryDate > startDate) {
      // Extend existing subscription
      const newExpiry = existingSub.expiryDate + matchedPlan.days * 24 * 60 * 60 * 1000;
      await ctx.db.patch(existingSub._id, {
        expiryDate: newExpiry,
        status: "active",
      });
    } else {
      // Create new subscription
      await ctx.db.insert("subscriptions", {
        userId: payment.userId,
        plan: matchedPlan.name,
        startDate,
        expiryDate,
        status: "active",
      });
    }

    // Audit log
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: payment.userId,
      action: "payment_completed_subscription_activated",
      targetId: payment._id,
      details: { amount: payment.amount, plan: matchedPlan.name, receipt: payment.mpesaReceipt },
    });
  },
});