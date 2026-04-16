// convex/security/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const logSecurityEvent = mutation({
  args: {
    userId: v.optional(v.id("users")),
    eventType: v.string(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("securityEvents", {
      userId: args.userId,
      eventType: args.eventType,
      timestamp: Date.now(),
      metadata: args.metadata,
    });
    return { success: true };
  },
});

export const resolveSecurityEvent = mutation({
  args: {
    token: v.string(),
    eventId: v.id("securityEvents"),
    resolution: v.string(),
  },
  handler: async (ctx, args) => {
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
    const event = await ctx.db.get(args.eventId);
    if (!event) {
      return { success: false, error: "not_found", message: "Security event not found" };
    }
    await ctx.db.patch(args.eventId, { resolved: true, resolution: args.resolution, resolvedBy: payload.userId });
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: payload.userId,
      action: "resolve_security_event",
      targetId: args.eventId,
      details: { resolution: args.resolution },
    });
    return { success: true, data: { message: "Event resolved" } };
  },
});