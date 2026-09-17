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

// ============================================================
// 1. USER MANAGEMENT
// ============================================================

// Update a user
export const adminUpdateUser = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    updates: v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      isLocked: v.optional(v.boolean()),
      lockReason: v.optional(v.string()),
      trialUsed: v.optional(v.boolean()),
      isAgent: v.optional(v.boolean()),
      agentVerified: v.optional(v.boolean()),
      role: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.updateUserById, {
        userId: args.userId,
        updates: args.updates,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_update_user",
        targetId: args.userId,
        details: args.updates,
      });
      return { success: true, data: { message: "User updated" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Lock a user
export const adminLockUser = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.lockUser, {
        userId: args.userId,
        reason: args.reason,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_lock_user",
        targetId: args.userId,
        details: { reason: args.reason },
      });
      return { success: true, data: { message: "User locked" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Force logout (increment tokenVersion)
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
      return { success: true, data: { message: "User logged out from all devices" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Reset user password
export const adminResetPassword = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const newHash = await ctx.runAction(internal.auth.helpers.hashPassword, {
        password: args.newPassword,
      });
      await ctx.runMutation(internal.admin.internal.updateUserById, {
        userId: args.userId,
        updates: { passwordHash: newHash },
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_reset_password",
        targetId: args.userId,
        details: {},
      });
      return { success: true, data: { message: "Password reset" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Delete a user (hard delete)
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
      return { success: true, data: { message: "User deleted" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 2. SUBSCRIPTION MANAGEMENT
// ============================================================

// Update a subscription (extend or change plan)
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
      await ctx.runMutation(internal.admin.internal.updateSubscriptionInternal, {
        subscriptionId: sub._id,
        updates,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_update_subscription",
        targetId: sub._id,
        details: { userId: args.userId, extendDays: args.extendDays, plan: args.plan },
      });
      return { success: true, data: { message: "Subscription updated" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Terminate (delete) a subscription
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
      await ctx.runMutation(internal.admin.internal.deleteSubscriptionInternal, {
        subscriptionId: sub._id,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_terminate_subscription",
        targetId: sub._id,
        details: { userId: args.userId },
      });
      return { success: true, data: { message: "Subscription terminated" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Grant a free subscription (create or replace)
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
      return { success: true, data: { message: "Free subscription granted" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 3. PAYMENTS & REFUNDS
// ============================================================

// Record a manual payment (cash/bank) – activates subscription
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
      const paymentId = await ctx.runMutation(internal.payments.internal.createPayment, {
        transactionId: `manual_${args.reference}`,
        amount: args.amount,
        userId: args.userId,
        status: "completed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mpesaReceipt: `manual_${args.reference}`,
      });
      await ctx.runMutation(internal.payments.internal.activateSubscriptionFromPayment, {
        paymentId,
        userId: args.userId,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_record_manual_payment",
        targetId: args.userId,
        details: { amount: args.amount, reference: args.reference, planName: args.planName },
      });
      return { success: true, data: { message: "Manual payment recorded", paymentId } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Process refund (mark payment as refunded)
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
      await ctx.runMutation(internal.admin.internal.updatePaymentInternal, {
        paymentId: args.paymentId,
        updates: { status: "refunded" },
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_process_refund",
        targetId: args.paymentId,
        details: { userId: payment.userId },
      });
      return { success: true, data: { message: "Refund processed" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 4. WITHDRAWALS – ENHANCED
// ============================================================

// Process a single withdrawal (manual or failed with reason)
export const adminProcessWithdrawal = action({
  args: {
    token: v.string(),
    withdrawalId: v.id("withdrawals"),
    status: v.union(v.literal("processed"), v.literal("failed")),
    reason: v.optional(v.string()),
    paymentMethod: v.optional(v.string()), // "cash", "bank", "mpesa_manual", "b2c"
    paymentReference: v.optional(v.string()), // manual transaction code
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.processWithdrawal, {
        withdrawalId: args.withdrawalId,
        status: args.status,
        reason: args.reason,
        paymentMethod: args.paymentMethod,
        paymentReference: args.paymentReference,
        processedBy: payload.userId,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_process_withdrawal",
        targetId: args.withdrawalId,
        details: { status: args.status, paymentMethod: args.paymentMethod, reason: args.reason },
      });
      return { success: true, data: { message: `Withdrawal ${args.status}` } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Process a withdrawal via B2C (auto-send via M-Pesa)
export const adminProcessB2CWithdrawal = action({
  args: {
    token: v.string(),
    withdrawalId: v.id("withdrawals"),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const withdrawal = await ctx.runQuery(internal.admin.internal.getWithdrawalById, {
        withdrawalId: args.withdrawalId,
      });
      if (!withdrawal) throw new Error("Withdrawal not found");
      if (withdrawal.status !== "pending") throw new Error("Withdrawal already processed");

      const user = await ctx.runQuery(internal.admin.internal.getUserById, { userId: withdrawal.userId });
      if (!user) throw new Error("User not found");
      if (!user.phone) throw new Error("User has no phone number");

      // Call B2C API
      const b2cResult = await ctx.runAction(internal.payments.actions.sendB2CPayment, {
        phoneNumber: user.phone,
        amount: withdrawal.amount,
        reason: "Withdrawal",
      });

      if (!b2cResult.success) {
        await ctx.runMutation(internal.admin.internal.processWithdrawal, {
          withdrawalId: args.withdrawalId,
          status: "failed",
          reason: b2cResult.message || "B2C payment failed",
          processedBy: payload.userId,
        });
        return { success: false, message: b2cResult.message || "B2C payment failed" };
      }

      await ctx.runMutation(internal.admin.internal.processWithdrawal, {
        withdrawalId: args.withdrawalId,
        status: "processed",
        paymentMethod: "b2c",
        b2cTransactionId: b2cResult.transactionId,
        b2cResultCode: b2cResult.resultCode,
        b2cResultDesc: b2cResult.resultDesc,
        processedBy: payload.userId,
      });

      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_process_b2c_withdrawal",
        targetId: args.withdrawalId,
        details: { transactionId: b2cResult.transactionId },
      });

      return { success: true, data: { message: "B2C withdrawal processed", transactionId: b2cResult.transactionId } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Bulk approve all pending withdrawals (manual or B2C)
export const adminBulkApproveWithdrawals = action({
  args: {
    token: v.string(),
    mode: v.union(v.literal("manual"), v.literal("b2c")),
    paymentMethod: v.optional(v.string()), // required for manual mode
    paymentReference: v.optional(v.string()), // optional for manual
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      const pending = await ctx.runQuery(internal.admin.internal.getAllPendingWithdrawals, {});
      if (pending.length === 0) {
        return { success: false, message: "No pending withdrawals to process." };
      }

      const results = [];
      if (args.mode === "manual") {
        for (const w of pending) {
          await ctx.runMutation(internal.admin.internal.processWithdrawal, {
            withdrawalId: w._id,
            status: "processed",
            paymentMethod: args.paymentMethod || "cash",
            paymentReference: args.paymentReference || `BULK_${Date.now()}`,
            processedBy: payload.userId,
          });
          results.push(w._id);
        }
        await ctx.runMutation(internal.admin.internal.logAuditEntry, {
          actorId: payload.userId,
          action: "admin_bulk_approve_manual",
          details: { count: results.length, paymentMethod: args.paymentMethod },
        });
        return { success: true, data: { processed: results.length } };
      } else if (args.mode === "b2c") {
        for (const w of pending) {
          const user = await ctx.runQuery(internal.admin.internal.getUserById, { userId: w.userId });
          if (!user || !user.phone) {
            await ctx.runMutation(internal.admin.internal.processWithdrawal, {
              withdrawalId: w._id,
              status: "failed",
              reason: "User has no phone number",
              processedBy: payload.userId,
            });
            continue;
          }
          try {
            const b2cResult = await ctx.runAction(internal.payments.actions.sendB2CPayment, {
              phoneNumber: user.phone,
              amount: w.amount,
              reason: "Withdrawal",
            });
            if (!b2cResult.success) {
              await ctx.runMutation(internal.admin.internal.processWithdrawal, {
                withdrawalId: w._id,
                status: "failed",
                reason: b2cResult.message || "B2C failed",
                processedBy: payload.userId,
              });
            } else {
              await ctx.runMutation(internal.admin.internal.processWithdrawal, {
                withdrawalId: w._id,
                status: "processed",
                paymentMethod: "b2c",
                b2cTransactionId: b2cResult.transactionId,
                b2cResultCode: b2cResult.resultCode,
                b2cResultDesc: b2cResult.resultDesc,
                processedBy: payload.userId,
              });
              results.push(w._id);
            }
          } catch (err) {
            await ctx.runMutation(internal.admin.internal.processWithdrawal, {
              withdrawalId: w._id,
              status: "failed",
              reason: err.message,
              processedBy: payload.userId,
            });
          }
        }
        await ctx.runMutation(internal.admin.internal.logAuditEntry, {
          actorId: payload.userId,
          action: "admin_bulk_approve_b2c",
          details: { count: results.length },
        });
        return { success: true, data: { processed: results.length } };
      } else {
        return { success: false, message: "Invalid mode" };
      }
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Toggle auto-approve for withdrawals (when enabled, new withdrawals are auto-processed via B2C)
export const adminSetAutoApprove = action({
  args: {
    token: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.updateAppConfig, {
        updates: { autoApproveWithdrawals: args.enabled },
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_set_auto_approve",
        details: { enabled: args.enabled },
      });
      return { success: true, data: { message: `Auto-approve ${args.enabled ? 'enabled' : 'disabled'}` } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 5. REVERSALS (refunds)
// ============================================================

// Process a reversal (approve/reject)
export const adminProcessReversal = action({
  args: {
    token: v.string(),
    reversalId: v.id("reversals"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.updateReversalStatus, {
        reversalId: args.reversalId,
        status: args.status,
        reason: args.reason,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_process_reversal",
        targetId: args.reversalId,
        details: { status: args.status, reason: args.reason },
      });
      return { success: true, data: { message: `Reversal ${args.status}` } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 6. AGENTS
// ============================================================

// Verify an agent
export const adminVerifyAgent = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.verifyAgent, { userId: args.userId });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_verify_agent",
        targetId: args.userId,
        details: { agentVerified: true },
      });
      return { success: true, data: { message: "Agent verified" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 7. SYSTEM CONFIGURATION
// ============================================================

// System lockdown (maintenance mode)
export const adminSystemLockdown = action({
  args: {
    token: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.updateAppConfig, {
        updates: { maintenanceMode: args.enabled },
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_system_lockdown",
        details: { enabled: args.enabled },
      });
      return { success: true, data: { message: `Maintenance mode set to ${args.enabled}` } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// Update app config (settings)
export const adminUpdateAppConfig = action({
  args: {
    token: v.string(),
    config: v.object({
      trialDurationHours: v.optional(v.number()),
      maintenanceMode: v.optional(v.boolean()),
      subscriptionPlans: v.optional(
        v.array(v.object({ name: v.string(), price: v.number(), days: v.number() }))
      ),
      paymentsFrozen: v.optional(v.boolean()),
      maxRequestsPerMinute: v.optional(v.number()),
      autoApproveWithdrawals: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    try {
      const payload = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.updateAppConfig, {
        updates: args.config,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: payload.userId,
        action: "admin_update_app_config",
        details: args.config,
      });
      return { success: true, data: { message: "App config updated" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});