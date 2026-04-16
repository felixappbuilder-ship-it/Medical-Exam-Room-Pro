// convex/subscriptions/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const createSubscription = internalMutation({
  args: {
    userId: v.id("users"),
    plan: v.string(),
    startDate: v.number(),
    expiryDate: v.number(),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const subscriptionId = await ctx.db.insert("subscriptions", {
      userId: args.userId,
      plan: args.plan,
      startDate: args.startDate,
      expiryDate: args.expiryDate,
      status: args.status,
    });
    return subscriptionId;
  },
});

export const updateSubscriptionExpiry = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    expiryDate: v.number(),
    status: v.optional(v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled"))),
  },
  handler: async (ctx, args) => {
    const updates: any = { expiryDate: args.expiryDate };
    if (args.status !== undefined) updates.status = args.status;
    await ctx.db.patch(args.subscriptionId, updates);
  },
});

export const getActiveSubscriptionByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!subscription) return null;
    if (subscription.expiryDate < now && subscription.status === "active") {
      // Auto-mark as expired
      await ctx.db.patch(subscription._id, { status: "expired" });
      return { ...subscription, status: "expired" };
    }
    return subscription;
  },
});

export const getUserSubscriptionHistory = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const cancelSubscriptionById = internalMutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, { status: "cancelled" });
  },
});