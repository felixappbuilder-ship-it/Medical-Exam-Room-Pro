// convex/admin/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

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
    // Remove sensitive fields
    const safeUsers = items.map((user) => {
      const { passwordHash, securityQuestions, ...safe } = user;
      return safe;
    });
    return { users: safeUsers, nextCursor, hasMore };
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
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, args.updates);
  },
});

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

export const getActiveSubscriptionsCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const subscriptions = await ctx.db.query("subscriptions").collect();
    const active = subscriptions.filter((s) => s.expiryDate > now && s.status === "active");
    return active.length;
  },
});

export const getTotalUsersCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.length;
  },
});

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
      subscriptionPlans: v.optional(v.array(v.object({ name: v.string(), price: v.number(), days: v.number() }))),
      paymentsFrozen: v.optional(v.boolean()),
      maxRequestsPerMinute: v.optional(v.number()),
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
      });
    } else {
      await ctx.db.patch(config._id, args.updates);
    }
  },
});