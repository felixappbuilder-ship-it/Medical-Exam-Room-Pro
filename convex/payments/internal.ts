// convex/payments/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import * as notificationTriggers from "../notifications/triggers";

// ============================================================
// HELPER: CONFIG-DRIVEN TARIFF CALCULATOR
// ------------------------------------------------------------
// Standard plans come from appConfig.subscriptionPlans (admin-editable).
// Custom amounts reference the CURRENT standard amounts + penalty.
// Two-device purchases are detected via `selectedPlanId` + `deviceCount`
// and use the plan's `days` directly (discount is per-device, not extra days).
// ============================================================
function calculatePremiumDaysFromConfig(
  amount: number,
  plans: Array<{ id: string; price: number; days: number }>,
  penaltyPerDay: number,
  selectedPlanId?: string,
  deviceCount?: number
): { days: number; matchedPlanId: string | null } {
  const amt = Math.round(amount);

  // Priority 1: Explicit plan selection
  if (selectedPlanId && selectedPlanId !== "custom") {
    const explicitPlan = plans.find((p) => p.id === selectedPlanId);
    if (explicitPlan) {
      return { days: explicitPlan.days, matchedPlanId: explicitPlan.id };
    }
  }

  // Priority 2: Amount-based matching (custom amounts)
  const monthly = plans.find((p) => p.id === "monthly");
  const quarterly = plans.find((p) => p.id === "quarterly");
  const yearly = plans.find((p) => p.id === "yearly");

  if (!monthly || !quarterly || !yearly) {
    return { days: 0, matchedPlanId: null };
  }

  if (amt === monthly.price) return { days: monthly.days, matchedPlanId: "monthly" };
  if (amt === quarterly.price) return { days: quarterly.days, matchedPlanId: "quarterly" };
  if (amt === yearly.price) return { days: yearly.days, matchedPlanId: "yearly" };

  const monthlyRate = monthly.price / monthly.days;
  const quarterlyRate = quarterly.price / quarterly.days;
  const yearlyRate = yearly.price / yearly.days;

  let days = 0;
  if (amt < monthly.price) {
    days = amt / (monthlyRate + penaltyPerDay);
  } else if (amt > monthly.price && amt < quarterly.price) {
    days = monthly.days + (amt - monthly.price) / (quarterlyRate + penaltyPerDay);
  } else if (amt > quarterly.price && amt < yearly.price) {
    days = quarterly.days + (amt - quarterly.price) / (yearlyRate + penaltyPerDay);
  } else if (amt >= yearly.price) {
    days = yearly.days + (amt - yearly.price) / (yearlyRate + penaltyPerDay);
  }

  return { days: Math.floor(days), matchedPlanId: null };
}

// Legacy export kept for backward compatibility with older code paths
export function calculatePremiumDays(amount: number): number {
  const amt = Math.round(amount);
  if (amt === 300) return 30;
  if (amt === 850) return 90;
  if (amt === 2100) return 270;
  if (amt < 300) return Math.floor(amt / 11.75);
  if (amt > 300 && amt < 850) return Math.floor(30 + (amt - 300) / 11.1944);
  if (amt > 850) return Math.floor(90 + (amt - 850) / 9.5277);
  return 0;
}

// ============================================================
// REFERRAL REWARD RATES — single source of truth
// ------------------------------------------------------------
//   • Agent referrer → 13.33 % on first subscription of referred user
//                    → 5.00 % on every renewal (forever)
//   • Normal user    → 10.00 % once on the first subscription only
//                    → 0 % on every renewal
//
// "First subscription" = the referred user has no prior completed
// payments (excluding the current one). Trials never generate a
// payment row, so they don't interfere.
// ============================================================
const REFERRAL_RATES = {
  AGENT_FIRST: 0.1333,
  AGENT_RENEWAL: 0.05,
  USER_FIRST: 0.1,
};

// ============================================================
// 1. PAYMENT CRUD
// ============================================================

export const createPayment = internalMutation({
  args: {
    transactionId: v.string(),
    amount: v.number(),
    userId: v.optional(v.id("users")),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("expired"),
      v.literal("claimed")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    merchantRequestId: v.optional(v.string()),
    mpesaReceipt: v.optional(v.string()),
    mpesaCode: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    checkoutRequestId: v.optional(v.string()),
    deviceCount: v.optional(v.number()),
    selectedPlanId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("payments", {
      transactionId: args.transactionId,
      amount: args.amount,
      userId: args.userId,
      status: args.status,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
      merchantRequestId: args.merchantRequestId,
      mpesaReceipt: args.mpesaReceipt,
      mpesaCode: args.mpesaCode,
      phoneNumber: args.phoneNumber,
      checkoutRequestId: args.checkoutRequestId,
      deviceCount: args.deviceCount,
      selectedPlanId: args.selectedPlanId,
    });
  },
});

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
    if (payment.status !== "pending") return; // idempotent

    const updates: any = { status: args.status, updatedAt: Date.now() };
    if (args.receipt) updates.mpesaReceipt = args.receipt;
    await ctx.db.patch(payment._id, updates);

    if (args.status === "completed") {
      await ctx.runMutation(internal.payments.internal.activateSubscriptionFromPayment, {
        paymentId: payment._id,
        userId: payment.userId || undefined,
      });
    } else if (args.status === "failed" && payment.userId) {
      await notificationTriggers.notifyPaymentFailed(
        ctx,
        payment.userId,
        payment.amount,
        payment.selectedPlanId || "subscription",
        "Payment failed"
      );
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

export const getPaymentByTransactionId = internalQuery({
  args: { transactionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", args.transactionId))
      .first();
  },
});

export const getPaymentById = internalQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.paymentId);
  },
});

export const getPaymentHistoryByUser = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.number(),
    cursor: v.optional(v.id("payments")),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("payments")
      .withIndex("by_userId_status", (q) => q.eq("userId", args.userId));
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    return await query.take(args.limit + 1);
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

export const getPendingPaymentByMpesaCode = internalQuery({
  args: { mpesaCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_mpesaCode", (q) => q.eq("mpesaCode", args.mpesaCode))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
  },
});

export const getPendingPaymentsByPhone = internalQuery({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_phoneNumber_status", (q) => q.eq("phoneNumber", args.phoneNumber).eq("status", "pending"))
      .collect();
  },
});

export const claimPayment = internalMutation({
  args: {
    paymentId: v.id("payments"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "pending") throw new Error("Payment already claimed or processed");

    await ctx.db.patch(args.paymentId, {
      status: "claimed",
      claimedAt: Date.now(),
      claimedByUserId: args.userId,
      userId: args.userId,
      updatedAt: Date.now(),
    });

    await ctx.runMutation(internal.payments.internal.activateSubscriptionFromPayment, {
      paymentId: args.paymentId,
      userId: args.userId,
    });

    return { success: true };
  },
});

export const updatePaymentWithRequestIds = internalMutation({
  args: {
    paymentId: v.id("payments"),
    merchantRequestId: v.string(),
    checkoutRequestId: v.string(),
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, {
      merchantRequestId: args.merchantRequestId,
      checkoutRequestId: args.checkoutRequestId,
      phoneNumber: args.phoneNumber,
      status: "pending",
      updatedAt: Date.now(),
    });
  },
});

export const setPaymentMpesaCode = internalMutation({
  args: {
    paymentId: v.id("payments"),
    mpesaCode: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, { mpesaCode: args.mpesaCode });
  },
});

// ============================================================
// 2. SUBSCRIPTION ACTIVATOR
// ------------------------------------------------------------
// Uses config-driven tariff, handles multi-device registration,
// referral rewards (v2 rates), notifications, and audit logging.
//
// Device registration:
//   • Reads deviceIds (new per-user array) as the source of truth.
//   • Falls back to users.devices[] (bridge mirror) if empty.
//   • Falls back to legacy devices table if still empty.
//   • Registers up to `deviceCount` devices:
//       - deviceCount = 1 → register the most-recent device
//       - deviceCount = 2 → register the 2 most-recent devices
//
// Referral reward (v2):
//   • Agent referrer   → 13.33 % on first, 5 % on every renewal
//   • Normal referrer  → 10 % once on first subscription only
//   • Paid from the payment amount, NOT from daysAwarded
// ============================================================
export const activateSubscriptionFromPayment = internalMutation({
  args: {
    paymentId: v.id("payments"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new Error("Payment not found");

    // ---- Resolve user ----
    let userId = args.userId;
    let user = userId ? await ctx.db.get(userId) : null;

    if (!user && payment.phoneNumber) {
      const phone = payment.phoneNumber;
      const foundUser = await ctx.db
        .query("users")
        .withIndex("by_phone", (q) => q.eq("phone", phone))
        .first();
      if (foundUser) {
        userId = foundUser._id;
        user = foundUser;
        await ctx.db.patch(args.paymentId, { userId });
      }
    }

    if (!user) throw new Error("User not found for payment activation");

    // ---- Load config ----
    const config = await ctx.db.query("appConfig").first();
    if (!config) throw new Error("AppConfig missing");

    const plans = config.subscriptionPlans.map((p) => ({
      id: p.id,
      price: p.price,
      days: p.days,
    }));
    const penaltyPerDay = config.customPenaltyPerDay ?? 1.75;

    // ---- Calculate days (config-driven) ----
    const { days: daysAwarded, matchedPlanId } = calculatePremiumDaysFromConfig(
      payment.amount,
      plans,
      penaltyPerDay,
      payment.selectedPlanId,
      payment.deviceCount
    );

    if (daysAwarded <= 0) throw new Error("Insufficient payment amount");

    // ---- Stack on existing expiry ----
    let baseDate = Date.now();
    const existingSub = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    let changeType: "new" | "extended" | "upgraded" | "downgraded" = "new";
    if (existingSub && existingSub.expiryDate > baseDate) {
      baseDate = existingSub.expiryDate;
      changeType = "extended";
    }
    const newExpiry = baseDate + daysAwarded * 24 * 60 * 60 * 1000;

    // ---- Determine plan name ----
    let planName = "custom";
    if (matchedPlanId) planName = matchedPlanId;

    // ---- Device entitlement from this payment ----
    const deviceCount = payment.deviceCount ?? 1;
    const discountApplied = deviceCount === 2;

    // ---- Update or create subscription ----
    let subscriptionId: any;
    if (existingSub) {
      await ctx.db.patch(existingSub._id, {
        expiryDate: newExpiry,
        status: "active",
        plan: planName,
        updatedAt: Date.now(),
        maxDevices: Math.max(existingSub.maxDevices ?? 1, deviceCount),
        hasTwoDeviceDiscount: existingSub.hasTwoDeviceDiscount || discountApplied,
      });
      subscriptionId = existingSub._id;
    } else {
      subscriptionId = await ctx.db.insert("subscriptions", {
        userId: user._id,
        plan: planName,
        startDate: Date.now(),
        expiryDate: newExpiry,
        status: "active",
        updatedAt: Date.now(),
        maxDevices: deviceCount,
        hasTwoDeviceDiscount: discountApplied,
      });
    }

    // ============================================================
    // REGISTER DEVICES TO SUBSCRIPTION
    // ============================================================
    const devicesToRegister: Array<{
      deviceId: string;
      deviceInfo: any;
      platform?: string;
    }> = [];

    // Source A: new per-user arrays
    const idRow = await ctx.db
      .query("deviceIds")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    const infoRow = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    if (idRow && idRow.ids.length > 0) {
      for (let i = idRow.ids.length - 1; i >= 0; i--) {
        const deviceId = idRow.ids[i];
        const info = infoRow?.infos?.[i] ?? {};
        devicesToRegister.push({
          deviceId,
          deviceInfo: info,
          platform: info?.platform,
        });
      }
    }

    // Source B: users.devices[] (bridge mirror)
    if (devicesToRegister.length === 0 && (user.devices || []).length > 0) {
      const sortedDevices = [...(user.devices || [])].sort(
        (a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0)
      );
      for (const d of sortedDevices) {
        const deviceId = (d as any).deviceId || d.fingerprint;
        if (!deviceId) continue;
        devicesToRegister.push({
          deviceId,
          deviceInfo: { platform: d.platform || "unknown" },
          platform: d.platform,
        });
      }
    }

    // Source C: legacy devices table
    if (devicesToRegister.length === 0) {
      const legacyRows = await ctx.db
        .query("devices")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();
      const sorted = legacyRows.sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
      for (const r of sorted) {
        const deviceId = r.deviceId || r.fingerprint;
        if (!deviceId) continue;
        devicesToRegister.push({
          deviceId,
          deviceInfo: { platform: r.platform || "unknown" },
          platform: r.platform,
        });
      }
    }

    let registeredCount = 0;
    for (let i = 0; i < devicesToRegister.length && i < deviceCount; i++) {
      const d = devicesToRegister[i];
      try {
        await ctx.runMutation(
          internal.subscriptions.internal.registerDeviceToSubscription,
          {
            subscriptionId,
            userId: user._id,
            deviceId: d.deviceId,
            platform: d.platform,
            isPrimary: i === 0,
          }
        );
        registeredCount++;
      } catch (err) {
        console.warn("[activateSubscriptionFromPayment] device register failed", err);
      }
    }

    // ---- Notifications ----
    await notificationTriggers.notifyPaymentSuccess(
      ctx,
      user._id,
      payment.amount,
      planName,
      payment.mpesaReceipt || "N/A"
    );

    await notificationTriggers.notifySubscriptionUpdated(
      ctx,
      user._id,
      planName,
      newExpiry,
      changeType,
      daysAwarded
    );

    // ============================================================
    // REFERRAL REWARD — v2
    // ------------------------------------------------------------
    // Determine whether this is the referred user's first
    // paid subscription or a renewal. "First" means the user has
    // no OTHER completed payments (excluding the current one).
    //
    // We count completed payments because `updatePaymentStatus`
    // already flipped the current payment to "completed" before
    // calling this mutation.
    //
    // Agent referrer:    first = 13.33 %   renewal = 5 % (forever)
    // Normal referrer:   first = 10 %      renewal = 0 % (never)
    // ============================================================
    if (user.referredBy) {
      const referrer = await ctx.db.get(user.referredBy);

      if (referrer) {
        // ---- Is this the user's first paid subscription? ----
        const completedPayments = await ctx.db
          .query("payments")
          .withIndex("by_userId_status", (q) =>
            q.eq("userId", user._id).eq("status", "completed")
          )
          .collect();

        const priorCompleted = completedPayments.filter(
          (p) => p._id !== payment._id
        );
        const isFirstSubscription = priorCompleted.length === 0;

        const isAgent = referrer.isAgent === true;

        let rate = 0;
        let rewardKind: "agent_first" | "agent_renewal" | "user_first" | null = null;

        if (isAgent) {
          if (isFirstSubscription) {
            rate = REFERRAL_RATES.AGENT_FIRST;
            rewardKind = "agent_first";
          } else {
            rate = REFERRAL_RATES.AGENT_RENEWAL;
            rewardKind = "agent_renewal";
          }
        } else {
          // Normal user: reward only on first subscription, and only once
          // (referralRewarded guards against replayed callbacks).
          if (isFirstSubscription && !user.referralRewarded) {
            rate = REFERRAL_RATES.USER_FIRST;
            rewardKind = "user_first";
          }
        }

        if (rewardKind && rate > 0) {
          const rawReward = payment.amount * rate;
          const rewardAmount = Math.max(1, Math.round(rawReward));

          await ctx.runMutation(internal.users.internal.creditReferralReward, {
            referrerId: referrer._id,
            referredUserId: user._id,
            amount: rewardAmount,
          });

          await notificationTriggers.notifyReferralReward(
            ctx,
            referrer._id,
            rewardAmount,
            user.displayName || user.name
          );

          await ctx.runMutation(internal.auth.internal.logAuditEvent, {
            actorId: referrer._id,
            action: "referral_reward_credited",
            targetId: user._id,
            details: {
              kind: rewardKind,
              rate,
              rewardAmount,
              paymentAmount: payment.amount,
              isFirstSubscription,
              paymentId: payment._id,
              referrerIsAgent: isAgent,
            },
          });
        }
      }
    }

    // ---- Audit log ----
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "payment_activated_subscription",
      targetId: payment._id,
      details: {
        amount: payment.amount,
        daysAwarded,
        newExpiry,
        plan: planName,
        deviceCount,
        discountApplied,
        registeredDevices: registeredCount,
        availableDevices: devicesToRegister.length,
      },
    });
  },
});

// ============================================================
// 3. PAYMENT EVENTS (audit trail)
// ============================================================

export const insertPaymentEvent = internalMutation({
  args: {
    paymentId: v.optional(v.id("payments")),
    source: v.string(),
    eventType: v.string(),
    payload: v.any(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("paymentEvents", args);
  },
});

// ============================================================
// 4. B2C TRANSACTIONS
// ============================================================

export const createB2CTransaction = internalMutation({
  args: {
    userId: v.id("users"),
    originatorConversationID: v.string(),
    amount: v.number(),
    phoneNumber: v.string(),
    requestPayload: v.any(),
    status: v.union(v.literal("pending"), v.literal("processing"), v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("b2cTransactions", {
      userId: args.userId,
      transactionId: `B2C_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      originatorConversationID: args.originatorConversationID,
      amount: args.amount,
      phoneNumber: args.phoneNumber,
      requestPayload: args.requestPayload,
      status: args.status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const updateB2CTransaction = internalMutation({
  args: {
    id: v.id("b2cTransactions"),
    status: v.union(v.literal("pending"), v.literal("processing"), v.literal("completed"), v.literal("failed")),
    conversationID: v.optional(v.string()),
    responsePayload: v.optional(v.any()),
    resultPayload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const updates: any = { status: args.status, updatedAt: Date.now() };
    if (args.conversationID !== undefined) updates.conversationID = args.conversationID;
    if (args.responsePayload !== undefined) updates.responsePayload = args.responsePayload;
    if (args.resultPayload !== undefined) updates.resultPayload = args.resultPayload;
    await ctx.db.patch(args.id, updates);
  },
});

export const getB2CByOriginatorConversationID = internalQuery({
  args: { originatorConversationID: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("b2cTransactions")
      .withIndex("by_originatorConversationID", (q) => q.eq("originatorConversationID", args.originatorConversationID))
      .first();
  },
});

// ============================================================
// 5. BALANCE QUERIES
// ============================================================

export const createBalanceQuery = internalMutation({
  args: {
    userId: v.id("users"),
    originatorConversationID: v.string(),
    shortcode: v.string(),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("balanceQueries", {
      userId: args.userId,
      originatorConversationID: args.originatorConversationID,
      shortcode: args.shortcode,
      status: args.status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: undefined,
      conversationID: undefined,
    });
  },
});

export const updateBalanceQuery = internalMutation({
  args: {
    id: v.id("balanceQueries"),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    conversationID: v.optional(v.string()),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const updates: any = { status: args.status, updatedAt: Date.now() };
    if (args.conversationID !== undefined) updates.conversationID = args.conversationID;
    if (args.result !== undefined) updates.result = args.result;
    await ctx.db.patch(args.id, updates);
  },
});

export const getBalanceByOriginatorConversationID = internalQuery({
  args: { originatorConversationID: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("balanceQueries")
      .withIndex("by_originatorConversationID", (q) => q.eq("originatorConversationID", args.originatorConversationID))
      .first();
  },
});

// ============================================================
// 6. TRANSACTION STATUS QUERIES
// ============================================================

export const createStatusQuery = internalMutation({
  args: {
    userId: v.id("users"),
    originatorConversationID: v.string(),
    transactionID: v.optional(v.string()),
    partyA: v.string(),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("statusQueries", {
      userId: args.userId,
      originatorConversationID: args.originatorConversationID,
      transactionID: args.transactionID,
      partyA: args.partyA,
      status: args.status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      result: undefined,
      conversationID: undefined,
    });
  },
});

export const updateStatusQuery = internalMutation({
  args: {
    id: v.id("statusQueries"),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    conversationID: v.optional(v.string()),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const updates: any = { status: args.status, updatedAt: Date.now() };
    if (args.conversationID !== undefined) updates.conversationID = args.conversationID;
    if (args.result !== undefined) updates.result = args.result;
    await ctx.db.patch(args.id, updates);
  },
});

export const getStatusByOriginatorConversationID = internalQuery({
  args: { originatorConversationID: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("statusQueries")
      .withIndex("by_originatorConversationID", (q) => q.eq("originatorConversationID", args.originatorConversationID))
      .first();
  },
});

// ============================================================
// 7. REVERSALS
// ============================================================

export const createReversal = internalMutation({
  args: {
    paymentId: v.id("payments"),
    userId: v.id("users"),
    originatorConversationID: v.string(),
    transactionID: v.string(),
    amount: v.number(),
    reason: v.string(),
    status: v.union(v.literal("requested"), v.literal("processing"), v.literal("completed"), v.literal("failed")),
    requestPayload: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("reversals", {
      paymentId: args.paymentId,
      userId: args.userId,
      originatorConversationID: args.originatorConversationID,
      transactionID: args.transactionID,
      amount: args.amount,
      reason: args.reason,
      status: args.status,
      requestPayload: args.requestPayload,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      conversationID: undefined,
      responsePayload: undefined,
      resultPayload: undefined,
    });
  },
});

export const updateReversal = internalMutation({
  args: {
    id: v.id("reversals"),
    status: v.union(v.literal("requested"), v.literal("processing"), v.literal("completed"), v.literal("failed")),
    conversationID: v.optional(v.string()),
    responsePayload: v.optional(v.any()),
    resultPayload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const updates: any = { status: args.status, updatedAt: Date.now() };
    if (args.conversationID !== undefined) updates.conversationID = args.conversationID;
    if (args.responsePayload !== undefined) updates.responsePayload = args.responsePayload;
    if (args.resultPayload !== undefined) updates.resultPayload = args.resultPayload;
    await ctx.db.patch(args.id, updates);
  },
});

export const getReversalByOriginatorConversationID = internalQuery({
  args: { originatorConversationID: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reversals")
      .withIndex("by_originatorConversationID", (q) => q.eq("originatorConversationID", args.originatorConversationID))
      .first();
  },
});

export const getReversalsByPaymentId = internalQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reversals")
      .withIndex("by_paymentId", (q) => q.eq("paymentId", args.paymentId))
      .collect();
  },
});

// ============================================================
// 8. WEBHOOK LOGS
// ============================================================

export const insertWebhookLog = internalMutation({
  args: {
    source: v.string(),
    payload: v.any(),
    headers: v.any(),
    response: v.optional(v.any()),
    status: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("webhookLogs", args);
  },
});

// ============================================================
// 9. WALLET HELPERS (credits/debits)
// ============================================================

export const creditWallet = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    source: v.string(),
    reference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!wallet) {
      const walletId = await ctx.db.insert("wallets", {
        userId: args.userId,
        balance: args.amount,
        totalEarned: args.amount,
        pendingBalance: 0,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("walletTransactions", {
        walletId,
        userId: args.userId,
        type: "credit",
        amount: args.amount,
        source: args.source,
        reference: args.reference,
        createdAt: Date.now(),
      });
    } else {
      await ctx.db.patch(wallet._id, {
        balance: wallet.balance + args.amount,
        totalEarned: wallet.totalEarned + args.amount,
        updatedAt: Date.now(),
      });
      await ctx.db.insert("walletTransactions", {
        walletId: wallet._id,
        userId: args.userId,
        type: "credit",
        amount: args.amount,
        source: args.source,
        reference: args.reference,
        createdAt: Date.now(),
      });
    }
  },
});

export const debitWallet = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    source: v.string(),
    reference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!wallet) throw new Error("Wallet not found for user");
    if (wallet.balance < args.amount) throw new Error("Insufficient wallet balance");

    await ctx.db.patch(wallet._id, {
      balance: wallet.balance - args.amount,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("walletTransactions", {
      walletId: wallet._id,
      userId: args.userId,
      type: "debit",
      amount: args.amount,
      source: args.source,
      reference: args.reference,
      createdAt: Date.now(),
    });
  },
});

// ============================================================
// 10. CRON / VERIFICATION HELPERS
// ============================================================

export const getPendingStkPaymentsToVerify = internalQuery({
  args: { minutes: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.minutes * 60 * 1000;
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending").lt("createdAt", cutoff))
      .collect();
    return payments.filter((p) => p.merchantRequestId && p.checkoutRequestId);
  },
});

export const getStaleProcessingB2C = internalQuery({
  args: { minutes: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.minutes * 60 * 1000;
    return await ctx.db
      .query("b2cTransactions")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "processing").lt("updatedAt", cutoff))
      .collect();
  },
});

export const getStalePendingBalanceQueries = internalQuery({
  args: { minutes: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.minutes * 60 * 1000;
    return await ctx.db
      .query("balanceQueries")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "pending").lt("updatedAt", cutoff))
      .collect();
  },
});

export const getStalePendingStatusQueries = internalQuery({
  args: { minutes: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.minutes * 60 * 1000;
    return await ctx.db
      .query("statusQueries")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "pending").lt("updatedAt", cutoff))
      .collect();
  },
});

export const getStaleProcessingReversals = internalQuery({
  args: { minutes: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.minutes * 60 * 1000;
    return await ctx.db
      .query("reversals")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "processing").lt("updatedAt", cutoff))
      .collect();
  },
});

export const updatePaymentStatusById = internalMutation({
  args: {
    paymentId: v.id("payments"),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("expired"),
      v.literal("claimed"),
      v.literal("reversed")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, { status: args.status, updatedAt: Date.now() });
  },
});