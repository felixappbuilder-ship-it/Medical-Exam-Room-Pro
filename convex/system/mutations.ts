// convex/system/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const updateAppConfig = mutation({
  args: {
    token: v.string(),
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
    // Verify admin
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch {
      return { success: false, error: "token_verification_failed", message: "Authentication failed" };
    }
    if (payload.role !== "admin") {
      return { success: false, error: "forbidden", message: "Admin access required" };
    }
    await ctx.runMutation(internal.system.internal.updateAppConfigInternal, { updates: args.updates });
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: payload.userId,
      action: "update_app_config",
      details: args.updates,
    });
    return { success: true, data: { message: "App config updated" } };
  },
});