// convex/admin/mutations.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

async function verifyAdmin(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error("Invalid token: " + (result.message || ""));
  const payload = result.data;
  if (payload.role !== "admin") throw new Error("Unauthorized: Admin role required");
  return payload;
}

// ------------------------------------------------------------------
// 1. Update a user
// ------------------------------------------------------------------
export const adminUpdateUser = action({
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
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.updateUserById, { userId: args.userId, updates: args.updates });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_update_user",
        targetId: args.userId,
        details: args.updates,
      });
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 2. Lock a user
// ------------------------------------------------------------------
export const adminLockUser = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
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
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 3. Force logout (increment tokenVersion)
// ------------------------------------------------------------------
export const adminForceLogout = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const user = await ctx.runQuery(internal.admin.internal.getUserById, { userId: args.userId });
      if (!user) throw new Error("User not found");
      const currentVersion = (user as any).tokenVersion || 0;
      await ctx.runMutation(internal.admin.internal.updateUserById, {
        userId: args.userId,
        updates: { tokenVersion: currentVersion + 1 },
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_force_logout",
        targetId: args.userId,
        details: {},
      });
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 4. Reset user password
// ------------------------------------------------------------------
export const adminResetPassword = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const newHash = await ctx.runAction(internal.auth.helpers.hashPassword, { password: args.newPassword });
      await ctx.runMutation(internal.admin.internal.updateUserById, { userId: args.userId, updates: { passwordHash: newHash } });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_reset_password",
        targetId: args.userId,
        details: {},
      });
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 5. Delete a user
// ------------------------------------------------------------------
export const adminDeleteUser = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.deleteUserById, { userId: args.userId });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_delete_user",
        targetId: args.userId,
        details: {},
      });
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 6. Update a subscription (extend or change plan)
// ------------------------------------------------------------------
export const adminUpdateSubscription = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    extendDays: v.optional(v.number()),
    plan: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const sub = await ctx.runQuery(internal.subscriptions.internal.getActiveSubscriptionByUserId, {
        userId: args.userId,
      });
      if (!sub) throw new Error("No active subscription found for this user");
      const updates: any = {};
      if (args.plan) updates.plan = args.plan;
      if (args.extendDays) {
        updates.expiryDate = (sub.expiryDate || Date.now()) + args.extendDays * 24 * 60 * 60 * 1000;
        updates.status = "active";
      }
      await ctx.runMutation(internal.admin.internal.updateSubscriptionInternal, { subscriptionId: sub._id, updates });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_update_subscription",
        targetId: sub._id,
        details: { userId: args.userId, extendDays: args.extendDays, plan: args.plan },
      });
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 7. Terminate (delete) a subscription
// ------------------------------------------------------------------
export const adminTerminateSubscription = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const sub = await ctx.runQuery(internal.subscriptions.internal.getActiveSubscriptionByUserId, {
        userId: args.userId,
      });
      if (!sub) throw new Error("No active subscription found for this user");
      await ctx.runMutation(internal.admin.internal.deleteSubscriptionInternal, { subscriptionId: sub._id });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_terminate_subscription",
        targetId: sub._id,
        details: { userId: args.userId },
      });
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 8. Grant a free subscription (create or replace)
// ------------------------------------------------------------------
export const adminGrantFreeSubscription = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    plan: v.string(),
    durationDays: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const startDate = Date.now();
      const expiryDate = startDate + args.durationDays * 24 * 60 * 60 * 1000;
      const existingSub = await ctx.runQuery(internal.subscriptions.internal.getActiveSubscriptionByUserId, {
        userId: args.userId,
      });
      if (existingSub) {
        await ctx.runMutation(internal.admin.internal.updateSubscriptionInternal, {
          subscriptionId: existingSub._id,
          updates: { plan: args.plan, expiryDate, status: "active" },
        });
      } else {
        await ctx.runMutation(internal.subscriptions.internal.createSubscription, {
          userId: args.userId,
          plan: args.plan,
          startDate,
          expiryDate,
          status: "active",
        });
      }
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_grant_free_subscription",
        targetId: args.userId,
        details: { plan: args.plan, durationDays: args.durationDays },
      });
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 9. Record a manual payment
// ------------------------------------------------------------------
export const adminRecordManualPayment = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    amount: v.number(),
    reference: v.string(),
    planName: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      // Create payment record directly via ctx.db (allowed in actions)
      const paymentId = await ctx.db.insert("payments", {
        transactionId: `manual_${args.reference}`,
        amount: args.amount,
        userId: args.userId,
        status: "completed",
        mpesaReceipt: `manual_${args.reference}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const config = await ctx.runQuery(internal.admin.internal.getAppConfig, {});
      const plan = config?.subscriptionPlans.find((p: any) => p.name === args.planName);
      if (!plan) throw new Error("Plan not found");
      const startDate = Date.now();
      const expiryDate = startDate + plan.days * 24 * 60 * 60 * 1000;
      const existingSub = await ctx.runQuery(internal.subscriptions.internal.getActiveSubscriptionByUserId, {
        userId: args.userId,
      });
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
      return { success: true, data: { paymentId } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 10. Process refund (mark payment as refunded)
// ------------------------------------------------------------------
export const adminProcessRefund = action({
  args: {
    token: v.string(),
    paymentId: v.id("payments"),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const payment = await ctx.runQuery(internal.admin.internal.getPaymentById, { paymentId: args.paymentId });
      if (!payment) throw new Error("Payment not found");
      await ctx.runMutation(internal.admin.internal.updatePaymentInternal, { paymentId: args.paymentId, updates: { status: "refunded" } });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_process_refund",
        targetId: args.paymentId,
        details: { userId: payment.userId },
      });
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 11. System lockdown (maintenance mode)
// ------------------------------------------------------------------
export const adminSystemLockdown = action({
  args: {
    token: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.updateAppConfig, { updates: { maintenanceMode: args.enabled } });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_system_lockdown",
        details: { enabled: args.enabled },
      });
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------------
// 12. Update app config (settings)
// ------------------------------------------------------------------
export const adminUpdateAppConfig = action({
  args: {
    token: v.string(),
    config: v.object({
      trialDurationHours: v.optional(v.number()),
      maintenanceMode: v.optional(v.boolean()),
      subscriptionPlans: v.optional(v.array(v.object({ name: v.string(), price: v.number(), days: v.number() }))),
      paymentsFrozen: v.optional(v.boolean()),
      maxRequestsPerMinute: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.updateAppConfig, { updates: args.config });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_update_app_config",
        details: args.config,
      });
      return { success: true, data: {} };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});