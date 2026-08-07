// convex/subscriptions/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// 1. CREATE SUBSCRIPTION (with optional updatedAt)
// ============================================================
export const createSubscription = internalMutation({
  args: {
    userId: v.id("users"),
    plan: v.string(),
    startDate: v.number(),
    expiryDate: v.number(),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled")),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.updatedAt || args.startDate;
    return await ctx.db.insert("subscriptions", {
      userId: args.userId,
      plan: args.plan,
      startDate: args.startDate,
      expiryDate: args.expiryDate,
      status: args.status,
      updatedAt: now,
    });
  },
});

// ============================================================
// 2. UPDATE SUBSCRIPTION EXPIRY (with updatedAt)
// ============================================================
export const updateSubscriptionExpiry = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    expiryDate: v.number(),
    status: v.optional(v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled"))),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: any = {
      expiryDate: args.expiryDate,
      updatedAt: args.updatedAt || Date.now(),
    };
    if (args.status !== undefined) updates.status = args.status;
    await ctx.db.patch(args.subscriptionId, updates);
  },
});

// ============================================================
// 3. GET ACTIVE SUBSCRIPTION BY USER (no auto‑expiry logic)
// ============================================================
export const getActiveSubscriptionByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

// ============================================================
// 4. GET USER SUBSCRIPTION HISTORY (all subscriptions)
// ============================================================
export const getUserSubscriptionHistory = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// ============================================================
// 5. CANCEL SUBSCRIPTION (set status to 'cancelled')
// ============================================================
export const cancelSubscriptionById = internalMutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
  },
});

// ============================================================
// 6. GET DEVICE BY FINGERPRINT
// ============================================================
export const getDeviceByFingerprint = internalQuery({
  args: { fingerprint: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("devices")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
      .first();
  },
});

// ============================================================
// 7. GET COMPLETED PAYMENTS FOR USER
// ============================================================
export const getUserCompletedPayments = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_userId_status", (q) => q.eq("userId", args.userId).eq("status", "completed"))
      .collect();
  },
});

// ============================================================
// 8. GET ALL SUBSCRIPTIONS FOR USER (including expired)
// ============================================================
export const getUserSubscriptions = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// ============================================================
// 9. UPDATE SUBSCRIPTION STATUS (used by cron)
// ============================================================
export const updateSubscriptionStatus = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled")),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      status: args.status,
      updatedAt: args.updatedAt || Date.now(),
    });
  },
});

// ============================================================
// 10. GET EXPIRED ACTIVE SUBSCRIPTIONS (used by cron)
// ============================================================
export const getExpiredActiveSubscriptions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_status_expiryDate", (q) => q.eq("status", "active").lt("expiryDate", now))
      .collect();
  },
});