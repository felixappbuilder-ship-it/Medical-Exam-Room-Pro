// convex/subscriptions/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const startFreeTrial = mutation({
  args: {
    token: v.string(),
    deviceFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[startFreeTrial] Received request for device fingerprint:", args.deviceFingerprint);

    // Verify JWT with detailed logging
    let payload;
    try {
      console.log("[startFreeTrial] Calling verifyToken action...");
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      console.log("[startFreeTrial] verifyToken result:", result);
      if (!result.success) {
        console.error("[startFreeTrial] Token verification failed:", result.message);
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
      console.log("[startFreeTrial] Token verified for userId:", payload.userId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[startFreeTrial] Exception during token verification:", errorMsg);
      return {
        success: false,
        error: "token_verification_failed",
        message: `Token verification error: ${errorMsg}`,
      };
    }

    const userId = payload.userId;
    console.log("[startFreeTrial] Fetching user:", userId);

    // Fetch user – ensure getUserById exists in users/internal.ts
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) {
      console.error("[startFreeTrial] User not found:", userId);
      return {
        success: false,
        error: "user_not_found",
        message: "User not found.",
      };
    }

    if (user.isLocked) {
      console.warn("[startFreeTrial] Account locked:", userId);
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}.`,
      };
    }

    // Check existing active subscription
    const existingSubscription = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId }
    );
    if (existingSubscription && existingSubscription.expiryDate > Date.now()) {
      console.warn("[startFreeTrial] Already has active subscription:", userId);
      return {
        success: false,
        error: "already_subscribed",
        message: "You already have an active subscription.",
      };
    }

    // Check trialUsed flag
    if (user.trialUsed) {
      console.warn("[startFreeTrial] Trial already used for user:", userId);
      return {
        success: false,
        error: "trial_already_used",
        message: "Free trial already used on this account.",
      };
    }

    // Check device fingerprint against other users
    const existingDevice = await ctx.db
      .query("devices")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.deviceFingerprint))
      .first();
    if (existingDevice && existingDevice.userId !== userId) {
      console.warn("[startFreeTrial] Device already used for trial by another user:", existingDevice.userId);
      return {
        success: false,
        error: "device_trial_used",
        message: "This device has already been used for a free trial on another account.",
      };
    }

    // Get app config
    const config = await ctx.db.query("appConfig").first();
    if (!config) {
      console.error("[startFreeTrial] AppConfig missing!");
      return {
        success: false,
        error: "config_error",
        message: "System configuration error.",
      };
    }

    const trialDurationMs = config.trialDurationHours * 60 * 60 * 1000;
    const startDate = Date.now();
    const expiryDate = startDate + trialDurationMs;

    // Create subscription
    const subscriptionId = await ctx.runMutation(
      internal.subscriptions.internal.createSubscription,
      {
        userId,
        plan: "trial",
        startDate,
        expiryDate,
        status: "active",
      }
    );
    console.log("[startFreeTrial] Subscription created:", subscriptionId);

    // Mark trial as used
    await ctx.runMutation(internal.users.internal.updateUserById, {
      userId,
      updates: { trialUsed: true },
    });

    // Add device if not already present
    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId,
      fingerprint: args.deviceFingerprint,
      lastUsed: startDate,
    });

    // Audit log
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "start_free_trial",
      targetId: subscriptionId,
      details: { trialDurationHours: config.trialDurationHours, expiryDate },
    });

    return {
      success: true,
      data: { subscriptionId, expiryDate, plan: "trial" },
    };
  },
});

// Rest of the file (purchaseSubscription, cancelSubscription) unchanged
export const purchaseSubscription = mutation({
  // ... same as before ...
});

export const cancelSubscription = mutation({
  // ... same as before ...
});