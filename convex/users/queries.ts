import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { v } from "convex/values";

export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db.get(identity.subject);
    if (!user) throw new ConvexError("User not found");

    // Return all non‑sensitive fields
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      devices: user.devices,
      preferences: user.preferences,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      isLocked: user.isLocked,
      lockReason: user.lockReason,
      role: user.role,
      trialUsed: user.trialUsed,
    };
  },
});