import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { z } from "zod";

// Validation schemas
const startFreeTrialSchema = z.object({
  deviceFingerprint: v.string(),
});

const purchaseSubscriptionSchema = z.object({
  planId: z.enum(["monthly", "quarterly", "yearly"]),
  phoneNumber: z.string().regex(/^254\d{9}$/),
});

const cancelSubscriptionSchema = z.object({
  subscriptionId: v.id("subscriptions"),
});

// -----------------------------------------------------------------------------
// Start Free Trial
// -----------------------------------------------------------------------------
export const startFreeTrial = mutation({
  args: {
    deviceFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = startFreeTrialSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db.get(identity.subject as Id<"users">);
    if (!user) throw new ConvexError("User not found");

    // Check if trial already used
    if (user.trialUsed) {
      throw new ConvexError("Free trial already used");
    }

    // Get trial duration from appConfig
    const config = await ctx.db.get("config" as Id<"appConfig">);
    const trialDurationHours = config?.trialDuration ?? 3; // default 3 hours
    const trialDurationMs = trialDurationHours * 60 * 60 * 1000;

    const now = Date.now();
    const expiryDate = now + trialDurationMs;

    // Create trial subscription
    const subscriptionId = await ctx.db.insert("subscriptions", {
      userId: user._id,
      plan: "trial",
      startDate: now,
      expiryDate,
      isActive: true,
      autoRenew: false,
      paymentHistory: [],
    });

    // Mark trial as used
    await ctx.db.patch(user._id, { trialUsed: true });

    return {
      subscriptionId,
      plan: "trial",
      startDate: now,
      expiryDate,
    };
  },
});

// -----------------------------------------------------------------------------
// Purchase Subscription (initiate M‑Pesa payment)
// -----------------------------------------------------------------------------
export const purchaseSubscription = mutation({
  args: {
    planId: v.union(
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("yearly")
    ),
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = purchaseSubscriptionSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db.get(identity.subject as Id<"users">);
    if (!user) throw new ConvexError("User not found");

    // Check if payments are frozen
    const config = await ctx.db.get("config" as Id<"appConfig">);
    if (config?.paymentsFrozen) {
      throw new ConvexError("Payments are temporarily frozen. Please try again later.");
    }

    // Get plan details from config
    const plan = config?.plans?.find((p: any) => p.id === validated.planId);
    if (!plan) {
      throw new ConvexError("Invalid plan selected");
    }

    // Generate unique transaction ID
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    // Create pending payment record
    const paymentId = await ctx.db.insert("payments", {
      userId: user._id,
      subscriptionId: undefined, // will be set after payment completes
      amount: plan.price,
      currency: "KES",
      status: "pending",
      phoneNumber: validated.phoneNumber,
      transactionId,
      merchantRequestId: undefined,
      createdAt: Date.now(),
    });

    // Schedule the M‑Pesa initiation action
    await ctx.scheduler.runAfter(0, internal.payments.actions.initiateMpesaPayment, {
      paymentId,
      userId: user._id,
      amount: plan.price,
      phoneNumber: validated.phoneNumber,
      description: `Medical Exam Room Pro ${validated.planId} subscription`,
      metadata: {
        planId: validated.planId,
        durationDays: plan.durationDays,
      },
    });

    return {
      transactionId,
      paymentId,
      instructions: "Please check your phone for the M‑Pesa STK push prompt and enter your PIN to complete payment.",
    };
  },
});

// -----------------------------------------------------------------------------
// Cancel Subscription (disable auto-renew – future implementation)
// -----------------------------------------------------------------------------
export const cancelSubscription = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
  },
  handler: async (ctx, args) => {
    const validated = cancelSubscriptionSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const subscription = await ctx.db.get(validated.subscriptionId);
    if (!subscription) throw new ConvexError("Subscription not found");

    // Ensure the subscription belongs to the current user
    if (subscription.userId !== identity.subject) {
      throw new ConvexError("Unauthorized");
    }

    // Only update autoRenew flag (actual expiry remains)
    await ctx.db.patch(validated.subscriptionId, { autoRenew: false });

    return { success: true };
  },
});