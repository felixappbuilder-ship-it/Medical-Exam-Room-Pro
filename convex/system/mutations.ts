import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
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

// -----------------------------------------------------------------------------
// Update App Configuration (admin only)
// -----------------------------------------------------------------------------
export const updateAppConfig = mutation({
  args: {
    trialDuration: v.optional(v.number()),
    plans: v.optional(
      v.array(
        v.object({
          id: v.union(v.literal("monthly"), v.literal("quarterly"), v.literal("yearly")),
          price: v.number(),
          durationDays: v.number(),
        })
      )
    ),
    systemLocked: v.optional(v.boolean()),
    maintenanceMode: v.optional(v.boolean()),
    paymentsFrozen: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const adminId = await ensureAdmin(ctx);

    const configId = "config" as Id<"appConfig">;
    const existing = await ctx.db.get(configId);

    const updates: any = {};
    if (args.trialDuration !== undefined) updates.trialDuration = args.trialDuration;
    if (args.plans !== undefined) updates.plans = args.plans;
    if (args.systemLocked !== undefined) updates.systemLocked = args.systemLocked;
    if (args.maintenanceMode !== undefined) updates.maintenanceMode = args.maintenanceMode;
    if (args.paymentsFrozen !== undefined) updates.paymentsFrozen = args.paymentsFrozen;

    if (existing) {
      await ctx.db.patch(configId, updates);
    } else {
      // Create with defaults plus provided values
      await ctx.db.insert("appConfig", {
        _id: configId,
        trialDuration: args.trialDuration ?? 3,
        plans: args.plans ?? [
          { id: "monthly", price: 500, durationDays: 30 },
          { id: "quarterly", price: 1350, durationDays: 90 },
          { id: "yearly", price: 4800, durationDays: 365 },
        ],
        systemLocked: args.systemLocked ?? false,
        maintenanceMode: args.maintenanceMode ?? false,
        paymentsFrozen: args.paymentsFrozen ?? false,
      });
    }

    // Log to audit logs
    await ctx.db.insert("auditLogs", {
      adminId,
      action: "update_app_config",
      details: args,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});