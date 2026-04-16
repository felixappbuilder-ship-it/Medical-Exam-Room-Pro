// convex/system/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getAppConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.runQuery(internal.system.internal.getAppConfig, {});
    if (!config) {
      return {
        success: false,
        error: "config_not_found",
        message: "System configuration missing.",
      };
    }
    // Return public subset (exclude paymentsFrozen if not needed? blueprint says return subset but we can keep for frontend)
    // However to be safe, return all except sensitive internal flags? Blueprint says return maintenanceMode.
    return {
      success: true,
      data: {
        trialDurationHours: config.trialDurationHours,
        maintenanceMode: config.maintenanceMode,
        subscriptionPlans: config.subscriptionPlans,
        maxRequestsPerMinute: config.maxRequestsPerMinute,
      },
    };
  },
});