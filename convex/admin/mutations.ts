// convex/admin/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const adminUpdateUser = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    updates: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      isLocked: v.optional(v.boolean()),
      trialUsed: v.optional(v.boolean()),
    }),
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
    const targetUser = await ctx.runQuery(internal.admin.internal.getUserById, { userId: args.userId });
    if (!targetUser) {
      return { success: false, error: "user_not_found", message: "User not found" };
    }
    await ctx.runMutation(internal.admin.internal.updateUserById, {
      userId: args.userId,
      updates: args.updates,
    });
    // Audit log (R23)
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_update_user",
      targetId: args.userId,
      details: { updates: args.updates },
    });
    return { success: true, data: { message: "User updated" } };
  },
});

export const adminLockUser = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    reason: v.string(),
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
    await ctx.runMutation(internal.admin.internal.updateUserById, {
      userId: args.userId,
      updates: { isLocked: true, lockReason: args.reason },
    });
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_lock_user",
      targetId: args.userId,
      details: { reason: args.reason },
    });
    return { success: true, data: { message: "User locked" } };
  },
});

export const adminForceLogout = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
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
    // Invalidate all user sessions by updating a tokenVersion field
    // We need to add tokenVersion to users schema. Since blueprint doesn't specify, we'll implement by updating a "tokenVersion" field.
    // For now, we'll assume user document has a tokenVersion field. If not, we add it via patch.
    const user = await ctx.db.get(args.userId);
    if (user) {
      const currentVersion = (user as any).tokenVersion || 0;
      await ctx.db.patch(args.userId, { tokenVersion: currentVersion + 1 });
    }
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_force_logout",
      targetId: args.userId,
      details: {},
    });
    return { success: true, data: { message: "User logged out from all devices" } };
  },
});

export const adminResetPassword = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    newPassword: v.string(),
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
    const newHash = await ctx.runAction(internal.auth.helpers.hashPassword, { password: args.newPassword });
    await ctx.runMutation(internal.admin.internal.updateUserById, {
      userId: args.userId,
      updates: { passwordHash: newHash } as any,
    });
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_reset_password",
      targetId: args.userId,
      details: {},
    });
    return { success: true, data: { message: "Password reset" } };
  },
});

export const adminSystemLockdown = mutation({
  args: {
    token: v.string(),
    enabled: v.boolean(),
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
    await ctx.runMutation(internal.admin.internal.updateAppConfig, {
      updates: { maintenanceMode: args.enabled },
    });
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_system_lockdown",
      details: { enabled: args.enabled },
    });
    return { success: true, data: { message: `System lockdown set to ${args.enabled}` } };
  },
});

export const adminRecordManualPayment = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    amount: v.number(),
    reference: v.string(),
    planName: v.string(),
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
    // Create a manual payment record
    const paymentId = await ctx.db.insert("payments", {
      transactionId: `manual_${args.reference}`,
      amount: args.amount,
      userId: args.userId,
      status: "completed",
      mpesaReceipt: `manual_${args.reference}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // Activate subscription
    const config = await ctx.runQuery(internal.admin.internal.getAppConfig, {});
    const plan = config?.subscriptionPlans.find((p) => p.name === args.planName);
    if (!plan) {
      return { success: false, error: "invalid_plan", message: "Plan not found" };
    }
    const startDate = Date.now();
    const expiryDate = startDate + plan.days * 24 * 60 * 60 * 1000;
    const existingSub = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (existingSub && existingSub.expiryDate > startDate) {
      const newExpiry = existingSub.expiryDate + plan.days * 24 * 60 * 60 * 1000;
      await ctx.db.patch(existingSub._id, { expiryDate: newExpiry, status: "active" });
    } else {
      await ctx.db.insert("subscriptions", {
        userId: args.userId,
        plan: args.planName,
        startDate,
        expiryDate,
        status: "active",
      });
    }
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_record_manual_payment",
      targetId: args.userId,
      details: { amount: args.amount, reference: args.reference, planName: args.planName },
    });
    return { success: true, data: { paymentId, message: "Manual payment recorded and subscription activated" } };
  },
});