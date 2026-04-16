// convex/security/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const checkTimeIntegrity = query({
  args: {
    token: v.string(),
    clientTime: v.number(),
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
    const userId = payload.userId;
    const serverTime = Date.now();
    const drift = Math.abs(serverTime - args.clientTime);
    const isValid = drift < 5 * 60 * 1000; // 5 minutes tolerance
    if (!isValid) {
      // Log time manipulation event
      await ctx.runMutation(internal.security.mutations.logSecurityEvent, {
        userId,
        eventType: "time_manipulation",
        metadata: { clientTime: args.clientTime, serverTime, drift },
      });
      // Count violations in last 24h (R21)
      const oneDayAgo = serverTime - 24 * 60 * 60 * 1000;
      const events = await ctx.db
        .query("securityEvents")
        .withIndex("by_userId_timestamp", (q) => q.eq("userId", userId))
        .collect();
      const recentViolations = events.filter(
        (e) => e.eventType === "time_manipulation" && e.timestamp >= oneDayAgo
      );
      if (recentViolations.length >= 3) {
        await ctx.runMutation(internal.auth.internal.lockUser, {
          userId,
          reason: "time_manipulation",
        });
      }
    }
    return { success: true, data: { valid: isValid, drift } };
  },
});

export const getSecurityLogs = query({
  args: {
    token: v.string(),
    userId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
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
    const limit = args.limit || 50;
    let query = ctx.db.query("securityEvents").order("desc");
    if (args.userId) {
      query = query.withIndex("by_userId_timestamp", (q) => q.eq("userId", args.userId));
    }
    const events = await query.take(limit);
    return { success: true, data: { events } };
  },
});