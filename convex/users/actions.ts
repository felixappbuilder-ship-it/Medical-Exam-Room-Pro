// convex/users/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ============================================================
// EXPORT USER DATA (GDPR compliance)
// ============================================================
export const exportData = action({
  args: {
    token: v.string(), // custom JWT (R8)
  },
  handler: async (ctx, args) => {
    // 1. Verify JWT (R8)
    let payload;
    try {
      payload = await ctx.runAction(internal.auth.helpers.verifyJWT, { token: args.token });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("[exportData] JWT verification failed:", errorMessage);
      return {
        success: false,
        error: "invalid_token",
        message: `Failed to verify authentication token: ${errorMessage}`,
      };
    }

    const userId = payload.userId;

    // 2. Fetch user data using internal queries (R7)
    let user, subscriptions, payments, examResults, notes, conversations;
    try {
      [user, subscriptions, payments, examResults, notes, conversations] = await Promise.all([
        ctx.runQuery(internal.users.internal.getUserById, { userId }),
        ctx.runQuery(internal.subscriptions.internal.getUserSubscriptionHistory, { userId }),
        ctx.runQuery(internal.payments.internal.getUserPaymentHistory, { userId }),
        ctx.runQuery(internal.examResults.internal.getExamResultsByUser, { userId, limit: 1000 }),
        ctx.runQuery(internal.notes.internal.getUserNotesInternal, { userId, limit: 1000 }),
        ctx.runQuery(internal.conversations.internal.getUserConversations, { userId, limit: 1000 }),
      ]);
    } catch (err) {
      console.error("[exportData] Failed to fetch user data:", err);
      return {
        success: false,
        error: "data_fetch_failed",
        message: "Could not retrieve user data.",
      };
    }

    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User account not found.",
      };
    }

    // 3. Build export object (exclude sensitive fields)
    const { passwordHash, securityQuestions, ...safeUser } = user;
    const exportData = {
      profile: safeUser,
      subscriptions: subscriptions || [],
      payments: payments || [],
      examResults: examResults || [],
      notes: notes || [],
      conversations: conversations || [],
      exportedAt: Date.now(),
    };

    // 4. Store JSON as blob in Convex Storage
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const storageId = await ctx.storage.store(blob);
    const downloadUrl = await ctx.storage.getUrl(storageId);

    // 5. Audit log (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "export_data",
      targetId: userId,
      details: { storageId, exportedAt: exportData.exportedAt },
    });

    // 6. Return structured response with download URL (R20)
    return {
      success: true,
      data: {
        downloadUrl,
        fileName: `medical-exam-data-${new Date(exportData.exportedAt).toISOString().split('T')[0]}.json`,
      },
    };
  },
});

// ============================================================
// DELETE DORMANT ACCOUNTS (cron job – runs daily)
// ============================================================
export const deleteDormantAccounts = action({
  args: {},
  handler: async (ctx) => {
    const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;

    // Fetch all users whose lastLogin or lastSeen is older than 6 months
    const users = await ctx.db
      .query("users")
      .filter((q) =>
        q.and(
          q.or(
            q.lt(q.field("lastLogin"), sixMonthsAgo),
            q.lt(q.field("lastSeen"), sixMonthsAgo)
          )
        )
      )
      .collect();

    console.log(`[Cron] Found ${users.length} dormant accounts to delete.`);

    let deletedCount = 0;
    for (const user of users) {
      // Avoid deleting if user has a recent activity
      const hasRecentActivity = (user.lastLogin && user.lastLogin > sixMonthsAgo) ||
                                (user.lastSeen && user.lastSeen > sixMonthsAgo);
      if (hasRecentActivity) continue;

      // Log deletion (audit)
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: "system",
        action: "dormant_account_deleted",
        targetId: user._id,
        details: { email: user.email, lastLogin: user.lastLogin, lastSeen: user.lastSeen },
      });

      // Delete all user data via internal mutation
      await ctx.runMutation(internal.users.internal.deleteAllUserData, { userId: user._id });
      deletedCount++;
    }

    console.log(`[Cron] Deleted ${deletedCount} dormant accounts.`);
    return { deleted: deletedCount };
  },
});