// convex/system/internal.ts
import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const getExpiredSharedLinks = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const links = await ctx.db
      .query("sharedLinks")
      .withIndex("by_expiry", (q) => q.lt("expiry", now))
      .collect();
    return links;
  },
});

export const deleteSharedLink = internalMutation({
  args: { linkId: v.id("sharedLinks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.linkId);
  },
});

export const getAppConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("appConfig").first();
  },
});

export const updateAppConfigInternal = internalMutation({
  args: {
    updates: v.object({
      trialDurationHours: v.optional(v.number()),
      maintenanceMode: v.optional(v.boolean()),
      subscriptionPlans: v.optional(
        v.array(v.object({ name: v.string(), price: v.number(), days: v.number() }))
      ),
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