// convex/subscriptions/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getPlans = query({
  args: {},
  handler: async (ctx) => {
    // Public: read from appConfig singleton
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

export const getSubscriptionStatus = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    // Verify JWT
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
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    const userId = payload.userId;
    const subscription = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId }
    );

    const hasAccess = subscription !== null && subscription.expiryDate > Date.now();
    return {
      success: true,
      data: {
        hasAccess,
        expiryDate: subscription?.expiryDate || null,
        plan: subscription?.plan || null,
        status: subscription?.status || "none",
      },
    };
  },
});