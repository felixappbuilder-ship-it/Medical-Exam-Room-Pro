// convex/admin/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

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
// 1. Broadcast notification (with real notifications + rate limiting)
// ============================================================
export const adminBroadcastNotification = action({
  args: {
    token: v.string(),
    title: v.string(),
    message: v.string(),
    targetUserIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    try {
      // 1. Verify admin (R23)
      const admin = await verifyAdmin(ctx, args.token);

      // 2. Rate limiting for admin broadcasts (R15)
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

      // 3. Determine target users
      let targetUserIds: string[] = [];
      if (args.targetUserIds && args.targetUserIds.length > 0) {
        targetUserIds = args.targetUserIds;
      } else {
        // Fetch all active users
        const allUsers = await ctx.db.query("users").collect();
        targetUserIds = allUsers.map((u) => u._id);
      }

      if (targetUserIds.length === 0) {
        return {
          success: false,
          error: "no_targets",
          message: "No users to broadcast to.",
        };
      }

      // 4. Insert notifications via internal mutation (R7)
      const insertedCount = await ctx.runMutation(
        internal.notifications.internal.insertNotificationsForUsers,
        {
          userIds: targetUserIds,
          type: "admin_broadcast",
          title: args.title,
          message: args.message,
          data: { adminId: admin.userId },
          senderId: admin.userId,
        }
      );

      // 5. Audit log (R16, R23)
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_broadcast_notification",
        details: {
          title: args.title,
          message: args.message,
          targetCount: insertedCount,
          targetUserIds: args.targetUserIds || "all",
        },
      });

      // 6. Structured response (R20)
      return {
        success: true,
        data: {
          delivered: insertedCount,
          message: `Broadcast sent to ${insertedCount} users.`,
        },
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 2. Export user data
// ============================================================
export const adminExportUserData = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const user = await ctx.db.get(args.userId);
      if (!user) throw new Error("User not found");

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
      const subscriptions = await ctx.db
        .query("subscriptions")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .collect();
      const securityEvents = await ctx.db
        .query("securityEvents")
        .withIndex("by_userId_timestamp", (q) => q.eq("userId", args.userId))
        .collect();

      const exportData = {
        user,
        examResults,
        payments,
        notes,
        subscriptions,
        securityEvents,
        exportedAt: Date.now(),
      };

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

// ============================================================
// 3. Export payments as CSV
// ============================================================
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

      const payments = await ctx.db
        .query("payments")
        .filter((q) => q.and(q.gte(q.field("createdAt"), start), q.lte(q.field("createdAt"), end)))
        .collect();

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
// 4. Trigger a full backup
// ============================================================
export const adminTriggerBackup = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);

      // Collect all data (direct ctx.db queries – allowed in actions)
      const [users, payments, subscriptions, examResults, notes, securityEvents, auditLogs] = await Promise.all([
        ctx.db.query("users").collect(),
        ctx.db.query("payments").collect(),
        ctx.db.query("subscriptions").collect(),
        ctx.db.query("examResults").collect(),
        ctx.db.query("notes").collect(),
        ctx.db.query("securityEvents").collect(),
        ctx.db.query("auditLogs").collect(),
      ]);

      // Strip sensitive fields from users
      const safeUsers = users.map((u) => {
        const { passwordHash, securityQuestions, ...safe } = u;
        return safe;
      });

      const backupData = {
        users: safeUsers,
        payments,
        subscriptions,
        examResults,
        notes,
        securityEvents,
        auditLogs,
        exportedAt: Date.now(),
        version: "1.0",
      };

      const jsonString = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const storageId = await ctx.storage.store(blob);
      const downloadUrl = await ctx.storage.getUrl(storageId);

      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_trigger_backup",
        details: {
          storageId,
          recordCounts: {
            users: users.length,
            payments: payments.length,
            subscriptions: subscriptions.length,
          },
        },
      });

      return {
        success: true,
        data: { downloadUrl, message: "Backup created successfully." },
      };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 5. List all agents
// ============================================================
export const adminListAgents = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const limit = args.limit || 50;
      let query = ctx.db.query("users").filter((q) => q.eq(q.field("isAgent"), true));
      if (args.cursor) {
        query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
      }
      const users = await query.take(limit + 1);
      const hasMore = users.length > limit;
      const items = users.slice(0, limit);
      const nextCursor = hasMore ? items[items.length - 1]._id : null;
      // Remove sensitive fields
      const safeUsers = items.map((u) => {
        const { passwordHash, securityQuestions, ...safe } = u;
        return safe;
      });
      await ctx.runMutation(internal.admin.internal.logAuditEntry, {
        actorId: admin.userId,
        action: "admin_list_agents",
        details: { count: items.length },
      });
      return { success: true, data: { agents: safeUsers, nextCursor, hasMore } };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  },
});

// ============================================================
// 6. Verify an agent (set agentVerified = true)
// ============================================================
export const adminVerifyAgent = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const user = await ctx.db.get(args.userId);
      if (!user) throw new Error("User not found");
      if (!user.isAgent) throw new Error("User is not an agent");
      await ctx.db.patch(args.userId, { agentVerified: true });
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

// ============================================================
// 7. Get agent performance stats
// ============================================================
export const adminGetAgentStats = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      const admin = await verifyAdmin(ctx, args.token);
      const user = await ctx.db.get(args.userId);
      if (!user) throw new Error("User not found");
      if (!user.isAgent) throw new Error("User is not an agent");
      // Fetch referrals by this agent
      const referredUsers = await ctx.db
        .query("users")
        .withIndex("by_referredBy", (q) => q.eq("referredBy", args.userId))
        .collect();
      // Count successful subscriptions (completed payments)
      let successfulReferrals = 0;
      for (const u of referredUsers) {
        const payments = await ctx.db
          .query("payments")
          .withIndex("by_userId_status", (q) => q.eq("userId", u._id).eq("status", "completed"))
          .collect();
        if (payments.length > 0) successfulReferrals++;
      }
      // Get total earnings (from user's totalEarned)
      const totalEarned = user.totalEarned || 0;
      const availableBalance = user.referralBalance || 0;
      const pendingBalance = user.pendingBalance || 0;
      const stats = {
        userId: user._id,
        name: user.name,
        email: user.email,
        totalReferrals: referredUsers.length,
        successfulReferrals,
        totalEarned,
        availableBalance,
        pendingBalance,
        verified: user.agentVerified || false,
      };
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