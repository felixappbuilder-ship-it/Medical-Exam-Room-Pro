import { v } from "convex/values";
import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { z } from "zod";

// -----------------------------------------------------------------------------
// Helper: Ensure user is admin
// -----------------------------------------------------------------------------
async function ensureAdmin(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  const user = await ctx.db.get(identity.subject as Id<"users">);
  if (!user || user.role !== "admin") throw new ConvexError("Admin access required");
  return user;
}

// -----------------------------------------------------------------------------
// User Management Queries
// -----------------------------------------------------------------------------

export const adminGetAllUsers = query({
  args: {
    search: v.optional(v.string()),
    filter: v.optional(v.any()), // could be used for additional filters
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);

    const limit = args.limit ?? 50;
    let usersQuery = ctx.db.query("users");

    // Apply search if provided (simple email/name contains)
    // Note: Convex doesn't support text search directly, so we'll fetch all and filter in memory for demo
    // In production, you'd want a search index or use a separate service.
    let users = await usersQuery.collect();

    if (args.search) {
      const searchLower = args.search.toLowerCase();
      users = users.filter(
        (u) =>
          u.email.toLowerCase().includes(searchLower) ||
          u.name.toLowerCase().includes(searchLower) ||
          u.phone.includes(args.search!)
      );
    }

    // Sort by createdAt desc
    users.sort((a, b) => b.createdAt - a.createdAt);

    // Pagination: if cursor provided, find index and slice
    let startIndex = 0;
    if (args.cursor) {
      const cursorIndex = users.findIndex((u) => u._id === args.cursor);
      if (cursorIndex !== -1) startIndex = cursorIndex + 1;
    }
    const paginated = users.slice(startIndex, startIndex + limit);
    const nextCursor = paginated.length === limit ? paginated[paginated.length - 1]._id : undefined;

    // Remove sensitive fields (passwordHash, securityQuestions)
    const safeUsers = paginated.map(({ passwordHash, securityQuestions, ...rest }) => rest);

    return {
      users: safeUsers,
      nextCursor,
    };
  },
});

export const adminGetUserDetails = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError("User not found");

    // Fetch related data
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .collect();

    const payments = await ctx.db
      .query("payments")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .collect();

    const securityEvents = await ctx.db
      .query("securityEvents")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .collect();

    // Remove sensitive fields from user
    const { passwordHash, securityQuestions, ...safeUser } = user;

    return {
      ...safeUser,
      subscriptions,
      payments,
      securityEvents,
      devices: user.devices,
    };
  },
});

export const adminGetLockedUsers = query({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);

    const users = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("isLocked"), true))
      .collect();

    // Remove sensitive fields
    return users.map(({ passwordHash, securityQuestions, ...rest }) => rest);
  },
});

// -----------------------------------------------------------------------------
// Subscription Queries
// -----------------------------------------------------------------------------

export const adminGetAllSubscriptions = query({
  args: {
    plan: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("expired"), v.literal("trial"))),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);

    let query = ctx.db.query("subscriptions");
    if (args.userId) {
      query = query.withIndex("by_userId", (q: any) => q.eq("userId", args.userId));
    }
    let subscriptions = await query.collect();

    // Apply filters in memory
    if (args.plan) {
      subscriptions = subscriptions.filter((s) => s.plan === args.plan);
    }
    if (args.status) {
      const now = Date.now();
      subscriptions = subscriptions.filter((s) => {
        if (args.status === "active") return s.isActive && s.expiryDate > now;
        if (args.status === "expired") return !s.isActive || s.expiryDate <= now;
        if (args.status === "trial") return s.plan === "trial";
        return true;
      });
    }

    // Enrich with user names
    const enriched = await Promise.all(
      subscriptions.map(async (sub) => {
        const user = await ctx.db.get(sub.userId);
        return {
          ...sub,
          userName: user?.name || "Unknown",
        };
      })
    );

    return enriched;
  },
});

// -----------------------------------------------------------------------------
// Payment Queries
// -----------------------------------------------------------------------------

export const adminGetAllPayments = query({
  args: {
    userId: v.optional(v.id("users")),
    status: v.optional(v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"), v.literal("refunded"))),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);

    let payments = await ctx.db.query("payments").collect();

    if (args.userId) {
      payments = payments.filter((p) => p.userId === args.userId);
    }
    if (args.status) {
      payments = payments.filter((p) => p.status === args.status);
    }
    if (args.startDate) {
      payments = payments.filter((p) => p.createdAt >= args.startDate!);
    }
    if (args.endDate) {
      payments = payments.filter((p) => p.createdAt <= args.endDate!);
    }

    // Sort by createdAt desc
    payments.sort((a, b) => b.createdAt - a.createdAt);

    return payments;
  },
});

// -----------------------------------------------------------------------------
// Analytics Queries
// -----------------------------------------------------------------------------

export const adminGetRevenueReport = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    groupBy: v.optional(v.union(v.literal("day"), v.literal("week"), v.literal("month"))),
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);

    const end = args.endDate ?? Date.now();
    const start = args.startDate ?? end - 90 * 24 * 60 * 60 * 1000; // default 90 days

    const payments = await ctx.db
      .query("payments")
      .filter((q) => q.and(q.gte(q.field("createdAt"), start), q.lte(q.field("createdAt"), end)))
      .collect();

    const completedPayments = payments.filter((p) => p.status === "completed");

    // Calculate by plan
    const byPlan: Record<string, number> = {};
    // We need to map payment to plan – payments don't have plan directly; we need to get subscription?
    // For simplicity, we'll assume we can get plan from metadata or subscription. But payments may not have subscriptionId if pending.
    // We'll do a best-effort: fetch subscriptions for each payment that has subscriptionId.
    const planTotals: Record<string, number> = { monthly: 0, quarterly: 0, yearly: 0, other: 0 };
    for (const p of completedPayments) {
      if (p.subscriptionId) {
        const sub = await ctx.db.get(p.subscriptionId);
        if (sub && sub.plan) {
          planTotals[sub.plan] = (planTotals[sub.plan] || 0) + p.amount;
        } else {
          planTotals.other += p.amount;
        }
      } else {
        planTotals.other += p.amount;
      }
    }

    // Daily breakdown
    const dailyBreakdown: Array<{ date: string; amount: number }> = [];
    const dayMap = new Map<string, number>();
    for (const p of completedPayments) {
      const dateStr = new Date(p.createdAt).toISOString().split("T")[0];
      dayMap.set(dateStr, (dayMap.get(dateStr) || 0) + p.amount);
    }
    for (const [date, amount] of dayMap.entries()) {
      dailyBreakdown.push({ date, amount });
    }
    dailyBreakdown.sort((a, b) => a.date.localeCompare(b.date));

    return {
      total: completedPayments.reduce((sum, p) => sum + p.amount, 0),
      byPlan: planTotals,
      dailyBreakdown,
    };
  },
});

export const adminGetUserGrowth = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    interval: v.optional(v.union(v.literal("day"), v.literal("week"), v.literal("month"))),
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);

    const end = args.endDate ?? Date.now();
    const start = args.startDate ?? end - 90 * 24 * 60 * 60 * 1000;
    const interval = args.interval ?? "day";

    const users = await ctx.db
      .query("users")
      .filter((q) => q.and(q.gte(q.field("createdAt"), start), q.lte(q.field("createdAt"), end)))
      .collect();

    // Group by interval
    const groups: Record<string, number> = {};
    for (const user of users) {
      let key: string;
      const date = new Date(user.createdAt);
      if (interval === "day") {
        key = date.toISOString().split("T")[0];
      } else if (interval === "week") {
        // Get week number (simple)
        const week = Math.floor((user.createdAt - start) / (7 * 24 * 60 * 60 * 1000));
        key = `week-${week}`;
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      }
      groups[key] = (groups[key] || 0) + 1;
    }

    const newUsers = Object.entries(groups).map(([period, count]) => ({ period, count }));
    newUsers.sort((a, b) => a.period.localeCompare(b.period));

    const totalUsers = await ctx.db.query("users").collect().then((u) => u.length);

    return { newUsers, totalUsers };
  },
});

export const adminGetConversionRates = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);

    const end = args.endDate ?? Date.now();
    const start = args.startDate ?? end - 90 * 24 * 60 * 60 * 1000;

    const users = await ctx.db
      .query("users")
      .filter((q) => q.and(q.gte(q.field("createdAt"), start), q.lte(q.field("createdAt"), end)))
      .collect();

    const userIds = users.map((u) => u._id);
    // Get subscriptions for these users
    const subscriptions = await ctx.db
      .query("subscriptions")
      .filter((q) => q.or(...userIds.map((id) => q.eq(q.field("userId"), id))))
      .collect();

    const trialUsers = new Set(subscriptions.filter((s) => s.plan === "trial").map((s) => s.userId));
    const paidUsers = new Set(
      subscriptions.filter((s) => s.plan !== "trial" && s.isActive).map((s) => s.userId)
    );

    const trialToPaid = trialUsers.size > 0 ? (paidUsers.size / trialUsers.size) * 100 : 0;

    return {
      trialToPaid: Math.round(trialToPaid * 100) / 100,
      trialUsers: trialUsers.size,
      paidUsers: paidUsers.size,
    };
  },
});

export const adminGetRetention = query({
  args: {
    cohort: v.optional(v.string()), // e.g., "monthly", "weekly"
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);
    // Placeholder: return dummy data
    // In production, you'd compute cohort retention based on user activity.
    return {
      cohorts: [
        { month: "2025-01", week1: 100, week2: 80, week3: 70, week4: 65 },
        { month: "2025-02", week1: 100, week2: 85, week3: 75 },
      ],
    };
  },
});

export const adminGetExamPerformance = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);

    const end = args.endDate ?? Date.now();
    const start = args.startDate ?? end - 90 * 24 * 60 * 60 * 1000;

    const examResults = await ctx.db
      .query("examResults")
      .filter((q) => q.and(q.gte(q.field("date"), start), q.lte(q.field("date"), end)))
      .collect();

    if (examResults.length === 0) {
      return { avgScore: 0, popularSubjects: [], weakTopics: [] };
    }

    const avgScore = examResults.reduce((sum, e) => sum + (e.correctAnswers / e.totalQuestions) * 100, 0) / examResults.length;

    // Count subjects
    const subjectCount: Record<string, number> = {};
    for (const e of examResults) {
      subjectCount[e.subject] = (subjectCount[e.subject] || 0) + 1;
    }
    const popularSubjects = Object.entries(subjectCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([subject]) => subject);

    // Aggregate weak areas from exam results
    const weakCount: Record<string, number> = {};
    for (const e of examResults) {
      for (const weak of e.weakAreas || []) {
        weakCount[weak] = (weakCount[weak] || 0) + 1;
      }
    }
    const weakTopics = Object.entries(weakCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic]) => topic);

    return {
      avgScore: Math.round(avgScore * 100) / 100,
      popularSubjects,
      weakTopics,
    };
  },
});

// -----------------------------------------------------------------------------
// Security Queries
// -----------------------------------------------------------------------------

export const adminGetSecurityLogs = query({
  args: {
    userId: v.optional(v.id("users")),
    type: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);

    let logs = await ctx.db.query("securityEvents").collect();

    if (args.userId) {
      logs = logs.filter((l) => l.userId === args.userId);
    }
    if (args.type) {
      logs = logs.filter((l) => l.type === args.type);
    }
    if (args.startDate) {
      logs = logs.filter((l) => l.timestamp >= args.startDate!);
    }
    if (args.endDate) {
      logs = logs.filter((l) => l.timestamp <= args.endDate!);
    }

    logs.sort((a, b) => b.timestamp - a.timestamp);
    return logs;
  },
});

export const adminGetAuditLogs = query({
  args: {
    adminId: v.optional(v.id("users")),
    action: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ensureAdmin(ctx);

    let logs = await ctx.db.query("auditLogs").collect();

    if (args.adminId) {
      logs = logs.filter((l) => l.adminId === args.adminId);
    }
    if (args.action) {
      logs = logs.filter((l) => l.action === args.action);
    }
    if (args.startDate) {
      logs = logs.filter((l) => l.timestamp >= args.startDate!);
    }
    if (args.endDate) {
      logs = logs.filter((l) => l.timestamp <= args.endDate!);
    }

    logs.sort((a, b) => b.timestamp - a.timestamp);
    return logs;
  },
});

// -----------------------------------------------------------------------------
// Config Queries
// -----------------------------------------------------------------------------

export const adminGetAppConfig = query({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);

    const config = await ctx.db.get("config" as Id<"appConfig">);
    return config;
  },
});