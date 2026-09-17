// convex/payments/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import * as notificationTriggers from "../notifications/triggers";

// ============ HELPER: CALCULATE PREMIUM DAYS (TARIFF MATRIX) ============
function calculatePremiumDays(amount: number): number {
  const amt = Math.round(amount);
  let days = 0;

  // Standard tiers (exact match)
  if (amt === 300) return 30;
  if (amt === 850) return 90;
  if (amt === 2100) return 270;

  // Non‑standard scaling with penalty
  if (amt < 300) {
    days = amt / 11.75; // (300/30) + 1.75
  } else if (amt > 300 && amt < 850) {
    days = 30 + (amt - 300) / 11.1944; // (850/90) + 1.75
  } else if (amt > 850) {
    days = 90 + (amt - 850) / 9.5277; // (2100/270) + 1.75
  }
  return Math.floor(days); // Discard decimals to safeguard revenue
}

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
  },
  handler: async (ctx, args) => {
    console.log("[createPayment] Creating payment:", {
      transactionId: args.transactionId,
      amount: args.amount,
      userId: args.userId,
      phoneNumber: args.phoneNumber,
    });
    const paymentId = await ctx.db.insert("payments", {
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
    });
    console.log("[createPayment] Payment created with ID:", paymentId);
    return paymentId;
  },
});

export const updatePaymentStatus = internalMutation({
  args: {
    merchantRequestId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("expired")),
    receipt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("[updatePaymentStatus] Called with:", { merchantRequestId: args.merchantRequestId, status: args.status, receipt: args.receipt });
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_merchantRequestId", (q) => q.eq("merchantRequestId", args.merchantRequestId))
      .first();

    if (!payment) {
      console.warn("[updatePaymentStatus] Payment not found for merchantRequestId:", args.merchantRequestId);
      return;
    }
    console.log("[updatePaymentStatus] Found payment:", { id: payment._id, status: payment.status, userId: payment.userId, phone: payment.phoneNumber });

    if (payment.status !== "pending") {
      console.log("[updatePaymentStatus] Payment already processed (status:", payment.status, ") – ignoring duplicate.");
      return;
    }

    const updates: any = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.receipt) {
      updates.mpesaReceipt = args.receipt;
    }
    await ctx.db.patch(payment._id, updates);
    console.log("[updatePaymentStatus] Payment updated to:", updates);

    if (args.status === "completed") {
      console.log("[updatePaymentStatus] Payment completed – activating subscription for userId:", payment.userId);
      await ctx.runMutation(internal.payments.internal.activateSubscriptionFromPayment, {
        paymentId: payment._id,
        userId: payment.userId || undefined,
      });

      // 🔔 Payment success notification – handled inside activateSubscriptionFromPayment
      // We'll also send an explicit success notification here in case activation fails,
      // but the subscription activation will send one too. We'll rely on activation.
    } else if (args.status === "failed" && payment.userId) {
      // 🔔 Payment failed notification
      await notificationTriggers.notifyPaymentFailed(
        ctx,
        payment.userId,
        payment.amount,
        "subscription",
        "Payment failed"
      );
    } else {
      console.log("[updatePaymentStatus] Payment not completed (status:", args.status, ") – no activation.");
    }
  },
});

export const getPaymentByMerchantRequestId = internalQuery({
  args: { merchantRequestId: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_merchantRequestId", (q) => q.eq("merchantRequestId", args.merchantRequestId))
      .first();
    if (!payment) {
      console.warn("[getPaymentByMerchantRequestId] Payment not found for:", args.merchantRequestId);
    }
    return payment;
  },
});

export const getPaymentByTransactionId = internalQuery({
  args: { transactionId: v.string() },
  handler: async (ctx, args) => {
    console.log("[getPaymentByTransactionId] Searching for transactionId:", args.transactionId);
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", args.transactionId))
      .first();
    console.log("[getPaymentByTransactionId] Found:", payment ? payment._id : "none");
    return payment;
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
    console.log("[getPaymentHistoryByUser] Fetching history for user:", args.userId, "limit:", args.limit);
    let query = ctx.db
      .query("payments")
      .withIndex("by_userId_status", (q) => q.eq("userId", args.userId));
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const payments = await query.take(args.limit + 1);
    console.log("[getPaymentHistoryByUser] Retrieved", payments.length, "payments");
    return payments;
  },
});

export const getPendingPaymentsOlderThan = internalQuery({
  args: { minutes: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.minutes * 60 * 1000;
    console.log("[getPendingPaymentsOlderThan] Looking for pending payments older than", new Date(cutoff));
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending").lt("createdAt", cutoff))
      .collect();
    console.log("[getPendingPaymentsOlderThan] Found", payments.length, "stale payments");
    return payments;
  },
});

export const getPendingPaymentByMpesaCode = internalQuery({
  args: { mpesaCode: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_mpesaCode", (q) => q.eq("mpesaCode", args.mpesaCode))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    console.log("[getPendingPaymentByMpesaCode] Found:", payment ? payment._id : "none");
    return payment;
  },
});

export const getPendingPaymentsByPhone = internalQuery({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_phoneNumber_status", (q) => q.eq("phoneNumber", args.phoneNumber).eq("status", "pending"))
      .collect();
    console.log("[getPendingPaymentsByPhone] Found", payments.length, "pending payments for phone", args.phoneNumber);
    return payments;
  },
});

export const claimPayment = internalMutation({
  args: {
    paymentId: v.id("payments"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    console.log("[claimPayment] Claiming payment", args.paymentId, "for user", args.userId);
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) {
      console.error("[claimPayment] Payment not found");
      throw new Error("Payment not found");
    }
    if (payment.status !== "pending") {
      console.error("[claimPayment] Payment already claimed or processed. Status:", payment.status);
      throw new Error("Payment already claimed or processed");
    }

    await ctx.db.patch(args.paymentId, {
      status: "claimed",
      claimedAt: Date.now(),
      claimedByUserId: args.userId,
      userId: args.userId,
      updatedAt: Date.now(),
    });
    console.log("[claimPayment] Payment marked as claimed");

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
    console.log("[updatePaymentWithRequestIds] Updating payment", args.paymentId, "with merchantRequestId:", args.merchantRequestId);
    await ctx.db.patch(args.paymentId, {
      merchantRequestId: args.merchantRequestId,
      checkoutRequestId: args.checkoutRequestId,
      phoneNumber: args.phoneNumber,
      status: "pending",
      updatedAt: Date.now(),
    });
    console.log("[updatePaymentWithRequestIds] Update complete");
  },
});

export const setPaymentMpesaCode = internalMutation({
  args: {
    paymentId: v.id("payments"),
    mpesaCode: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[setPaymentMpesaCode] Setting mpesaCode", args.mpesaCode, "for payment", args.paymentId);
    await ctx.db.patch(args.paymentId, { mpesaCode: args.mpesaCode });
  },
});

// ============================================================
// 2. SUBSCRIPTION ACTIVATOR (with notifications and referral reward)
// ============================================================

export const activateSubscriptionFromPayment = internalMutation({
  args: {
    paymentId: v.id("payments"),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    console.log("[activateSubscription] Called for payment", args.paymentId, "with userId:", args.userId);
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) {
      console.error("[activateSubscription] Payment not found");
      throw new Error("Payment not found");
    }
    console.log("[activateSubscription] Payment details:", {
      amount: payment.amount,
      userId: payment.userId,
      phone: payment.phoneNumber,
      status: payment.status,
    });

    let userId = args.userId;
    let user = userId ? await ctx.db.get(userId) : null;

    if (!user && payment.phoneNumber) {
      const phone = payment.phoneNumber;
      console.log("[activateSubscription] No user found by ID, searching by phone:", phone);
      const foundUser = await ctx.db
        .query("users")
        .withIndex("by_phone", (q) => q.eq("phone", phone))
        .first();
      if (foundUser) {
        userId = foundUser._id;
        user = foundUser;
        console.log("[activateSubscription] Found user by phone:", userId);
        await ctx.db.patch(args.paymentId, { userId });
        console.log("[activateSubscription] Updated payment with userId:", userId);
      } else {
        console.error("[activateSubscription] No user found for phone:", phone);
      }
    }

    if (!user) {
      console.error("[activateSubscription] No user found for payment", args.paymentId);
      throw new Error("User not found for payment activation");
    }

    console.log("[activateSubscription] Activating for user:", user._id, "phone:", user.phone);

    const daysAwarded = calculatePremiumDays(payment.amount);
    if (daysAwarded <= 0) {
      console.error("[activateSubscription] Insufficient payment amount:", payment.amount);
      throw new Error("Insufficient payment amount");
    }
    console.log("[activateSubscription] Days awarded:", daysAwarded);

    let baseDate = Date.now();
    const existingSub = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    let changeType: "new" | "extended" | "upgraded" | "downgraded" = "new";
    if (existingSub && existingSub.expiryDate > baseDate) {
      baseDate = existingSub.expiryDate;
      changeType = "extended";
      console.log("[activateSubscription] Existing subscription found, extending from:", new Date(baseDate));
    }
    const newExpiry = baseDate + daysAwarded * 24 * 60 * 60 * 1000;
    console.log("[activateSubscription] New expiry:", new Date(newExpiry));

    let planName = "custom";
    if (payment.amount === 300) planName = "monthly";
    else if (payment.amount === 850) planName = "quarterly";
    else if (payment.amount === 2100) planName = "yearly";
    console.log("[activateSubscription] Plan name:", planName);

    if (existingSub) {
      await ctx.db.patch(existingSub._id, {
        expiryDate: newExpiry,
        status: "active",
        plan: planName,
        updatedAt: Date.now(),
      });
      console.log("[activateSubscription] Updated existing subscription:", existingSub._id);
    } else {
      const newSubId = await ctx.db.insert("subscriptions", {
        userId: user._id,
        plan: planName,
        startDate: Date.now(),
        expiryDate: newExpiry,
        status: "active",
      });
      console.log("[activateSubscription] Created new subscription:", newSubId);
      changeType = "new";
    }

    // 🔔 Payment success notification (with plan details)
    await notificationTriggers.notifyPaymentSuccess(
      ctx,
      user._id,
      payment.amount,
      planName,
      payment.mpesaReceipt || "N/A"
    );

    // 🔔 Subscription updated notification
    await notificationTriggers.notifySubscriptionUpdated(
      ctx,
      user._id,
      planName,
      newExpiry,
      changeType,
      daysAwarded
    );

    // ============ REFERRAL REWARD (proportional to days awarded) ============
    if (user.referredBy && !user.referralRewarded) {
      const referrer = await ctx.db.get(user.referredBy);
      if (referrer) {
        // Calculate reward rate per day:
        // Normal user: 1 KES per day (30 days = 30 KES)
        // Agent: 4/3 KES per day (30 days = 40 KES)
        const isAgent = referrer.isAgent === true;
        const ratePerDay = isAgent ? 4 / 3 : 1; // 4/3 ≈ 1.333
        const rawReward = daysAwarded * ratePerDay;
        const rewardAmount = Math.round(rawReward);
        // Ensure minimum reward of 1 KES if days > 0
        const finalReward = Math.max(1, rewardAmount);
        console.log(`[activateSubscription] Giving referral reward of ${finalReward} KES to ${referrer._id} for ${daysAwarded} days (rate: ${ratePerDay.toFixed(2)})`);
        await ctx.runMutation(internal.users.internal.creditReferralReward, {
          referrerId: referrer._id,
          referredUserId: user._id,
          amount: finalReward,
        });

        // 🔔 Notify referrer about reward
        await notificationTriggers.notifyReferralReward(
          ctx,
          referrer._id,
          finalReward,
          user.displayName || user.name
        );
      } else {
        console.log("[activateSubscription] Referrer not found, skipping reward");
      }
    } else {
      console.log("[activateSubscription] No referral reward applicable");
    }

    // Audit log
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "payment_activated_subscription",
      targetId: payment._id,
      details: { amount: payment.amount, daysAwarded, newExpiry, plan: planName },
    });

    console.log("[activateSubscription] Subscription activation complete for user:", user._id);
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
      const newBalance = wallet.balance + args.amount;
      const newTotal = wallet.totalEarned + args.amount;
      await ctx.db.patch(wallet._id, {
        balance: newBalance,
        totalEarned: newTotal,
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
    if (!wallet) {
      throw new Error("Wallet not found for user");
    }
    if (wallet.balance < args.amount) {
      throw new Error("Insufficient wallet balance");
    }
    const newBalance = wallet.balance - args.amount;
    await ctx.db.patch(wallet._id, {
      balance: newBalance,
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
// 10. INTERNAL HELPERS FOR CRON VERIFICATION JOBS & REVERSALS
// ============================================================

/**
 * Get pending STK payments that have merchantRequestId and checkoutRequestId,
 * and are older than the given number of minutes.
 */
export const getPendingStkPaymentsToVerify = internalQuery({
  args: { minutes: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.minutes * 60 * 1000;
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending").lt("createdAt", cutoff))
      .collect();
    // Only return those with both merchantRequestId and checkoutRequestId
    return payments.filter((p) => p.merchantRequestId && p.checkoutRequestId);
  },
});

/**
 * Get B2C transactions with status 'processing' that are older than the given minutes.
 */
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

/**
 * Get balance queries with status 'pending' that are older than the given minutes.
 */
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

/**
 * Get status queries with status 'pending' that are older than the given minutes.
 */
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

/**
 * Get reversals with status 'processing' that are older than the given minutes.
 */
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

/**
 * Get all reversals for a given payment ID.
 */
export const getReversalsByPaymentId = internalQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reversals")
      .withIndex("by_paymentId", (q) => q.eq("paymentId", args.paymentId))
      .collect();
  },
});

/**
 * Update payment status by ID.
 */
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