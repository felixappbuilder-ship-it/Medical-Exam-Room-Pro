import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// -----------------------------------------------------------------------------
// Log Security Event (internal, called from other functions)
// -----------------------------------------------------------------------------
export const logSecurityEvent = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    type: v.string(),
    details: v.any(),
    resolved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("securityEvents", {
      userId: args.userId,
      type: args.type,
      details: args.details,
      timestamp: Date.now(),
      resolved: args.resolved ?? false,
    });
  },
});