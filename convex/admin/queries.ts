// convex/admin/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const adminGetAllUsers = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Verify admin role
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch {
      return { success: false, error: "token_verification_failed", message: "Authentication failed" };
    }
    if (payload.role !== "admin") {
      return { success: false, error: "forbidden", message: "Admin access required" };
    }
    const limit = args.limit || 50;
    const { users, nextCursor, hasMore } = await ctx.runQuery(internal.admin.internal.getAllUsersPaginated, {
      limit,
      cursor: args.cursor,
    });
    // Audit log (R23)
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_get_all_users",
      details: { limit, cursor: args.cursor },
    });
    return {
      success: true,
      data: { users, nextCursor, hasMore },
    };
  },
});

export const adminGetRevenueReport = query({
  args: {
    token: v.string(),
    period: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch {
      return { success: false, error: "token_verification_failed", message: "Authentication failed" };
    }
    if (payload.role !== "admin") {
      return { success: false, error: "forbidden", message: "Admin access required" };
    }
    const now = Date.now();
    let startDate: number;
    switch (args.period) {
      case "day":
        startDate = now - 24 * 60 * 60 * 1000;
        break;
      case "week":
        startDate = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case "month":
        startDate = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case "year":
        startDate = now - 365 * 24 * 60 * 60 * 1000;
        break;
    }
    const revenue = await ctx.runQuery(internal.admin.internal.getRevenueData, { startDate, endDate: now });
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_get_revenue_report",
      details: { period: args.period },
    });
    return {
      success: true,
      data: { total: revenue.total, count: revenue.count, period: args.period },
    };
  },
});

export const adminGetConversionRates = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch {
      return { success: false, error: "token_verification_failed", message: "Authentication failed" };
    }
    if (payload.role !== "admin") {
      return { success: false, error: "forbidden", message: "Admin access required" };
    }
    const totalUsers = await ctx.runQuery(internal.admin.internal.getTotalUsersCount, {});
    const activeSubscriptions = await ctx.runQuery(internal.admin.internal.getActiveSubscriptionsCount, {});
    const conversionRate = totalUsers > 0 ? (activeSubscriptions / totalUsers) * 100 : 0;
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_get_conversion_rates",
      details: { totalUsers, activeSubscriptions },
    });
    return {
      success: true,
      data: { totalUsers, activeSubscriptions, conversionRate: conversionRate.toFixed(2) },
    };
  },
});