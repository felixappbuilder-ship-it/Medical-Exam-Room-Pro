import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { z } from "zod";

// -----------------------------------------------------------------------------
// Helper: Ensure user is admin
// -----------------------------------------------------------------------------
async function ensureAdmin(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  const user = await ctx.db.get(identity.subject as Id<"users">);
  if (!user || user.role !== "admin") throw new ConvexError("Admin access required");
  return user._id;
}

const resolveSecurityEventSchema = z.object({
  eventId: v.id("securityEvents"),
});

// -----------------------------------------------------------------------------
// Resolve Security Event (admin only)
// -----------------------------------------------------------------------------
export const resolveSecurityEvent = mutation({
  args: {
    eventId: v.id("securityEvents"),
  },
  handler: async (ctx, args) => {
    const validated = resolveSecurityEventSchema.parse(args);
    await ensureAdmin(ctx);

    const event = await ctx.db.get(validated.eventId);
    if (!event) throw new ConvexError("Security event not found");

    await ctx.db.patch(validated.eventId, { resolved: true });

    return { success: true };
  },
});