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

// ------------------------------------------------------------------
// 1. Get all users (with search & filters)
// ------------------------------------------------------------------
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
      const { items, nextCursor, hasMore } = result;
      const safeUsers = items.map((u) => {
        const { passwordHash, securityQuestions, ...safe } = u;
        return safe;
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_get_all_users",
        details: { limit, cursor: args.cursor },
      });
      return { success: true, data: { users: safeUsers, nextCursor, hasMore } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 2. Revenue report
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// 3. Conversion rates
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// 4. All subscriptions
// ------------------------------------------------------------------
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
      const { items, nextCursor, hasMore } = await ctx.runQuery(internal.admin.internal.getAllSubscriptionsPaginated, {
        limit,
        cursor: args.cursor,
        filter: args.filter,
      });
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

// ------------------------------------------------------------------
// 5. All payments
// ------------------------------------------------------------------
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
      const { items, nextCursor, hasMore } = await ctx.runQuery(internal.admin.internal.getAllPaymentsPaginated, {
        limit,
        cursor: args.cursor,
        filter: args.filter,
        startDate: args.startDate,
        endDate: args.endDate,
      });
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

// ------------------------------------------------------------------
// 6. User growth (last 30 days)
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// 7. Retention (active subscribers / total users)
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// 8. Exam performance by subject
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// 9. Security logs
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// 10. Audit logs
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// 11. App config (read)
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// 12. List backups (placeholder)
// ------------------------------------------------------------------
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