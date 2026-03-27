import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";

// -----------------------------------------------------------------------------
// Get Public App Configuration
// -----------------------------------------------------------------------------
export const getAppConfig = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db.get("config" as Id<"appConfig">);
    if (!config) {
      // Return default config if not set
      return {
        trialDuration: 3, // hours
        plans: [
          { id: "monthly", price: 500, durationDays: 30 },
          { id: "quarterly", price: 1350, durationDays: 90 },
          { id: "yearly", price: 4800, durationDays: 365 },
        ],
        systemLocked: false,
        maintenanceMode: false,
        paymentsFrozen: false,
      };
    }
    // Return only public fields (all fields are public except maybe sensitive ones)
    return {
      trialDuration: config.trialDuration,
      plans: config.plans,
      systemLocked: config.systemLocked,
      maintenanceMode: config.maintenanceMode,
      paymentsFrozen: config.paymentsFrozen,
    };
  },
});