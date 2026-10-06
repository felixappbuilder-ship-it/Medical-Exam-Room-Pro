// convex/admin/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import * as notificationTriggers from "../notifications/triggers";

// ============================================================
// HELPER: Verify admin role
// ============================================================
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

export const adminGetAllUsers = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      const result = await ctx.runQuery(internal.admin.internal.getAllUsersPaginated, {
        limit,
        cursor: args.cursor,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_get_all_users",
        details: { limit, cursor: args.cursor },
      });
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

export const adminGetUserDetails = action({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const user = await ctx.runQuery(internal.admin.internal.getUserById, { userId: args.userId });
      if (!user) throw new Error("User not found");
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_get_user_details",
        targetId: args.userId,
        details: {},
      });
      return { success: true, data: { user } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

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
      tokenVersion: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const user = await ctx.runQuery(internal.admin.internal.getUserById, { userId: args.userId });
      if (!user) throw new Error("User not found");

      await ctx.runMutation(internal.admin.internal.updateUserById, {
        userId: args.userId,
        updates: args.updates,
      });

      // Notifications
      if (args.updates.isLocked !== undefined) {
        if (args.updates.isLocked) {
          await notificationTriggers.notifyAdminLockedAccount(
            ctx,
            args.userId,
            args.updates.lockReason || "Policy violation"
          );
        } else {
          await notificationTriggers.notifyAdminUnlockedAccount(ctx, args.userId);
        }
      }
      if (args.updates.role !== undefined && args.updates.role !== user.role) {
        await notificationTriggers.notifyAdminChangedRole(
          ctx,
          args.userId,
          user.role || "user",
          args.updates.role
        );
      }

      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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

export const adminLockUser = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.lockUser, {
        userId: args.userId,
        reason: args.reason,
      });
      await notificationTriggers.notifyAdminLockedAccount(ctx, args.userId, args.reason);
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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

export const adminForceLogout = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      await notificationTriggers.notifyAdminForceLogout(ctx, args.userId);
      const user = await ctx.runQuery(internal.admin.internal.getUserById, { userId: args.userId });
      if (user) {
        const currentVersion = (user as any).tokenVersion || 0;
        await ctx.runMutation(internal.admin.internal.updateUserById, {
          userId: args.userId,
          updates: { tokenVersion: currentVersion + 1 },
        });
      }
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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

export const adminResetPassword = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const newHash = await ctx.runAction(internal.auth.helpers.hashPassword, {
        password: args.newPassword,
      });
      await ctx.runMutation(internal.admin.internal.updateUserById, {
        userId: args.userId,
        updates: { passwordHash: newHash },
      });
      await notificationTriggers.notifyAdminResetPassword(ctx, args.userId);
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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

export const adminDeleteUser = action({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.admin.internal.deleteUserById, { userId: args.userId });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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

export const adminExtendSubscription = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    days: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const subscription = await ctx.runQuery(
        internal.subscriptions.internal.getActiveSubscriptionByUserId,
        { userId: args.userId }
      );
      let newExpiry: number;
      if (subscription && subscription.expiryDate > Date.now()) {
        newExpiry = subscription.expiryDate + args.days * 24 * 60 * 60 * 1000;
        await ctx.runMutation(internal.subscriptions.internal.updateSubscriptionExpiry, {
          subscriptionId: subscription._id,
          expiryDate: newExpiry,
          status: "active",
        });
      } else {
        newExpiry = Date.now() + args.days * 24 * 60 * 60 * 1000;
        await ctx.runMutation(internal.subscriptions.internal.createSubscription, {
          userId: args.userId,
          plan: "admin_extended",
          startDate: Date.now(),
          expiryDate: newExpiry,
          status: "active",
        });
      }
      await notificationTriggers.notifyAdminExtendedSubscription(
        ctx,
        args.userId,
        args.days,
        newExpiry,
        args.reason || "Admin extension"
      );
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_extend_subscription",
        targetId: args.userId,
        details: { days: args.days, newExpiry, reason: args.reason },
      });
      return { success: true, data: { message: `Subscription extended by ${args.days} days` } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

export const adminTerminateSubscription = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const subscription = await ctx.runQuery(
        internal.subscriptions.internal.getActiveSubscriptionByUserId,
        { userId: args.userId }
      );
      if (!subscription) {
        return { success: false, message: "No active subscription found" };
      }
      await ctx.runMutation(internal.subscriptions.internal.cancelSubscriptionById, {
        subscriptionId: subscription._id,
      });
      await notificationTriggers.notifyAdminTerminatedSubscription(
        ctx,
        args.userId,
        args.reason || "Admin termination"
      );
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_terminate_subscription",
        targetId: args.userId,
        details: { reason: args.reason },
      });
      return { success: true, data: { message: "Subscription terminated" } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

export const adminGrantTrial = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    hours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      // Default to config value if hours not passed
      const config = await ctx.runQuery(internal.system.internal.getAppConfig, {});
      const hours = args.hours || config?.trialDurationHours || 24;
      const expiryDate = Date.now() + hours * 60 * 60 * 1000;

      const existingSub = await ctx.runQuery(
        internal.subscriptions.internal.getActiveSubscriptionByUserId,
        { userId: args.userId }
      );
      if (existingSub && existingSub.expiryDate > Date.now()) {
        return { success: false, message: "User already has an active subscription" };
      }

      await ctx.runMutation(internal.subscriptions.internal.createSubscription, {
        userId: args.userId,
        plan: "trial",
        startDate: Date.now(),
        expiryDate,
        status: "active",
      });
      await ctx.runMutation(internal.users.internal.updateUserById, {
        userId: args.userId,
        updates: { trialUsed: false },
      });
      await notificationTriggers.notifyAdminGrantedTrial(ctx, args.userId, hours, expiryDate);
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_grant_trial",
        targetId: args.userId,
        details: { hours, expiryDate },
      });
      return { success: true, data: { message: `Trial granted for ${hours} hours` } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

export const adminGrantFreeSubscription = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    plan: v.string(),
    durationDays: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const startDate = Date.now();
      const expiryDate = startDate + args.durationDays * 24 * 60 * 60 * 1000;
      const existingSub = await ctx.runQuery(
        internal.subscriptions.internal.getActiveSubscriptionByUserId,
        { userId: args.userId }
      );
      if (existingSub) {
        await ctx.runMutation(internal.subscriptions.internal.updateSubscriptionExpiry, {
          subscriptionId: existingSub._id,
          expiryDate,
          status: "active",
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
        actorId: admin.userId,
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
// 3. PAYMENT & REVENUE
// ============================================================

export const adminGetRevenueReport = action({
  args: {
    token: v.string(),
    period: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const now = Date.now();
      let startDate: number;
      switch (args.period) {
        case "day": startDate = now - 24 * 60 * 60 * 1000; break;
        case "week": startDate = now - 7 * 24 * 60 * 60 * 1000; break;
        case "month": startDate = now - 30 * 24 * 60 * 60 * 1000; break;
        case "year": startDate = now - 365 * 24 * 60 * 60 * 1000; break;
      }
      const revenue = await ctx.runQuery(internal.admin.internal.getRevenueData, {
        startDate,
        endDate: now,
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_get_revenue_report",
        details: { period: args.period },
      });
      return { success: true, data: { total: revenue.total, count: revenue.count, period: args.period } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

export const adminGetConversionRates = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const totalUsers = await ctx.runQuery(internal.admin.internal.getTotalUsersCount, {});
      const activeSubs = await ctx.runQuery(internal.admin.internal.getActiveSubscriptionsCount, {});
      const conversionRate = totalUsers > 0 ? (activeSubs / totalUsers) * 100 : 0;
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_get_conversion_rates",
        details: { totalUsers, activeSubs },
      });
      return {
        success: true,
        data: { totalUsers, activeSubscriptions: activeSubs, conversionRate: conversionRate.toFixed(2) },
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

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
      const admin = await verifyAdmin(ctx, args.token);
      const paymentId = await ctx.runMutation(internal.payments.internal.createPayment, {
        transactionId: `manual_${args.reference}`,
        amount: args.amount,
        userId: args.userId,
        status: "completed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mpesaReceipt: `manual_${args.reference}`,
        selectedPlanId: args.planName,
      });
      await ctx.runMutation(internal.payments.internal.activateSubscriptionFromPayment, {
        paymentId,
        userId: args.userId,
      });
      await notificationTriggers.notifyAdminManualPayment(
        ctx,
        args.userId,
        args.amount,
        args.planName,
        args.reference
      );
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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

export const adminProcessRefund = action({
  args: {
    token: v.string(),
    paymentId: v.id("payments"),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const payment = await ctx.runQuery(internal.admin.internal.getPaymentById, { paymentId: args.paymentId });
      if (!payment) throw new Error("Payment not found");
      await ctx.runMutation(internal.admin.internal.updatePaymentInternal, {
        paymentId: args.paymentId,
        updates: { status: "refunded" },
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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

export const adminExportPayments = action({
  args: {
    token: v.string(),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const start = args.startDate || 0;
      const end = args.endDate || Date.now();
      const revenue = await ctx.runQuery(internal.admin.internal.getRevenueData, {
        startDate: start,
        endDate: end,
      });
      const payments = revenue.payments;
      const csvRows = [
        ["Transaction ID", "Amount", "Status", "Receipt", "User ID", "Created At"],
      ];
      for (const p of payments) {
        csvRows.push([
          p.transactionId,
          p.amount.toString(),
          p.status,
          p.mpesaReceipt || "",
          p.userId,
          new Date(p.createdAt).toISOString(),
        ]);
      }
      const csvString = csvRows.map((row) => row.join(",")).join("\n");
      const blob = new Blob([csvString], { type: "text/csv" });
      const storageId = await ctx.storage.store(blob);
      const downloadUrl = await ctx.storage.getUrl(storageId);
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_export_payments",
        details: { startDate: start, endDate: end, storageId },
      });
      return { success: true, data: { downloadUrl } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 4. WITHDRAWALS
// ============================================================

export const adminProcessWithdrawal = action({
  args: {
    token: v.string(),
    withdrawalId: v.id("withdrawals"),
    status: v.union(v.literal("processed"), v.literal("failed")),
    paymentMethod: v.optional(v.string()),
    paymentReference: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const withdrawal = await ctx.runQuery(internal.admin.internal.getWithdrawalById, {
        withdrawalId: args.withdrawalId,
      });
      if (!withdrawal) throw new Error("Withdrawal not found");
      await ctx.runMutation(internal.admin.internal.processWithdrawal, {
        withdrawalId: args.withdrawalId,
        status: args.status,
        reason: args.reason,
        paymentMethod: args.paymentMethod,
        paymentReference: args.paymentReference,
        processedBy: admin.userId,
      });
      if (args.status === "processed") {
        await notificationTriggers.notifyAdminProcessedWithdrawal(
          ctx,
          withdrawal.userId,
          withdrawal.amount,
          args.paymentMethod || "manual"
        );
      } else {
        await notificationTriggers.notifyAdminRejectedWithdrawal(
          ctx,
          withdrawal.userId,
          withdrawal.amount,
          args.reason || "No reason provided"
        );
      }
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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

export const adminProcessB2CWithdrawal = action({
  args: {
    token: v.string(),
    withdrawalId: v.id("withdrawals"),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const withdrawal = await ctx.runQuery(internal.admin.internal.getWithdrawalById, {
        withdrawalId: args.withdrawalId,
      });
      if (!withdrawal) throw new Error("Withdrawal not found");
      if (withdrawal.status !== "pending") throw new Error("Withdrawal already processed");
      const user = await ctx.runQuery(internal.admin.internal.getUserById, { userId: withdrawal.userId });
      if (!user) throw new Error("User not found");
      if (!user.phone) throw new Error("User has no phone number");
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
          processedBy: admin.userId,
        });
        await notificationTriggers.notifyAdminRejectedWithdrawal(
          ctx,
          withdrawal.userId,
          withdrawal.amount,
          b2cResult.message || "B2C payment failed"
        );
        return { success: false, message: b2cResult.message || "B2C payment failed" };
      }
      await ctx.runMutation(internal.admin.internal.processWithdrawal, {
        withdrawalId: args.withdrawalId,
        status: "processed",
        paymentMethod: "b2c",
        b2cTransactionId: b2cResult.transactionId,
        b2cResultCode: b2cResult.resultCode,
        b2cResultDesc: b2cResult.resultDesc,
        processedBy: admin.userId,
      });
      await notificationTriggers.notifyAdminProcessedWithdrawal(
        ctx,
        withdrawal.userId,
        withdrawal.amount,
        "B2C M-Pesa"
      );
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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

export const adminBulkApproveWithdrawals = action({
  args: {
    token: v.string(),
    mode: v.union(v.literal("manual"), v.literal("b2c")),
    paymentMethod: v.optional(v.string()),
    paymentReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
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
            processedBy: admin.userId,
          });
          results.push(w._id);
          await notificationTriggers.notifyAdminProcessedWithdrawal(
            ctx,
            w.userId,
            w.amount,
            args.paymentMethod || "cash"
          );
        }
        await ctx.runMutation(internal.admin.internal.logAuditEntry, {
          actorId: admin.userId,
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
              processedBy: admin.userId,
            });
            await notificationTriggers.notifyAdminRejectedWithdrawal(
              ctx,
              w.userId,
              w.amount,
              "User has no phone number"
            );
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
                processedBy: admin.userId,
              });
              await notificationTriggers.notifyAdminRejectedWithdrawal(
                ctx,
                w.userId,
                w.amount,
                b2cResult.message || "B2C failed"
              );
            } else {
              await ctx.runMutation(internal.admin.internal.processWithdrawal, {
                withdrawalId: w._id,
                status: "processed",
                paymentMethod: "b2c",
                b2cTransactionId: b2cResult.transactionId,
                b2cResultCode: b2cResult.resultCode,
                b2cResultDesc: b2cResult.resultDesc,
                processedBy: admin.userId,
              });
              results.push(w._id);
              await notificationTriggers.notifyAdminProcessedWithdrawal(
                ctx,
                w.userId,
                w.amount,
                "B2C M-Pesa"
              );
            }
          } catch (err: any) {
            await ctx.runMutation(internal.admin.internal.processWithdrawal, {
              withdrawalId: w._id,
              status: "failed",
              reason: err.message,
              processedBy: admin.userId,
            });
            await notificationTriggers.notifyAdminRejectedWithdrawal(
              ctx,
              w.userId,
              w.amount,
              err.message
            );
          }
        }
        await ctx.runMutation(internal.admin.internal.logAuditEntry, {
          actorId: admin.userId,
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

export const adminSetAutoApprove = action({
  args: {
    token: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      await ctx.runMutation(internal.system.internal.updateAppConfigInternal, {
        updates: { autoApproveWithdrawals: args.enabled },
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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
// 5. REVERSALS
// ============================================================

export const adminProcessReversal = action({
  args: {
    token: v.string(),
    reversalId: v.id("reversals"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const reversal = await ctx.runQuery(internal.admin.internal.getReversalById, {
        reversalId: args.reversalId,
      });
      if (!reversal) throw new Error("Reversal not found");
      await ctx.runMutation(internal.admin.internal.updateReversalStatus, {
        reversalId: args.reversalId,
        status: args.status,
        reason: args.reason,
      });
      if (args.status === "completed") {
        await notificationTriggers.notifyAdminProcessedReversal(
          ctx,
          reversal.userId,
          reversal.amount,
          reversal.transactionID
        );
      } else {
        await notificationTriggers.notifyAdminRejectedReversal(
          ctx,
          reversal.userId,
          reversal.amount,
          args.reason || "No reason provided"
        );
      }
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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
// 6. SYSTEM & CONFIG
// ============================================================

export const adminSystemLockdown = action({
  args: {
    token: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      if (args.enabled) {
        await notificationTriggers.notifyAdminSystemLockdown(ctx, "System is now in maintenance mode");
      } else {
        await notificationTriggers.notifyAdminSystemLockdown(ctx, "System is back online");
      }
      await ctx.runMutation(internal.system.internal.updateAppConfigInternal, {
        updates: { maintenanceMode: args.enabled },
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_system_lockdown",
        details: { enabled: args.enabled },
      });
      return { success: true, data: { message: `Maintenance mode set to ${args.enabled}` } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ------------------------------------------------------------
// ADMIN: UPDATE APP CONFIG (full schema, admin-editable pricing)
// ------------------------------------------------------------
export const adminUpdateAppConfig = action({
  args: {
    token: v.string(),
    updates: v.object({
      trialDurationHours: v.optional(v.number()),
      maintenanceMode: v.optional(v.boolean()),
      paymentsFrozen: v.optional(v.boolean()),
      maxRequestsPerMinute: v.optional(v.number()),
      autoApproveWithdrawals: v.optional(v.boolean()),
      challengeWinnerPoints: v.optional(v.number()),
      twoDeviceDiscountPercent: v.optional(v.number()),
      customPenaltyPerDay: v.optional(v.number()),
      maxDevicesPerSubscription: v.optional(v.number()),
      subscriptionPlans: v.optional(
        v.array(
          v.object({
            id: v.string(),
            name: v.string(),
            price: v.number(),
            days: v.number(),
            popular: v.optional(v.boolean()),
            features: v.array(v.string()),
            limitations: v.optional(v.array(v.string())),
            savings: v.optional(v.string()),
            ctaText: v.optional(v.string()),
            ctaColor: v.optional(v.string()),
            durationText: v.optional(v.string()),
          })
        )
      ),
    }),
    reason: v.optional(v.string()),
    notifyUsers: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const u = args.updates;

      // ---- Validation ----
      if (u.trialDurationHours !== undefined) {
        if (u.trialDurationHours < 1 || u.trialDurationHours > 720) {
          return {
            success: false,
            error: "invalid_trial_duration",
            message: "Trial duration must be between 1 and 720 hours (30 days).",
          };
        }
      }
      if (u.twoDeviceDiscountPercent !== undefined) {
        if (u.twoDeviceDiscountPercent < 0 || u.twoDeviceDiscountPercent > 90) {
          return {
            success: false,
            error: "invalid_discount",
            message: "Two-device discount must be between 0% and 90%.",
          };
        }
      }
      if (u.customPenaltyPerDay !== undefined) {
        if (u.customPenaltyPerDay < 0 || u.customPenaltyPerDay > 100) {
          return {
            success: false,
            error: "invalid_penalty",
            message: "Custom penalty per day must be between 0 and 100 KES.",
          };
        }
      }
      if (u.maxDevicesPerSubscription !== undefined) {
        if (u.maxDevicesPerSubscription < 1 || u.maxDevicesPerSubscription > 10) {
          return {
            success: false,
            error: "invalid_max_devices",
            message: "Max devices per subscription must be between 1 and 10.",
          };
        }
      }
      if (u.maxRequestsPerMinute !== undefined) {
        if (u.maxRequestsPerMinute < 1 || u.maxRequestsPerMinute > 1000) {
          return {
            success: false,
            error: "invalid_rate_limit",
            message: "Max requests per minute must be between 1 and 1000.",
          };
        }
      }

      if (u.subscriptionPlans !== undefined) {
        if (u.subscriptionPlans.length === 0) {
          return {
            success: false,
            error: "invalid_plans",
            message: "At least one subscription plan is required.",
          };
        }
        const validPlanIds = new Set(["monthly", "quarterly", "yearly"]);
        const seenIds = new Set<string>();
        for (const plan of u.subscriptionPlans) {
          if (!validPlanIds.has(plan.id)) {
            return {
              success: false,
              error: "invalid_plan_id",
              message: `Invalid plan ID "${plan.id}". Allowed: monthly, quarterly, yearly.`,
            };
          }
          if (seenIds.has(plan.id)) {
            return {
              success: false,
              error: "duplicate_plan_id",
              message: `Duplicate plan ID "${plan.id}".`,
            };
          }
          seenIds.add(plan.id);
          if (plan.price <= 0) {
            return {
              success: false,
              error: "invalid_plan_price",
              message: `Plan "${plan.id}" price must be greater than 0.`,
            };
          }
          if (plan.days <= 0) {
            return {
              success: false,
              error: "invalid_plan_days",
              message: `Plan "${plan.id}" days must be greater than 0.`,
            };
          }
        }
      }

      // ---- Ensure config exists ----
      await ctx.runMutation(internal.system.internal.ensureAppConfig, {});

      // ---- Snapshot old config ----
      const previousConfig = await ctx.runQuery(internal.system.internal.getAppConfig, {});
      if (!previousConfig) {
        return { success: false, error: "config_missing", message: "AppConfig could not be initialised." };
      }

      // ---- Apply update ----
      await ctx.runMutation(internal.system.internal.updateAppConfigInternal, {
        updates: args.updates,
      });

      // ---- Read new config ----
      const newConfig = await ctx.runQuery(internal.system.internal.getAppConfig, {});

      // ---- Audit log ----
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_update_app_config",
        targetId: "appConfig",
        details: {
          reason: args.reason ?? "No reason provided",
          changedFields: Object.keys(args.updates),
          previous: {
            trialDurationHours: previousConfig.trialDurationHours,
            twoDeviceDiscountPercent: previousConfig.twoDeviceDiscountPercent,
            customPenaltyPerDay: previousConfig.customPenaltyPerDay,
            maxDevicesPerSubscription: previousConfig.maxDevicesPerSubscription,
            maintenanceMode: previousConfig.maintenanceMode,
            paymentsFrozen: previousConfig.paymentsFrozen,
            subscriptionPlans: previousConfig.subscriptionPlans.map((p) => ({
              id: p.id,
              price: p.price,
              days: p.days,
            })),
          },
          updated: args.updates,
        },
      });

      // ---- Optional broadcast ----
      if (args.notifyUsers && (u.subscriptionPlans || u.trialDurationHours !== undefined)) {
        const bodyParts: string[] = [];
        if (u.trialDurationHours !== undefined) {
          bodyParts.push(`Trial duration is now <strong>${u.trialDurationHours} hours</strong>.`);
        }
        if (u.subscriptionPlans) {
          bodyParts.push("New subscription prices are live. Check the subscription page for details.");
        }
        await notificationTriggers.notifyAdminBroadcastToAll(
          ctx,
          "Subscription Update",
          `<p>${bodyParts.join(" ")}</p>
           <button class="btn-primary notif-action-btn" data-action="navigate" data-route="subscription">View Plans</button>`,
          admin.userId
        );
      }

      return {
        success: true,
        data: {
          message: "App configuration updated successfully.",
          config: newConfig
            ? {
                trialDurationHours: newConfig.trialDurationHours,
                maintenanceMode: newConfig.maintenanceMode,
                paymentsFrozen: newConfig.paymentsFrozen,
                maxRequestsPerMinute: newConfig.maxRequestsPerMinute,
                autoApproveWithdrawals: newConfig.autoApproveWithdrawals ?? false,
                challengeWinnerPoints: newConfig.challengeWinnerPoints ?? 10,
                twoDeviceDiscountPercent: newConfig.twoDeviceDiscountPercent ?? 15,
                customPenaltyPerDay: newConfig.customPenaltyPerDay ?? 1.75,
                maxDevicesPerSubscription: newConfig.maxDevicesPerSubscription ?? 2,
                subscriptionPlans: newConfig.subscriptionPlans,
              }
            : null,
        },
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 7. NOTIFICATIONS (with targeting)
// ============================================================

export const adminBroadcastNotification = action({
  args: {
    token: v.string(),
    title: v.string(),
    message: v.string(),
    target: v.optional(v.union(v.literal("all"), v.literal("subscribed"), v.literal("trial"), v.literal("specific"))),
    targetUserIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const now = Date.now();
      const resetAt = now + 60 * 1000;
      const rateKey = `admin_broadcast_${admin.userId}`;
      const rateRecord = await ctx.runQuery(internal.auth.internal.getRateLimit, {
        key: rateKey,
        endpoint: "admin_broadcast",
      });
      if (rateRecord && rateRecord.count >= 5 && rateRecord.resetAt > now) {
        return {
          success: false,
          error: "rate_limit_exceeded",
          message: "Too many broadcasts. Please wait a minute.",
        };
      }
      await ctx.runMutation(internal.auth.internal.incrementRateLimit, {
        key: rateKey,
        endpoint: "admin_broadcast",
        resetAt,
      });

      const target = args.target || "all";

      if (target === "specific") {
        if (!args.targetUserIds || args.targetUserIds.length === 0) {
          return {
            success: false,
            error: "no_targets",
            message: "Please select at least one user for specific targeting.",
          };
        }
        await notificationTriggers.notifyAdminBroadcastToUsers(
          ctx,
          args.targetUserIds,
          args.title,
          args.message,
          admin.userId
        );
        await ctx.runMutation(internal.admin.internal.logAuditEntry, {
          actorId: admin.userId,
          action: "admin_broadcast_notification",
          details: {
            title: args.title,
            message: args.message,
            target,
            targetCount: args.targetUserIds.length,
          },
        });
        return {
          success: true,
          data: { delivered: args.targetUserIds.length, message: `Broadcast sent to ${args.targetUserIds.length} users.` },
        };
      }

      if (target === "all") {
        await notificationTriggers.notifyAdminBroadcastToAll(
          ctx,
          args.title,
          args.message,
          admin.userId
        );
        await ctx.runMutation(internal.admin.internal.logAuditEntry, {
          actorId: admin.userId,
          action: "admin_broadcast_notification",
          details: {
            title: args.title,
            message: args.message,
            target,
            targetCount: "all",
          },
        });
        return {
          success: true,
          data: { delivered: "all", message: "Broadcast sent to all users." },
        };
      }

      let groupName = "";
      if (target === "subscribed") groupName = "subscribed";
      else if (target === "trial") groupName = "trial";
      else {
        return {
          success: false,
          error: "invalid_target",
          message: `Unsupported target: ${target}`,
        };
      }

      await notificationTriggers.notifyAdminBroadcastToGroup(
        ctx,
        groupName,
        args.title,
        args.message,
        admin.userId
      );

      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_broadcast_notification",
        details: {
          title: args.title,
          message: args.message,
          target,
          targetGroup: groupName,
        },
      });

      return {
        success: true,
        data: { delivered: "group", message: `Broadcast sent to ${target} users.` },
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 8. AGENTS
// ============================================================

export const adminVerifyAgent = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      await notificationTriggers.notifyAdminVerifiedAgent(ctx, args.userId);
      await ctx.runMutation(internal.admin.internal.verifyAgent, { userId: args.userId });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
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

export const adminGetAgentStats = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const user = await ctx.runQuery(internal.admin.internal.getUserById, { userId: args.userId });
      if (!user) throw new Error("User not found");
      if (!user.isAgent) throw new Error("User is not an agent");
      const stats = await ctx.runQuery(internal.admin.internal.getAgentStats, { userId: args.userId });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_get_agent_stats",
        targetId: args.userId,
        details: { stats },
      });
      return { success: true, data: stats };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 9. DATA EXPORT & BACKUP
// ============================================================

export const adminExportUserData = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const exportData = await ctx.runQuery(internal.admin.internal.exportUserData, {
        userId: args.userId,
      });
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const storageId = await ctx.storage.store(blob);
      const downloadUrl = await ctx.storage.getUrl(storageId);
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_export_user_data",
        targetId: args.userId,
        details: { storageId },
      });
      return { success: true, data: { downloadUrl } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

export const adminTriggerBackup = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const backupData = await ctx.runQuery(internal.admin.internal.getBackupData, {});
      const jsonString = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const storageId = await ctx.storage.store(blob);
      const downloadUrl = await ctx.storage.getUrl(storageId);
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_trigger_backup",
        details: { storageId, recordCounts: backupData.recordCounts },
      });
      return { success: true, data: { downloadUrl, message: "Backup created successfully." } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});