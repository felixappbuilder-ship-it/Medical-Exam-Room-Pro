// convex/subscriptions/queries.ts
import { query, action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getPlans = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db.query("appConfig").first();
    if (!config) {
      return {
        success: false,
        error: "config_not_found",
        message: "System configuration missing.",
      };
    }
    return {
      success: true,
      data: { plans: config.subscriptionPlans },
    };
  },
});

export const getSubscriptionStatus = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to verify authentication token.";
      console.error("[getSubscriptionStatus] Token verification error:", message);
      return {
        success: false,
        error: "token_verification_failed",
        message,
      };
    }

    const userId = payload.userId;
    const subscription = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId }
    );

    if (!subscription) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: {
        _id: subscription._id,
        userId: subscription.userId,
        plan: subscription.plan,
        isActive: subscription.expiryDate > Date.now(),
        expiryDate: subscription.expiryDate,
        status: subscription.status,
        startDate: subscription.startDate,
        autoRenew: subscription.autoRenew ?? false,
        paymentMethod: subscription.paymentMethod ?? null,
      },
    };
  },
});

export const checkTrialEligibility = action({
  args: {
    token: v.string(),
    deviceFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: result.error,
          message: result.message,
        };
      }
      payload = result.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to verify authentication token.";
      console.error("[checkTrialEligibility] Token verification error:", message);
      return {
        success: false,
        error: "token_verification_failed",
        message,
      };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId });
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User not found.",
      };
    }

    if (user.trialUsed) {
      return {
        success: true,
        data: {
          eligible: false,
          reason: "You have already used your free trial on this account.",
        },
      };
    }

    const existingDevice = await ctx.runQuery(
      internal.subscriptions.internal.getDeviceByFingerprint,
      { fingerprint: args.deviceFingerprint }
    );
    if (existingDevice && existingDevice.userId !== userId) {
      return {
        success: true,
        data: {
          eligible: false,
          reason: "This device has already been used for a free trial on another account.",
        },
      };
    }

    const payments = await ctx.runQuery(
      internal.subscriptions.internal.getUserCompletedPayments,
      { userId }
    );
    if (payments.length > 0) {
      return {
        success: true,
        data: {
          eligible: false,
          reason: "You have already purchased a subscription. Free trial is for new users only.",
        },
      };
    }

    const subscriptions = await ctx.runQuery(
      internal.subscriptions.internal.getUserSubscriptions,
      { userId }
    );
    const hasPaidPlan = subscriptions.some((sub) => sub.plan !== "trial");
    if (hasPaidPlan) {
      return {
        success: true,
        data: {
          eligible: false,
          reason: "You have already subscribed to a paid plan.",
        },
      };
    }

    return {
      success: true,
      data: {
        eligible: true,
        reason: "",
      },
    };
  },
});