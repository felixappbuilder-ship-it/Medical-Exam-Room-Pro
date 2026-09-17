// convex/admin/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// 1. USER HELPERS
// ============================================================

export const getAllUsersPaginated = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("users");
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const users = await query.take(args.limit + 1);
    const hasMore = users.length > args.limit;
    const items = users.slice(0, args.limit);
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    const safeUsers = items.map((u) => {
      const { passwordHash, securityQuestions, ...safe } = u;
      return safe;
    });
    return { users: safeUsers, nextCursor, hasMore };
  },
});

export const getAllUsersNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.map((u) => {
      const { passwordHash, securityQuestions, ...safe } = u;
      return safe;
    });
  },
});

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    const { passwordHash, securityQuestions, ...safe } = user;
    return safe;
  },
});

export const updateUserById = internalMutation({
  args: {
    userId: v.id("users"),
    updates: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      isLocked: v.optional(v.boolean()),
      lockReason: v.optional(v.string()),
      trialUsed: v.optional(v.boolean()),
      isAgent: v.optional(v.boolean()),
      agentVerified: v.optional(v.boolean()),
      role: v.optional(v.string()),
      tokenVersion: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, args.updates);
  },
});

export const deleteUserById = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.userId);
  },
});

export const lockUser = internalMutation({
  args: { userId: v.id("users"), reason: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { isLocked: true, lockReason: args.reason });
  },
});

// ============================================================
// 2. PAYMENT HELPERS
// ============================================================

export const getRevenueData = internalQuery({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "completed"))
      .collect();
    const filtered = payments.filter(
      (p) => p.createdAt >= args.startDate && p.createdAt <= args.endDate && p.status === "completed"
    );
    const total = filtered.reduce((sum, p) => sum + p.amount, 0);
    const count = filtered.length;
    return { total, count, payments: filtered };
  },
});

export const getAllPayments = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.id("payments")) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("payments").order("desc");
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const items = await query.take(args.limit + 1);
    const hasMore = items.length > args.limit;
    const results = items.slice(0, args.limit);
    const nextCursor = hasMore ? results[results.length - 1]._id : null;
    const enriched = await Promise.all(
      results.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        return {
          ...p,
          user: user ? { _id: user._id, name: user.name, email: user.email } : null,
        };
      })
    );
    return { payments: enriched, nextCursor, hasMore };
  },
});

export const getAllPaymentsPaginated = getAllPayments; // alias for compatibility

export const getAllPaymentsNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("payments").collect();
  },
});

export const getPaymentById = internalQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.paymentId);
  },
});

export const updatePaymentInternal = internalMutation({
  args: {
    paymentId: v.id("payments"),
    updates: v.object({
      status: v.optional(v.string()),
      mpesaReceipt: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, args.updates);
  },
});

// ============================================================
// 3. SUBSCRIPTION HELPERS
// ============================================================

export const getAllSubscriptionsPaginated = internalQuery({
  args: {
    limit: v.number(),
    cursor: v.optional(v.id("subscriptions")),
    filter: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query("subscriptions");
    if (args.filter) {
      if (args.filter.plan) {
        query = query.filter((q) => q.eq(q.field("plan"), args.filter.plan));
      }
      if (args.filter.status) {
        query = query.filter((q) => q.eq(q.field("status"), args.filter.status));
      }
    }
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const items = await query.take(args.limit + 1);
    const hasMore = items.length > args.limit;
    const results = items.slice(0, args.limit);
    const nextCursor = hasMore ? results[results.length - 1]._id : null;
    const enriched = await Promise.all(
      results.map(async (sub) => {
        const user = await ctx.db.get(sub.userId);
        return {
          ...sub,
          user: user ? { _id: user._id, name: user.name, email: user.email } : null,
        };
      })
    );
    return { subscriptions: enriched, nextCursor, hasMore };
  },
});

export const getAllSubscriptionsNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("subscriptions").collect();
  },
});

export const updateSubscriptionInternal = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    updates: v.object({
      plan: v.optional(v.string()),
      expiryDate: v.optional(v.number()),
      status: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, args.updates);
  },
});

export const deleteSubscriptionInternal = internalMutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.subscriptionId);
  },
});

// ============================================================
// 4. EXAM RESULTS HELPERS
// ============================================================

export const getAllExamResultsNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("examResults").collect();
  },
});

// ============================================================
// 5. NOTES HELPERS
// ============================================================

export const getAllNotesNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("notes").collect();
  },
});

// ============================================================
// 6. SECURITY & AUDIT LOGS
// ============================================================

export const getSecurityLogs = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;
    return await ctx.db.query("securityEvents").order("desc").take(limit);
  },
});

export const getAllSecurityEventsNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("securityEvents").collect();
  },
});

export const getAuditLogs = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 100;
    return await ctx.db.query("auditLogs").order("desc").take(limit);
  },
});

export const getAllAuditLogsNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  },
});

// ============================================================
// 7. APP CONFIG
// ============================================================

export const getAppConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("appConfig").first();
  },
});

export const updateAppConfig = internalMutation({
  args: {
    updates: v.object({
      trialDurationHours: v.optional(v.number()),
      maintenanceMode: v.optional(v.boolean()),
      subscriptionPlans: v.optional(
        v.array(v.object({ name: v.string(), price: v.number(), days: v.number() }))
      ),
      paymentsFrozen: v.optional(v.boolean()),
      maxRequestsPerMinute: v.optional(v.number()),
      autoApproveWithdrawals: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db.query("appConfig").first();
    if (!config) {
      await ctx.db.insert("appConfig", {
        _id: "config",
        trialDurationHours: args.updates.trialDurationHours ?? 3,
        maintenanceMode: args.updates.maintenanceMode ?? false,
        subscriptionPlans: args.updates.subscriptionPlans ?? [],
        paymentsFrozen: args.updates.paymentsFrozen ?? false,
        maxRequestsPerMinute: args.updates.maxRequestsPerMinute ?? 60,
        autoApproveWithdrawals: args.updates.autoApproveWithdrawals ?? false,
      });
    } else {
      await ctx.db.patch(config._id, args.updates);
    }
  },
});

// ============================================================
// 8. AUDIT LOG ENTRY (R16, R23)
// ============================================================

export const logAuditEntry = internalMutation({
  args: {
    actorId: v.string(),
    action: v.string(),
    targetId: v.optional(v.string()),
    details: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      actorId: args.actorId,
      action: args.action,
      targetId: args.targetId,
      timestamp: Date.now(),
      details: args.details,
    });
  },
});

// ============================================================
// 9. COUNTS
// ============================================================

export const getActiveSubscriptionsCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const subscriptions = await ctx.db
      .query("subscriptions")
      .filter((q) => q.and(q.eq(q.field("status"), "active"), q.gt(q.field("expiryDate"), now)))
      .collect();
    return subscriptions.length;
  },
});

export const getTotalUsersCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.length;
  },
});

// ============================================================
// 10. WITHDRAWALS
// ============================================================

export const getAllWithdrawals = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.id("withdrawals")) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("withdrawals").order("desc");
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const items = await query.take(args.limit + 1);
    const hasMore = items.length > args.limit;
    const results = items.slice(0, args.limit);
    const nextCursor = hasMore ? results[results.length - 1]._id : null;

    const enriched = [];
    for (const w of results) {
      const user = await ctx.db.get(w.userId);
      enriched.push({
        ...w,
        userName: user?.name || "Unknown",
        userEmail: user?.email || "",
        userPhone: user?.phone || "",
        phoneNumber: w.phoneNumber || "",
        requestedAt: w.requestedAt,
      });
    }
    return { withdrawals: enriched, nextCursor, hasMore };
  },
});

export const getWithdrawalById = internalQuery({
  args: { withdrawalId: v.id("withdrawals") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.withdrawalId);
  },
});

export const getAllPendingWithdrawals = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("withdrawals")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
  },
});

export const processWithdrawal = internalMutation({
  args: {
    withdrawalId: v.id("withdrawals"),
    status: v.union(v.literal("processed"), v.literal("failed")),
    reason: v.optional(v.string()),
    paymentMethod: v.optional(v.string()),
    paymentReference: v.optional(v.string()),
    processedBy: v.optional(v.id("users")),
    b2cTransactionId: v.optional(v.string()),
    b2cResultCode: v.optional(v.string()),
    b2cResultDesc: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const withdrawal = await ctx.db.get(args.withdrawalId);
    if (!withdrawal) throw new Error("Withdrawal not found");
    if (withdrawal.status !== "pending") throw new Error("Withdrawal already processed");

    const updates: any = {
      status: args.status,
      processedAt: Date.now(),
      processedBy: args.processedBy,
    };
    if (args.reason) updates.reason = args.reason;
    if (args.paymentMethod) updates.paymentMethod = args.paymentMethod;
    if (args.paymentReference) updates.paymentReference = args.paymentReference;
    if (args.b2cTransactionId) updates.b2cTransactionId = args.b2cTransactionId;
    if (args.b2cResultCode) updates.b2cResultCode = args.b2cResultCode;
    if (args.b2cResultDesc) updates.b2cResultDesc = args.b2cResultDesc;

    await ctx.db.patch(args.withdrawalId, updates);

    const user = await ctx.db.get(withdrawal.userId);
    if (!user) return;

    if (args.status === "processed") {
      const newPending = Math.max(0, (user.pendingBalance || 0) - withdrawal.amount);
      await ctx.db.patch(withdrawal.userId, { pendingBalance: newPending });
    }
    if (args.status === "failed") {
      const newBalance = (user.referralBalance || 0) + withdrawal.amount;
      const newPending = Math.max(0, (user.pendingBalance || 0) - withdrawal.amount);
      await ctx.db.patch(withdrawal.userId, {
        referralBalance: newBalance,
        pendingBalance: newPending,
      });
    }
  },
});

// ============================================================
// 11. REVERSALS
// ============================================================

export const getAllReversals = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.id("reversals")) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("reversals").order("desc");
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const items = await query.take(args.limit + 1);
    const hasMore = items.length > args.limit;
    const results = items.slice(0, args.limit);
    const nextCursor = hasMore ? results[results.length - 1]._id : null;
    return { reversals: results, nextCursor, hasMore };
  },
});

export const getReversalById = internalQuery({
  args: { reversalId: v.id("reversals") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.reversalId);
  },
});

export const updateReversalStatus = internalMutation({
  args: {
    reversalId: v.id("reversals"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reversal = await ctx.db.get(args.reversalId);
    if (!reversal) throw new Error("Reversal not found");
    if (reversal.status !== "requested" && reversal.status !== "processing") {
      throw new Error("Reversal already processed");
    }
    await ctx.db.patch(args.reversalId, {
      status: args.status,
      updatedAt: Date.now(),
      resultPayload: { reason: args.reason },
    });
    if (args.status === "completed") {
      await ctx.db.patch(reversal.paymentId, { status: "reversed" });
    }
  },
});

// ============================================================
// 12. BALANCE QUERIES
// ============================================================

export const getAllBalanceQueries = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.id("balanceQueries")) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("balanceQueries").order("desc");
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const items = await query.take(args.limit + 1);
    const hasMore = items.length > args.limit;
    const results = items.slice(0, args.limit);
    const nextCursor = hasMore ? results[results.length - 1]._id : null;
    return { balanceQueries: results, nextCursor, hasMore };
  },
});

// ============================================================
// 13. WEBHOOK LOGS
// ============================================================

export const getWebhookLogs = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.id("webhookLogs")) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("webhookLogs").order("desc");
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const items = await query.take(args.limit + 1);
    const hasMore = items.length > args.limit;
    const results = items.slice(0, args.limit);
    const nextCursor = hasMore ? results[results.length - 1]._id : null;
    return { logs: results, nextCursor, hasMore };
  },
});

// ============================================================
// 14. NOTIFICATIONS (broadcast)
// ============================================================

export const insertNotificationsForUsers = internalMutation({
  args: {
    userIds: v.array(v.string()),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    data: v.any(),
    senderId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let count = 0;
    for (const userId of args.userIds) {
      await ctx.db.insert("notifications", {
        userId: userId as any,
        type: args.type,
        title: args.title,
        message: args.message,
        data: args.data,
        read: false,
        createdAt: now,
        senderId: args.senderId,
      });
      count++;
    }
    return count;
  },
});

// ============================================================
// 15. AGENTS
// ============================================================

export const getAllAgents = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("users").filter((q) => q.eq(q.field("isAgent"), true));
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const items = await query.take(args.limit + 1);
    const hasMore = items.length > args.limit;
    const results = items.slice(0, args.limit);
    const nextCursor = hasMore ? results[results.length - 1]._id : null;
    const safe = results.map((u) => {
      const { passwordHash, securityQuestions, ...rest } = u;
      return rest;
    });
    return { agents: safe, nextCursor, hasMore };
  },
});

export const verifyAgent = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");
    if (!user.isAgent) throw new Error("User is not an agent");
    await ctx.db.patch(args.userId, { agentVerified: true });
  },
});

// ============================================================
// 16. ADDITIONAL HELPERS FOR ACTIONS
// ============================================================

export const getUsersByTarget = internalQuery({
  args: { target: v.string() },
  handler: async (ctx, args) => {
    let userIds: string[] = [];
    if (args.target === "all") {
      const users = await ctx.db.query("users").collect();
      userIds = users.map((u) => u._id);
    } else if (args.target === "subscribed") {
      const subs = await ctx.db
        .query("subscriptions")
        .withIndex("by_status_expiryDate", (q) => q.eq("status", "active"))
        .collect();
      const userIdSet = new Set(subs.map((s) => s.userId));
      userIds = Array.from(userIdSet);
    } else if (args.target === "trial") {
      const subs = await ctx.db
        .query("subscriptions")
        .withIndex("by_userId", (q) => q.eq("plan", "trial"))
        .collect();
      const userIdSet = new Set(subs.map((s) => s.userId));
      userIds = Array.from(userIdSet);
    } else {
      const users = await ctx.db.query("users").collect();
      userIds = users.map((u) => u._id);
    }
    return { userIds };
  },
});

export const getAgentStats = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const referredUsers = await ctx.db
      .query("users")
      .withIndex("by_referredBy", (q) => q.eq("referredBy", args.userId))
      .collect();
    let successfulReferrals = 0;
    for (const u of referredUsers) {
      const payments = await ctx.db
        .query("payments")
        .withIndex("by_userId_status", (q) => q.eq("userId", u._id).eq("status", "completed"))
        .collect();
      if (payments.length > 0) successfulReferrals++;
    }
    const user = await ctx.db.get(args.userId);
    return {
      userId: user?._id,
      name: user?.name,
      email: user?.email,
      totalReferrals: referredUsers.length,
      successfulReferrals,
      totalEarned: user?.totalEarned || 0,
      availableBalance: user?.referralBalance || 0,
      pendingBalance: user?.pendingBalance || 0,
      verified: user?.agentVerified || false,
    };
  },
});

export const exportUserData = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    const examResults = await ctx.db
      .query("examResults")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_userId_status", (q) => q.eq("userId", args.userId))
      .collect();
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_userId_updatedAt", (q) => q.eq("userId", args.userId))
      .collect();
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    const securityEvents = await ctx.db
      .query("securityEvents")
      .withIndex("by_userId_timestamp", (q) => q.eq("userId", args.userId))
      .collect();
    return {
      user,
      examResults,
      payments,
      notes,
      subscriptions,
      securityEvents,
      exportedAt: Date.now(),
    };
  },
});

export const getBackupData = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [users, payments, subscriptions, examResults, notes, securityEvents, auditLogs] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("payments").collect(),
      ctx.db.query("subscriptions").collect(),
      ctx.db.query("examResults").collect(),
      ctx.db.query("notes").collect(),
      ctx.db.query("securityEvents").collect(),
      ctx.db.query("auditLogs").collect(),
    ]);
    const safeUsers = users.map((u) => {
      const { passwordHash, securityQuestions, ...safe } = u;
      return safe;
    });
    return {
      users: safeUsers,
      payments,
      subscriptions,
      examResults,
      notes,
      securityEvents,
      auditLogs,
      exportedAt: Date.now(),
      version: "1.0",
      recordCounts: {
        users: users.length,
        payments: payments.length,
        subscriptions: subscriptions.length,
      },
    };
  },
});

// Alias for backward compatibility (some actions may reference adminGetAllPayments etc.)
export const getAllPaymentsWithUser = getAllPayments;