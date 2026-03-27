import { v } from "convex/values";
import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { z } from "zod";

const MAX_ALLOWED_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

// -----------------------------------------------------------------------------
// Check Time Integrity (called by frontend)
// -----------------------------------------------------------------------------
export const checkTimeIntegrity = query({
  args: {
    clientTime: v.number(),
  },
  handler: async (ctx, args) => {
    const serverTime = Date.now();
    const drift = serverTime - args.clientTime;
    const valid = Math.abs(drift) <= MAX_ALLOWED_DRIFT_MS;
    return { valid, drift };
  },
});

// -----------------------------------------------------------------------------
// Helper: Ensure admin (for admin queries)
// -----------------------------------------------------------------------------
async function ensureAdmin(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  const user = await ctx.db.get(identity.subject as Id<"users">);
  if (!user || user.role !== "admin") throw new ConvexError("Admin access required");
  return user._id;
}

const getSecurityLogsSchema = z.object({
  userId: v.optional(v.id("users")),
  type: v.optional(v.string()),
  startDate: v.optional(v.number()),
  endDate: v.optional(v.number()),
  limit: v.optional(v.number()),
  cursor: v.optional(v.string()),
});

// -----------------------------------------------------------------------------
// Get Security Logs (admin only, with filters and pagination)
// -----------------------------------------------------------------------------
export const getSecurityLogs = query({
  args: {
    userId: v.optional(v.id("users")),
    type: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const validated = getSecurityLogsSchema.parse(args);
    await ensureAdmin(ctx);

    let events = await ctx.db.query("securityEvents").collect();

    // Apply filters
    if (validated.userId) {
      events = events.filter((e) => e.userId === validated.userId);
    }
    if (validated.type) {
      events = events.filter((e) => e.type === validated.type);
    }
    if (validated.startDate) {
      events = events.filter((e) => e.timestamp >= validated.startDate!);
    }
    if (validated.endDate) {
      events = events.filter((e) => e.timestamp <= validated.endDate!);
    }

    // Sort by timestamp desc
    events.sort((a, b) => b.timestamp - a.timestamp);

    // Pagination
    const limit = validated.limit ?? 50;
    let startIndex = 0;
    if (validated.cursor) {
      const cursorIndex = events.findIndex((e) => e._id === validated.cursor);
      if (cursorIndex !== -1) startIndex = cursorIndex + 1;
    }
    const paginated = events.slice(startIndex, startIndex + limit);
    const nextCursor = paginated.length === limit ? paginated[paginated.length - 1]._id : undefined;

    return {
      events: paginated,
      nextCursor,
    };
  },
});