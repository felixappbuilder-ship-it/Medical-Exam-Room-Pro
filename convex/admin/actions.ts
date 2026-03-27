"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";

// -----------------------------------------------------------------------------
// Helper: Ensure user is admin (run in action context)
// -----------------------------------------------------------------------------
async function ensureAdmin(ctx: any): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not authenticated");
  // Need to fetch user from DB; actions can run queries via runQuery
  const user = await ctx.runQuery(internal.users.getProfile); // internal query that returns user by identity
  if (!user || user.role !== "admin") throw new ConvexError("Admin access required");
  return user._id;
}

// -----------------------------------------------------------------------------
// Admin Broadcast Notification
// -----------------------------------------------------------------------------
export const adminBroadcastNotification = action({
  args: {
    title: v.string(),
    message: v.string(),
    target: v.optional(v.union(v.literal("all"), v.literal("active"), v.literal("expired"))),
  },
  handler: async (ctx, args) => {
    const adminId = await ensureAdmin(ctx);

    // In a real implementation, you'd integrate with a push notification service (FCM, OneSignal, etc.)
    // or create in‑app notifications in a `notifications` table.
    // For now, we'll just log and return a placeholder.

    // Log the broadcast attempt
    await ctx.runMutation(internal.admin.logAdminAction, {
      adminId,
      action: "broadcast_notification",
      details: args,
    });

    return {
      success: true,
      message: "Broadcast functionality not fully implemented. This is a placeholder.",
    };
  },
});

// -----------------------------------------------------------------------------
// Admin Trigger Backup
// -----------------------------------------------------------------------------
export const adminTriggerBackup = action({
  args: {},
  handler: async (ctx, args) => {
    const adminId = await ensureAdmin(ctx);

    // Placeholder: In production, you'd trigger a database backup via Convex export or external service.
    // Could call an internal mutation to record backup request in a `backups` table.

    await ctx.runMutation(internal.admin.logAdminAction, {
      adminId,
      action: "trigger_backup",
      details: { timestamp: Date.now() },
    });

    return {
      backupId: `backup_${Date.now()}`,
      message: "Backup triggered (placeholder).",
    };
  },
});

// -----------------------------------------------------------------------------
// Admin Export User Data (for a specific user, GDPR)
// -----------------------------------------------------------------------------
export const adminExportUserData = action({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const adminId = await ensureAdmin(ctx);

    // Fetch all user data using internal queries
    const [user, subscriptions, payments, examResults, notes, conversations] = await Promise.all([
      ctx.runQuery(internal.users.getUserById, { userId: args.userId }),
      ctx.runQuery(internal.subscriptions.getUserSubscriptions, { userId: args.userId }),
      ctx.runQuery(internal.payments.getUserPayments, { userId: args.userId }),
      ctx.runQuery(internal.examResults.getUserExamResults, { userId: args.userId }),
      ctx.runQuery(internal.notes.getUserNotes, { userId: args.userId }),
      ctx.runQuery(internal.conversations.getUserConversations, { userId: args.userId }),
    ]);

    const exportData = {
      profile: user,
      subscriptions,
      payments,
      examResults,
      notes,
      conversations,
      exportedAt: Date.now(),
      exportedBy: adminId,
    };

    // Log the export
    await ctx.runMutation(internal.admin.logAdminAction, {
      adminId,
      action: "export_user_data",
      targetId: args.userId,
      details: { timestamp: Date.now() },
    });

    return exportData;
  },
});

// -----------------------------------------------------------------------------
// Admin Export Payments
// -----------------------------------------------------------------------------
export const adminExportPayments = action({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    format: v.optional(v.union(v.literal("csv"), v.literal("json"))),
  },
  handler: async (ctx, args) => {
    const adminId = await ensureAdmin(ctx);

    const format = args.format || "json";
    const end = args.endDate ?? Date.now();
    const start = args.startDate ?? end - 90 * 24 * 60 * 60 * 1000;

    const payments = await ctx.runQuery(internal.payments.getPaymentsByDateRange, {
      startDate: start,
      endDate: end,
    });

    let result: any;
    if (format === "json") {
      result = payments;
    } else {
      // Convert to CSV
      const headers = ["_id", "userId", "amount", "currency", "status", "mpesaReceipt", "createdAt", "completedAt"];
      const csvRows = [];
      csvRows.push(headers.join(","));
      for (const p of payments) {
        const row = headers.map((h) => `"${p[h] || ""}"`).join(",");
        csvRows.push(row);
      }
      result = csvRows.join("\n");
    }

    await ctx.runMutation(internal.admin.logAdminAction, {
      adminId,
      action: "export_payments",
      details: { startDate: start, endDate: end, format },
    });

    return {
      data: result,
      format,
      filename: `payments_export_${Date.now()}.${format}`,
    };
  },
});

// -----------------------------------------------------------------------------
// Admin Generate Report
// -----------------------------------------------------------------------------
export const adminGenerateReport = action({
  args: {
    type: v.union(v.literal("revenue"), v.literal("users"), v.literal("exams")),
    parameters: v.any(),
    format: v.optional(v.union(v.literal("csv"), v.literal("json"))),
  },
  handler: async (ctx, args) => {
    const adminId = await ensureAdmin(ctx);

    const format = args.format || "json";
    let reportData: any;

    switch (args.type) {
      case "revenue":
        reportData = await ctx.runQuery(internal.admin.getRevenueReport, args.parameters);
        break;
      case "users":
        reportData = await ctx.runQuery(internal.admin.getUserGrowth, args.parameters);
        break;
      case "exams":
        reportData = await ctx.runQuery(internal.admin.getExamPerformance, args.parameters);
        break;
      default:
        throw new ConvexError("Invalid report type");
    }

    // Convert to CSV if requested (simplified)
    if (format === "csv") {
      // For simplicity, we'll just stringify JSON and note that CSV conversion would need more work
      reportData = JSON.stringify(reportData);
    }

    await ctx.runMutation(internal.admin.logAdminAction, {
      adminId,
      action: "generate_report",
      details: { type: args.type, parameters: args.parameters, format },
    });

    return {
      data: reportData,
      format,
      filename: `${args.type}_report_${Date.now()}.${format}`,
    };
  },
});

// -----------------------------------------------------------------------------
// Admin Export Audit Logs
// -----------------------------------------------------------------------------
export const adminExportAuditLogs = action({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    format: v.optional(v.union(v.literal("csv"), v.literal("json"))),
  },
  handler: async (ctx, args) => {
    const adminId = await ensureAdmin(ctx);

    const format = args.format || "json";
    const end = args.endDate ?? Date.now();
    const start = args.startDate ?? end - 90 * 24 * 60 * 60 * 1000;

    const logs = await ctx.runQuery(internal.admin.getAuditLogs, {
      startDate: start,
      endDate: end,
    });

    let result: any;
    if (format === "json") {
      result = logs;
    } else {
      const headers = ["_id", "adminId", "action", "targetId", "details", "timestamp"];
      const csvRows = [];
      csvRows.push(headers.join(","));
      for (const log of logs) {
        const row = headers.map((h) => `"${log[h] || ""}"`).join(",");
        csvRows.push(row);
      }
      result = csvRows.join("\n");
    }

    await ctx.runMutation(internal.admin.logAdminAction, {
      adminId,
      action: "export_audit_logs",
      details: { startDate: start, endDate: end, format },
    });

    return {
      data: result,
      format,
      filename: `audit_logs_${Date.now()}.${format}`,
    };
  },
});