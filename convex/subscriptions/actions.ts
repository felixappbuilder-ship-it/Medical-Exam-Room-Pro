// convex/subscriptions/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import * as notificationTriggers from "../notifications/triggers";
import * as messages from "../notifications/messages";

// ============================================================
// 1. START FREE TRIAL
// ============================================================
export const startFreeTrial = action({
  args: {
    token: v.string(),
    deviceFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[startFreeTrial] Received request");

    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.error("[startFreeTrial] Token verification failed:", result.message);
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
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
    const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId });
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

    if (user.trialUsed) {
      return {
        success: false,
        error: "trial_already_used",
        message: "Free trial already used on this account.",
      };
    }

    const existingDevice = await ctx.runQuery(
      internal.subscriptions.internal.getDeviceByFingerprint,
      { fingerprint: args.deviceFingerprint }
    );
    if (existingDevice && existingDevice.userId !== userId) {
      return {
        success: false,
        error: "device_trial_used",
        message: "This device has already been used for a free trial on another account.",
      };
    }

    await ctx.runMutation(internal.system.internal.ensureAppConfig, {});

    const config = await ctx.runQuery(internal.system.internal.getAppConfig, {});
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

    const subscriptionId = await ctx.runMutation(
      internal.subscriptions.internal.createSubscription,
      {
        userId,
        plan: "trial",
        startDate,
        expiryDate,
        status: "active",
        updatedAt: startDate,
      }
    );

    await ctx.runMutation(internal.users.internal.updateUserById, {
      userId,
      updates: { trialUsed: true },
    });

    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId,
      fingerprint: args.deviceFingerprint,
      lastUsed: startDate,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "start_free_trial",
      targetId: subscriptionId,
      details: { trialDurationHours: config.trialDurationHours, expiryDate },
    });

    // 🔔 Notify user of trial start
    await notificationTriggers.notifyTrialStarted(ctx, userId, expiryDate);

    return {
      success: true,
      data: { subscriptionId, expiryDate, plan: "trial" },
    };
  },
});

// ============================================================
// 2. PURCHASE SUBSCRIPTION (with plan ID mapping & custom amount support)
// ============================================================
export const purchaseSubscription = action({
  args: {
    token: v.string(),
    planName: v.string(),
    deviceFingerprint: v.string(),
    phoneNumber: v.string(),
    customAmount: v.optional(v.number()),
  },
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
    const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId });
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

    // Validate and normalize phone
    let formattedPhone = args.phoneNumber.replace(/\D/g, "");
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "254" + formattedPhone.slice(1);
    }
    if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }
    if (!/^254[17]\d{8}$/.test(formattedPhone)) {
      return {
        success: false,
        error: "invalid_phone",
        message: "Invalid phone number. Please enter a valid Kenyan M‑Pesa number.",
      };
    }

    await ctx.runMutation(internal.system.internal.ensureAppConfig, {});

    const config = await ctx.runQuery(internal.system.internal.getAppConfig, {});
    if (!config) {
      return {
        success: false,
        error: "config_error",
        message: "System configuration error.",
      };
    }

    let amount: number;
    let planIdentifier: string;

    if (args.planName === 'custom' && args.customAmount) {
      amount = args.customAmount;
      planIdentifier = 'custom';
      if (amount < 50 || amount > 150000) {
        return {
          success: false,
          error: "invalid_amount",
          message: "Amount must be between KES 50 and 150,000.",
        };
      }
    } else {
      const planIdToName: Record<string, string> = {
        monthly: "1 Month",
        quarterly: "3 Months",
        yearly: "1 Year",
      };
      const storedPlanName = planIdToName[args.planName] || args.planName;
      const plan = config.subscriptionPlans.find((p) => p.name === storedPlanName);
      if (!plan) {
        console.error(`[purchaseSubscription] Plan not found for: ${args.planName} (mapped to: ${storedPlanName})`);
        return {
          success: false,
          error: "invalid_plan",
          message: `Selected subscription plan "${args.planName}" does not exist.`,
        };
      }
      amount = plan.price;
      planIdentifier = args.planName;
    }

    if (config.paymentsFrozen) {
      return {
        success: false,
        error: "payments_frozen",
        message: "Payment processing is temporarily disabled. Please try again later.",
      };
    }

    const transactionId = `txn_${Date.now()}_${userId}_${Math.random().toString(36).substr(2, 9)}`;
    const paymentId = await ctx.runMutation(internal.payments.internal.createPayment, {
      transactionId,
      amount,
      userId,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phoneNumber: formattedPhone,
    });

    await ctx.scheduler.runAfter(0, internal.payments.actions.initiateMpesaPayment, {
      paymentId,
      phoneNumber: formattedPhone,
      amount,
      transactionId,
      planName: planIdentifier,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "initiate_subscription_purchase",
      targetId: paymentId,
      details: { planName: args.planName, amount, transactionId, phoneNumber: formattedPhone },
    });

    // 🔔 Notify user that payment is being processed (optional)
    // Not necessary because payment success/failure will trigger notifications via payments.

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

// ============================================================
// 3. CANCEL SUBSCRIPTION
// ============================================================
export const cancelSubscription = action({
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

    // 🔔 Notify user of cancellation
    await notificationTriggers.notifySubscriptionCancelled(ctx, userId, subscription.plan);

    return {
      success: true,
      data: { message: "Subscription cancelled. You will retain access until expiry date." },
    };
  },
});

// ============================================================
// 4. CRON: MARK EXPIRED SUBSCRIPTIONS
// ============================================================
export const markExpiredSubscriptions = action({
  args: {},
  handler: async (ctx) => {
    const expiredSubs = await ctx.runQuery(
      internal.subscriptions.internal.getExpiredActiveSubscriptions,
      {}
    );
    let count = 0;
    for (const sub of expiredSubs) {
      await ctx.runMutation(internal.subscriptions.internal.updateSubscriptionStatus, {
        subscriptionId: sub._id,
        status: "expired",
      });
      count++;
    }
    return { updated: count };
  },
});

// ============================================================
// 5. CRON: SEND EXPIRY WARNINGS (run daily)
// ============================================================
export const sendExpiryWarnings = action({
  args: {},
  handler: async (ctx) => {
    const expiringSubs = await ctx.runQuery(
      internal.subscriptions.internal.getSubscriptionsExpiringSoon,
      { days: 7 }
    );
    let count = 0;
    for (const sub of expiringSubs) {
      await notificationTriggers.notifySubscriptionExpiryWarning(ctx, sub.userId, sub.expiryDate);
      count++;
    }
    return { sent: count };
  },
});

// convex/subscriptions/actions.ts – add this at the end

// ============================================================
// CRON: SEND EXPIRY REMINDERS (daily at 6 AM UTC)
// ============================================================
export const sendExpiryReminders = action({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const warningWindow = now + sevenDays;
    const expiringSubs = await ctx.db
      .query("subscriptions")
      .withIndex("by_status_expiryDate", (q) =>
        q.eq("status", "active").lt("expiryDate", warningWindow).gt("expiryDate", now)
      )
      .collect();
    let count = 0;
    for (const sub of expiringSubs) {
      await ctx.runMutation(internal.notifications.internal.insertNotification, {
        userId: sub.userId,
        type: "subscription_expiry_reminder",
        title: "Subscription Expiring Soon",
        message: messages.buildSubscriptionExpiryReminderMessage(
          Math.ceil((sub.expiryDate - now) / (1000 * 60 * 60 * 24)),
          sub.expiryDate
        ),
        data: { route: "subscription" },
      });
      count++;
    }
    return { sent: count };
  },
});