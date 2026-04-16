// convex/admin/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

export const adminBroadcastNotification = action({
  args: {
    token: v.string(),
    title: v.string(),
    message: v.string(),
    targetUserIds: v.optional(v.array(v.id("users"))),
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
    // In a real implementation, you would send push notifications, emails, or store in a notifications table.
    // For now, we log the broadcast.
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_broadcast_notification",
      details: { title: args.title, message: args.message, targetUserIds: args.targetUserIds || "all" },
    });
    return { success: true, data: { message: "Notification broadcast logged" } };
  },
});

export const adminExportUserData = action({
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
    const user = await ctx.runQuery(internal.admin.internal.getUserById, { userId: args.userId });
    if (!user) {
      return { success: false, error: "user_not_found", message: "User not found" };
    }
    const examResults = await ctx.db
      .query("examResults")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_userId_status", (q) => q.eq("userId", args.userId))
      .collect();
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_userId_updatedAt", (q) => q.eq("userId", args.userId))
      .collect();
    const exportData = {
      user,
      examResults,
      payments,
      notes,
      exportedAt: Date.now(),
    };
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_export_user_data",
      targetId: args.userId,
      details: { storageId },
    });
    const url = await ctx.storage.getUrl(storageId);
    return { success: true, data: { downloadUrl: url } };
  },
});

export const adminExportPayments = action({
  args: {
    token: v.string(),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
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
    const start = args.startDate || 0;
    const end = args.endDate || Date.now();
    const revenue = await ctx.runQuery(internal.admin.internal.getRevenueData, { startDate: start, endDate: end });
    const csvRows = [["Transaction ID", "Amount", "Status", "Receipt", "User ID", "Created At"]];
    for (const p of revenue.payments) {
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
    await ctx.runMutation(internal.admin.internal.logAuditEntry, {
      actorId: payload.userId,
      action: "admin_export_payments",
      details: { startDate: start, endDate: end, storageId },
    });
    const url = await ctx.storage.getUrl(storageId);
    return { success: true, data: { downloadUrl: url } };
  },
});