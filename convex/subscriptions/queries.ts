import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

// -----------------------------------------------------------------------------
// Get Available Plans from AppConfig
// -----------------------------------------------------------------------------
export const getPlans = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db.get("config" as Id<"appConfig">);
    if (!config) {
      // Fallback default plans if config not set
      return [
        { id: "monthly", price: 500, durationDays: 30 },
        { id: "quarterly", price: 1350, durationDays: 90 },
        { id: "yearly", price: 4800, durationDays: 365 },
      ];
    }
    return config.plans;
  },
});

// -----------------------------------------------------------------------------
// Get Current User's Subscription Status
// -----------------------------------------------------------------------------
export const getSubscriptionStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", identity.subject))
      .first();

    if (!subscription) return null;

    // Check if expired and update isActive if needed
    const now = Date.now();
    if (subscription.expiryDate < now && subscription.isActive) {
      // Automatically deactivate expired subscription
      await ctx.db.patch(subscription._id, { isActive: false });
      subscription.isActive = false;
    }

    return subscription;
  },
});

// -----------------------------------------------------------------------------
// Quick Check for Access (used by frontend)
// -----------------------------------------------------------------------------
export const checkSubscription = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", identity.subject))
      .first();

    if (!subscription) return { hasAccess: false };

    const now = Date.now();
    const hasAccess = subscription.isActive && subscription.expiryDate > now;

    return {
      hasAccess,
      expiryDate: subscription.expiryDate,
      plan: subscription.plan,
    };
  },
});