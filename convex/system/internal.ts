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

// Fetch singleton – first document in the table (there will be only one)
export const getAppConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("appConfig").first();
  },
});

// Ensure singleton exists with fixed ID "config"
export const ensureAppConfig = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("appConfig").first();
    if (!existing) {
      // Insert with custom ID "config" to allow direct lookup if needed
      await ctx.db.insert("appConfig", {
        trialDurationHours: 3,
        maintenanceMode: false,
        subscriptionPlans: [
          { name: "1 Month", price: 350, days: 30 },
          { name: "3 Months", price: 850, days: 90 },
          { name: "1 Year", price: 2100, days: 365 },
        ],
        paymentsFrozen: false,
        maxRequestsPerMinute: 60,
      }, { id: "config" }); // ✅ Explicitly set document ID to "config"
    }
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
    // Ensure config exists (creates with ID "config" if missing)
    await ctx.runMutation(internal.system.internal.ensureAppConfig, {});
    const config = await ctx.db.get("config" as any); // Now safe because we inserted with that ID
    if (!config) {
      throw new Error("AppConfig still missing after seeding");
    }
    await ctx.db.patch(config._id, args.updates);
  },
});