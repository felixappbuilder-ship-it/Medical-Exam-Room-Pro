// convex/admin/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ------------------------------------------------------------------
// User helpers
// ------------------------------------------------------------------
export const getAllUsersPaginated = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("users");
    if (args.cursor) query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    const users = await query.take(args.limit + 1);
    const hasMore = users.length > args.limit;
    const items = users.slice(0, args.limit);
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { items, nextCursor, hasMore };
  },
});

export const getAllUsersNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const updateUserById = internalMutation({
  args: { userId: v.id("users"), updates: v.object({ name: v.optional(v.string()), email: v.optional(v.string()), phone: v.optional(v.string()), isLocked: v.optional(v.boolean()), lockReason: v.optional(v.string()), trialUsed: v.optional(v.boolean()) }) },
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

// ------------------------------------------------------------------
// Payment helpers
// ------------------------------------------------------------------
export const getRevenueData = internalQuery({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "completed"))
      .collect();
    const filtered = payments.filter((p) => p.createdAt >= args.startDate && p.createdAt <= args.endDate && p.status === "completed");
    const total = filtered.reduce((sum, p) => sum + p.amount, 0);
    const count = filtered.length;
    return { total, count, payments: filtered };
  },
});

export const getAllPaymentsPaginated = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.id("payments")), filter: v.optional(v.any()), startDate: v.optional(v.number()), endDate: v.optional(v.number()) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("payments");
    if (args.startDate) query = query.filter((q) => q.gte(q.field("createdAt"), args.startDate));
    if (args.endDate) query = query.filter((q) => q.lte(q.field("createdAt"), args.endDate));
    if (args.filter) {
      if (args.filter.status) query = query.filter((q) => q.eq(q.field("status"), args.filter.status));
      if (args.filter.userId) query = query.filter((q) => q.eq(q.field("userId"), args.filter.userId));
    }
    if (args.cursor) query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    const payments = await query.take(args.limit + 1);
    const hasMore = payments.length > args.limit;
    const items = payments.slice(0, args.limit);
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    const enriched = await Promise.all(items.map(async (p) => {
      const user = await ctx.db.get(p.userId);
      return { ...p, user: user ? { _id: user._id, name: user.name, email: user.email } : null };
    }));
    return { items: enriched, nextCursor, hasMore };
  },
});

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
  args: { paymentId: v.id("payments"), updates: v.object({ status: v.optional(v.string()), mpesaReceipt: v.optional(v.string()) }) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, args.updates);
  },
});

// ------------------------------------------------------------------
// Subscription helpers
// ------------------------------------------------------------------
export const getAllSubscriptionsPaginated = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.id("subscriptions")), filter: v.optional(v.any()) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("subscriptions");
    if (args.filter) {
      if (args.filter.plan) query = query.filter((q) => q.eq(q.field("plan"), args.filter.plan));
      if (args.filter.status) query = query.filter((q) => q.eq(q.field("status"), args.filter.status));
    }
    if (args.cursor) query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    const subscriptions = await query.take(args.limit + 1);
    const hasMore = subscriptions.length > args.limit;
    const items = subscriptions.slice(0, args.limit);
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    const enriched = await Promise.all(items.map(async (sub) => {
      const user = await ctx.db.get(sub.userId);
      return { ...sub, user: user ? { _id: user._id, name: user.name, email: user.email } : null };
    }));
    return { items: enriched, nextCursor, hasMore };
  },
});

export const getAllSubscriptionsNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("subscriptions").collect();
  },
});

export const updateSubscriptionInternal = internalMutation({
  args: { subscriptionId: v.id("subscriptions"), updates: v.object({ plan: v.optional(v.string()), expiryDate: v.optional(v.number()), status: v.optional(v.string()) }) },
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

// ------------------------------------------------------------------
// Exam results
// ------------------------------------------------------------------
export const getAllExamResultsNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("examResults").collect();
  },
});

// ------------------------------------------------------------------
// Notes
// ------------------------------------------------------------------
export const getAllNotesNoCursor = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("notes").collect();
  },
});

// ------------------------------------------------------------------
// Security & audit logs
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// App config
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// Audit log entry (used by all admin actions)
// ------------------------------------------------------------------
export const logAuditEntry = internalMutation({
  args: { actorId: v.string(), action: v.string(), targetId: v.optional(v.string()), details: v.any() },
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

// ------------------------------------------------------------------
// Counts
// ------------------------------------------------------------------
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