// convex/subscriptions/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import * as notificationTriggers from "../notifications/triggers";
import * as messages from "../notifications/messages";

// ============================================================
// DEVICE NORMALIZER
// ------------------------------------------------------------
// Old app-store clients send: { deviceFingerprint }
// New clients send:           { deviceId, deviceInfo }
// Both are normalised to the same { deviceId, deviceFingerprint, deviceInfo }.
// ============================================================
function normalizeDevice(args: {
  deviceId?: string | null;
  deviceFingerprint?: string | null;
  deviceInfo?: any;
}): { deviceId: string; deviceFingerprint: string; deviceInfo: any } {
  const id =
    (typeof args.deviceId === "string" && args.deviceId.trim()) ||
    (typeof args.deviceFingerprint === "string" && args.deviceFingerprint.trim()) ||
    "";

  if (!id) throw new Error("DEVICE_ID_REQUIRED");

  let info: any = {};
  if (args.deviceInfo && typeof args.deviceInfo === "object") {
    info = { ...args.deviceInfo };
  } else if (typeof args.deviceInfo === "string") {
    info = { platform: args.deviceInfo };
  }
  if (!info.platform) info.platform = "unknown";

  return {
    deviceId: id,
    deviceFingerprint: id,
    deviceInfo: info,
  };
}

// ============================================================
// HELPER: sanitize phone number to 254XXXXXXXXX
// ============================================================
function normalizePhoneNumber(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "254" + digits.slice(1);
  if (!digits.startsWith("254")) digits = "254" + digits;
  return /^254[17]\d{8}$/.test(digits) ? digits : null;
}

// ============================================================
// 1. START FREE TRIAL (with device registration)
// ============================================================
export const startFreeTrial = action({
  args: {
    token: v.string(),
    deviceId: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
    deviceInfo: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // ---- Normalize device ----
    let device;
    try {
      device = normalizeDevice({
        deviceId: args.deviceId,
        deviceFingerprint: args.deviceFingerprint,
        deviceInfo: args.deviceInfo,
      });
    } catch {
      return {
        success: false,
        error: "device_id_required",
        message: "A device identifier is required.",
      };
    }
    const { deviceId, deviceFingerprint, deviceInfo } = device;

    // ---- Auth ----
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        error: "token_verification_failed",
        message: `Token verification error: ${errorMsg}`,
      };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId });
    if (!user) return { success: false, error: "user_not_found", message: "User not found." };

    if (user.isLocked) {
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}.`,
      };
    }

    // ---- Eligibility ----
    const existingSubscription = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId }
    );
    if (existingSubscription && existingSubscription.expiryDate > Date.now()) {
      return { success: false, error: "already_subscribed", message: "You already have an active subscription." };
    }

    if (user.trialUsed) {
      return { success: false, error: "trial_already_used", message: "Free trial already used on this account." };
    }

    // Cross-user device check — uses the legacy devices table which
    // is mirrored by addDevice on every device write.
    const existingDeviceById = await ctx.runQuery(
      internal.subscriptions.internal.getDeviceByDeviceId,
      { deviceId }
    );
    if (existingDeviceById && existingDeviceById.userId !== userId) {
      return {
        success: false,
        error: "device_trial_used",
        message: "This device has already been used for a free trial on another account.",
      };
    }

    // ---- Config ----
    await ctx.runMutation(internal.system.internal.ensureAppConfig, {});
    const config = await ctx.runQuery(internal.system.internal.getAppConfig, {});
    if (!config) return { success: false, error: "config_error", message: "System configuration error." };

    const trialDurationMs = (config.trialDurationHours ?? 24) * 60 * 60 * 1000;
    const startDate = Date.now();
    const expiryDate = startDate + trialDurationMs;

    // ---- Create subscription (trial = 1 device) ----
    const subscriptionId = await ctx.runMutation(
      internal.subscriptions.internal.createSubscription,
      {
        userId,
        plan: "trial",
        startDate,
        expiryDate,
        status: "active",
        updatedAt: startDate,
        maxDevices: 1,
        hasTwoDeviceDiscount: false,
      }
    );

    // ---- Register device to subscription (strict signature) ----
    await ctx.runMutation(internal.subscriptions.internal.registerDeviceToSubscription, {
      subscriptionId,
      userId,
      deviceId,
      platform: deviceInfo?.platform,
      isPrimary: true,
    });

    // ---- Persist device info blob (also updates userDeviceInfo arrays) ----
    await ctx.runMutation(internal.devices.internal.upsertDeviceInfo, {
      deviceId,
      userId,
      info: deviceInfo,
      platform: deviceInfo?.platform,
      userAgent: deviceInfo?.userAgent,
    });

    // ---- Update user flags ----
    await ctx.runMutation(internal.users.internal.updateUserById, {
      userId,
      updates: { trialUsed: true },
    });

    // ---- Register device in users.devices[] + deviceIds + legacy mirror ----
    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId,
      deviceId,
      fingerprint: deviceFingerprint,
      lastUsed: startDate,
      platform: deviceInfo?.platform,
      deviceInfo,
      maxDevices: 1,
    });

    // ---- Audit ----
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "start_free_trial",
      targetId: subscriptionId,
      details: {
        trialDurationHours: config.trialDurationHours,
        expiryDate,
        deviceId,
        deviceFingerprint,
      },
    });

    // ---- Notification ----
    await notificationTriggers.notifyTrialStarted(ctx, userId, expiryDate);

    return {
      success: true,
      data: { subscriptionId, expiryDate, plan: "trial", maxDevices: 1 },
    };
  },
});

// ============================================================
// 2. PURCHASE SUBSCRIPTION (1 or 2 devices, custom amounts)
// ============================================================
export const purchaseSubscription = action({
  args: {
    token: v.string(),
    planId: v.string(),                 // "monthly" | "quarterly" | "yearly" | "custom"
    phoneNumber: v.string(),
    deviceId: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
    deviceInfo: v.optional(v.any()),
    deviceCount: v.optional(v.number()), // 1 (default) or 2
    customAmount: v.optional(v.number()),// required if planId === "custom"
  },
  handler: async (ctx, args) => {
    // ---- Normalize device ----
    let device;
    try {
      device = normalizeDevice({
        deviceId: args.deviceId,
        deviceFingerprint: args.deviceFingerprint,
        deviceInfo: args.deviceInfo,
      });
    } catch {
      return {
        success: false,
        error: "device_id_required",
        message: "A device identifier is required.",
      };
    }
    const { deviceId, deviceFingerprint, deviceInfo } = device;

    // ---- Auth ----
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) return { success: false, error: "invalid_token", message: result.message };
      payload = result.data;
    } catch (err) {
      return { success: false, error: "token_verification_failed", message: "Failed to verify authentication token." };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId });
    if (!user) return { success: false, error: "user_not_found", message: "User not found." };

    if (user.isLocked) {
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}.`,
      };
    }

    // ---- Phone ----
    const formattedPhone = normalizePhoneNumber(args.phoneNumber);
    if (!formattedPhone) {
      return {
        success: false,
        error: "invalid_phone",
        message: "Invalid phone number. Please enter a valid Kenyan M‑Pesa number.",
      };
    }

    // ---- Config ----
    await ctx.runMutation(internal.system.internal.ensureAppConfig, {});
    const config = await ctx.runQuery(internal.system.internal.getAppConfig, {});
    if (!config) return { success: false, error: "config_error", message: "System configuration error." };

    if (config.paymentsFrozen) {
      return {
        success: false,
        error: "payments_frozen",
        message: "Payment processing is temporarily disabled. Please try again later.",
      };
    }

    // ---- Device count validation ----
    const maxDevices = config.maxDevicesPerSubscription ?? 2;
    const requestedCount = Math.max(1, Math.min(args.deviceCount ?? 1, maxDevices));
    const discountPercent = config.twoDeviceDiscountPercent ?? 15;

    // ---- Amount calculation ----
    let amount: number;
    let isCustom = false;

    if (args.planId === "custom") {
      if (!args.customAmount || args.customAmount < 50 || args.customAmount > 150000) {
        return {
          success: false,
          error: "invalid_amount",
          message: "Custom amount must be between KES 50 and 150,000.",
        };
      }
      amount = Math.round(args.customAmount);
      isCustom = true;
    } else {
      const plan = config.subscriptionPlans.find((p) => p.id === args.planId);
      if (!plan) {
        return {
          success: false,
          error: "invalid_plan",
          message: `Plan "${args.planId}" does not exist.`,
        };
      }

      let baseTotal = plan.price;

      // Apply 2-device discount ONLY for standard plans
      if (requestedCount === 2) {
        baseTotal = Math.round(plan.price * 2 * (1 - discountPercent / 100));
      }

      amount = baseTotal;
    }

    // ---- Create pending payment ----
    const transactionId = `txn_${Date.now()}_${userId}_${Math.random().toString(36).slice(2, 11)}`;
    const paymentId = await ctx.runMutation(internal.payments.internal.createPayment, {
      transactionId,
      amount,
      userId,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phoneNumber: formattedPhone,
      deviceCount: requestedCount,
      selectedPlanId: args.planId,
    });

    // ---- Initiate STK push ----
    await ctx.scheduler.runAfter(0, internal.payments.actions.initiateMpesaPayment, {
      paymentId,
      phoneNumber: formattedPhone,
      amount,
      transactionId,
      planName: args.planId,
    });

    // ---- Persist device info (also updates arrays) ----
    await ctx.runMutation(internal.devices.internal.upsertDeviceInfo, {
      deviceId,
      userId,
      info: deviceInfo,
      platform: deviceInfo?.platform,
      userAgent: deviceInfo?.userAgent,
    });

    // ---- Register device on the user (in case it's a brand-new device) ----
    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId,
      deviceId,
      fingerprint: deviceFingerprint,
      lastUsed: Date.now(),
      platform: deviceInfo?.platform,
      deviceInfo,
      maxDevices,
    });

    // ---- Audit ----
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "initiate_subscription_purchase",
      targetId: paymentId,
      details: {
        planId: args.planId,
        deviceCount: requestedCount,
        amount,
        isCustom,
        transactionId,
        phoneNumber: formattedPhone,
        deviceId,
        deviceFingerprint,
      },
    });

    return {
      success: true,
      data: {
        paymentId,
        transactionId,
        amount,
        deviceCount: requestedCount,
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
      if (!result.success) return { success: false, error: "invalid_token", message: result.message };
      payload = result.data;
    } catch (err) {
      return { success: false, error: "token_verification_failed", message: "Failed to verify authentication token." };
    }

    const userId = payload.userId;
    const subscription = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId }
    );
    if (!subscription) {
      return { success: false, error: "no_active_subscription", message: "You do not have an active subscription to cancel." };
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
// 5. CRON: SEND EXPIRY WARNINGS (7 days before expiry)
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

// ============================================================
// 6. CRON: SEND EXPIRY REMINDERS (daily)
// ============================================================
export const sendExpiryReminders = action({
  args: {},
  handler: async (ctx) => {
    const expiringSubs = await ctx.runQuery(
      internal.subscriptions.internal.getSubscriptionsExpiringSoon,
      { days: 7 }
    );

    let count = 0;
    const now = Date.now();
    for (const sub of expiringSubs) {
      const daysLeft = Math.max(1, Math.ceil((sub.expiryDate - now) / (1000 * 60 * 60 * 24)));
      await ctx.runMutation(internal.notifications.internal.insertNotification, {
        userId: sub.userId,
        type: "subscription_expiry_reminder",
        title: "Subscription Expiring Soon",
        message: messages.buildSubscriptionExpiryReminderMessage(daysLeft, sub.expiryDate),
        data: { route: "subscription" },
      });
      count++;
    }
    return { sent: count };
  },
});