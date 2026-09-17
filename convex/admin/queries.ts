// convex/admin/queries.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

async function verifyAdmin(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error("Invalid token: " + (result.message || ""));
  const payload = result.data;
  if (payload.role !== "admin") throw new Error("Unauthorized: Admin role required");
  return payload;
}

// ============================================================
// 1. USER MANAGEMENT
// ============================================================

// Get all users (with search & filters)
export const adminGetAllUsers = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("users")),
    search: v.optional(v.string()),
    filter: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      const result = await ctx.runQuery(internal.admin.internal.getAllUsersPaginated, {
        limit,
        cursor: args.cursor,
      });
      const { users, nextCursor, hasMore } = result;
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_all_users",
        details: { limit, cursor: args.cursor },
      });
      return { success: true, data: { users, nextCursor, hasMore } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Get a single user (admin only)
export const adminGetUserDetails = action({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const user = await ctx.runQuery(internal.admin.internal.getUserById, {
        userId: args.userId,
      });
      if (!user) throw new Error("User not found");
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_user_details",
        targetId: args.userId,
        details: {},
      });
      return { success: true, data: { user } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 2. REVENUE & ANALYTICS
// ============================================================

// Revenue report
export const adminGetRevenueReport = action({
  args: {
    token: v.string(),
    period: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const now = Date.now();
      let startDate: number;
      switch (args.period) {
        case "day": startDate = now - 24 * 60 * 60 * 1000; break;
        case "week": startDate = now - 7 * 24 * 60 * 60 * 1000; break;
        case "month": startDate = now - 30 * 24 * 60 * 60 * 1000; break;
        case "year": startDate = now - 365 * 24 * 60 * 60 * 1000; break;
      }
      const revenue = await ctx.runQuery(internal.admin.internal.getRevenueData, { startDate, endDate: now });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_revenue_report",
        details: { period: args.period },
      });
      return { success: true, data: { total: revenue.total, count: revenue.count, period: args.period } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Conversion rates
export const adminGetConversionRates = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const totalUsers = await ctx.runQuery(internal.admin.internal.getTotalUsersCount, {});
      const activeSubscriptions = await ctx.runQuery(internal.admin.internal.getActiveSubscriptionsCount, {});
      const conversionRate = totalUsers > 0 ? (activeSubscriptions / totalUsers) * 100 : 0;
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_conversion_rates",
        details: { totalUsers, activeSubscriptions },
      });
      return { success: true, data: { totalUsers, activeSubscriptions, conversionRate: conversionRate.toFixed(2) } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// User growth (last 30 days)
export const adminGetUserGrowth = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const now = Date.now();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      const start = now - thirtyDays;
      const users = await ctx.runQuery(internal.admin.internal.getAllUsersNoCursor, {});
      const labels = [];
      const values = [];
      for (let i = 29; i >= 0; i--) {
        const dayStart = now - i * 24 * 60 * 60 * 1000;
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        const count = users.filter(u => u.createdAt && u.createdAt >= dayStart && u.createdAt < dayEnd).length;
        labels.push(new Date(dayStart).toLocaleDateString());
        values.push(count);
      }
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_user_growth",
        details: {},
      });
      return { success: true, data: { labels, datasets: [{ label: "New Users", data: values }] } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Retention (active subscribers / total users)
export const adminGetRetention = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const totalUsers = await ctx.runQuery(internal.admin.internal.getTotalUsersCount, {});
      const activeSubs = await ctx.runQuery(internal.admin.internal.getActiveSubscriptionsCount, {});
      const retention = totalUsers > 0 ? (activeSubs / totalUsers) * 100 : 0;
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_retention",
        details: {},
      });
      return { success: true, data: { labels: ["Active Retention"], values: [retention] } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Exam performance by subject
export const adminGetExamPerformance = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const examResults = await ctx.runQuery(internal.admin.internal.getAllExamResultsNoCursor, {});
      const subjectScores: Record<string, { total: number; count: number }> = {};
      for (const er of examResults) {
        if (er.topicPerformance && er.topicPerformance.length > 0) {
          for (const tp of er.topicPerformance) {
            const subject = tp.topic;
            if (!subjectScores[subject]) subjectScores[subject] = { total: 0, count: 0 };
            subjectScores[subject].total += tp.score;
            subjectScores[subject].count++;
          }
        }
      }
      const subjects = Object.keys(subjectScores);
      const averageScores = subjects.map(s => subjectScores[s].total / subjectScores[s].count);
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_exam_performance",
        details: {},
      });
      return { success: true, data: { subjects, averageScores } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 3. SUBSCRIPTIONS
// ============================================================

// All subscriptions
export const adminGetAllSubscriptions = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("subscriptions")),
    filter: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      const { items, nextCursor, hasMore } = await ctx.runQuery(
        internal.admin.internal.getAllSubscriptionsPaginated,
        {
          limit,
          cursor: args.cursor,
          filter: args.filter,
        }
      );
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_all_subscriptions",
        details: { limit, cursor: args.cursor },
      });
      return { success: true, data: { subscriptions: items, nextCursor, hasMore } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 4. PAYMENTS
// ============================================================

// All payments
export const adminGetAllPayments = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("payments")),
    filter: v.optional(v.any()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      const { items, nextCursor, hasMore } = await ctx.runQuery(
        internal.admin.internal.getAllPaymentsPaginated,
        {
          limit,
          cursor: args.cursor,
          filter: args.filter,
          startDate: args.startDate,
          endDate: args.endDate,
        }
      );
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_all_payments",
        details: { limit, cursor: args.cursor },
      });
      return { success: true, data: { payments: items, nextCursor, hasMore } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 5. WITHDRAWALS
// ============================================================

// Get all withdrawals (with user enrichment)
export const adminGetAllWithdrawals = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("withdrawals")),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      const result = await ctx.runQuery(internal.admin.internal.getAllWithdrawals, {
        limit,
        cursor: args.cursor,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_all_withdrawals",
        details: { limit, cursor: args.cursor },
      });
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Get all pending withdrawals (for bulk approval)
export const adminGetPendingWithdrawals = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const pending = await ctx.runQuery(internal.admin.internal.getAllPendingWithdrawals, {});
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_pending_withdrawals",
        details: { count: pending.length },
      });
      return { success: true, data: { withdrawals: pending } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 6. REVERSALS
// ============================================================

// Get all reversals
export const adminGetAllReversals = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("reversals")),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      const result = await ctx.runQuery(internal.admin.internal.getAllReversals, {
        limit,
        cursor: args.cursor,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_all_reversals",
        details: { limit, cursor: args.cursor },
      });
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 7. BALANCE QUERIES
// ============================================================

// Get all balance queries
export const adminGetBalanceQueries = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("balanceQueries")),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      const result = await ctx.runQuery(internal.admin.internal.getAllBalanceQueries, {
        limit,
        cursor: args.cursor,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_balance_queries",
        details: { limit, cursor: args.cursor },
      });
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 8. WEBHOOK LOGS
// ============================================================

// Get webhook logs
export const adminGetWebhookLogs = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("webhookLogs")),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      const result = await ctx.runQuery(internal.admin.internal.getWebhookLogs, {
        limit,
        cursor: args.cursor,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_webhook_logs",
        details: { limit, cursor: args.cursor },
      });
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 9. AGENTS
// ============================================================

// List all agents
export const adminListAgents = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      const result = await ctx.runQuery(internal.admin.internal.getAllAgents, {
        limit,
        cursor: args.cursor,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_list_agents",
        details: { count: result.agents.length },
      });
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Get agent performance stats
export const adminGetAgentStats = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const user = await ctx.runQuery(internal.admin.internal.getUserById, { userId: args.userId });
      if (!user) throw new Error("User not found");
      if (!user.isAgent) throw new Error("User is not an agent");
      // Fetch referrals
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
      const stats = {
        userId: user._id,
        name: user.name,
        email: user.email,
        totalReferrals: referredUsers.length,
        successfulReferrals,
        totalEarned: user.totalEarned || 0,
        availableBalance: user.referralBalance || 0,
        pendingBalance: user.pendingBalance || 0,
        verified: user.agentVerified || false,
      };
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_agent_stats",
        targetId: args.userId,
        details: { stats },
      });
      return { success: true, data: stats };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 10. SECURITY & AUDIT LOGS
// ============================================================

// Security logs
export const adminGetSecurityLogs = action({
  args: { token: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const logs = await ctx.runQuery(internal.admin.internal.getSecurityLogs, { limit: args.limit });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_security_logs",
        details: { limit: args.limit },
      });
      return { success: true, data: { logs } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Audit logs
export const adminGetAuditLogs = action({
  args: { token: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const logs = await ctx.runQuery(internal.admin.internal.getAuditLogs, { limit: args.limit });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_audit_logs",
        details: { limit: args.limit },
      });
      return { success: true, data: { logs } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 11. APP CONFIG
// ============================================================

// Get app config
export const adminGetAppConfig = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const config = await ctx.runQuery(internal.admin.internal.getAppConfig, {});
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_app_config",
        details: {},
      });
      return { success: true, data: config };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 12. BACKUPS (placeholder)
// ============================================================

// List backups
export const adminListBackups = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      await verifyAdmin(ctx, args.token);
      return { success: true, data: { backups: [] } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 13. NOTIFICATIONS (ADMIN)
// ============================================================

// Get notifications for admin (with optional user filter)
export const adminGetNotifications = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("notifications")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      const result = await ctx.runQuery(internal.notifications.internal.adminGetAllNotifications, {
        limit,
        cursor: args.cursor,
        userId: args.userId,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_notifications",
        details: { limit, cursor: args.cursor, userId: args.userId },
      });
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});