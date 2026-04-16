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
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User not found.",
      };
    }

    if (user.isLocked) {
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}.`,
      };
    }

    // Multi-factor trial binding (R12): phone + device fingerprint + payment history
    const existingSubscription = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId }
    );
    if (existingSubscription && existingSubscription.expiryDate > Date.now()) {
      return {
        success: false,
        error: "already_subscribed",
        message: "You already have an active subscription.",
      };
    }

    // Check trialUsed flag
    if (user.trialUsed) {
      return {
        success: false,
        error: "trial_already_used",
        message: "Free trial already used on this account.",
      };
    }

    // Check device fingerprint against other users (prevent multiple trials on same device)
    const existingDevice = await ctx.db
      .query("devices")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.deviceFingerprint))
      .first();
    if (existingDevice && existingDevice.userId !== userId) {
      return {
        success: false,
        error: "device_trial_used",
        message: "This device has already been used for a free trial on another account.",
      };
    }

    // Get trial duration from appConfig
    const config = await ctx.db.query("appConfig").first();
    if (!config) {
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

    // Audit log (R16)
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

export const purchaseSubscription = mutation({
  args: {
    token: v.string(),
    planName: v.string(),
    deviceFingerprint: v.string(),
  },
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
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User not found.",
      };
    }

    if (user.isLocked) {
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}.`,
      };
    }

    // Get plan details from appConfig
    const config = await ctx.db.query("appConfig").first();
    if (!config) {
      return {
        success: false,
        error: "config_error",
        message: "System configuration error.",
      };
    }
    const plan = config.subscriptionPlans.find((p) => p.name === args.planName);
    if (!plan) {
      return {
        success: false,
        error: "invalid_plan",
        message: "Selected subscription plan does not exist.",
      };
    }

    // Check if payments are frozen
    if (config.paymentsFrozen) {
      return {
        success: false,
        error: "payments_frozen",
        message: "Payment processing is temporarily disabled. Please try again later.",
      };
    }

    // Generate unique transactionId for idempotency
    const transactionId = `txn_${Date.now()}_${userId}_${Math.random().toString(36).substr(2, 9)}`;

    // Create pending payment record
    const paymentId = await ctx.db.insert("payments", {
      transactionId,
      amount: plan.price,
      userId,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Schedule M-Pesa STK push action (runs immediately after mutation commits)
    await ctx.scheduler.runAfter(0, internal.payments.actions.initiateMpesaPayment, {
      paymentId,
      phoneNumber: user.phone,
      amount: plan.price,
      transactionId,
      planName: args.planName,
    });

    // Audit log (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "initiate_subscription_purchase",
      targetId: paymentId,
      details: { planName: args.planName, amount: plan.price, transactionId },
    });

    return {
      success: true,
      data: {
        paymentId,
        transactionId,
        status: "pending",
        message: "STK push sent to your phone. Please complete payment.",
      },
    };
  },
});

export const cancelSubscription = mutation({
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
    if (!subscription) {
      return {
        success: false,
        error: "no_active_subscription",
        message: "You do not have an active subscription to cancel.",
      };
    }

    await ctx.runMutation(internal.subscriptions.internal.cancelSubscriptionById, {
      subscriptionId: subscription._id,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "cancel_subscription",
      targetId: subscription._id,
      details: { plan: subscription.plan, expiryDate: subscription.expiryDate },
    });

    return {
      success: true,
      data: { message: "Subscription cancelled. You will retain access until expiry date." },
    };
  },
});