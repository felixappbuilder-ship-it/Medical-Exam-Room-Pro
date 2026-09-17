// convex/notifications/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Helper (R8)
async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error(result.message);
  const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId: result.data.userId });
  if (!user) throw new Error("User not found");
  return user;
}

// ============================================================
// 1. MARK A SINGLE NOTIFICATION AS READ
// ============================================================
export const markNotificationRead = mutation({
  args: {
    token: v.string(),
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const notif = await ctx.db.get(args.notificationId);
    if (!notif) {
      return { success: false, error: "not_found", message: "Notification not found" };
    }

    // For user‑specific notifications, the userId must match.
    // For global/group notifications, any user can mark them read.
    if (notif.userId && notif.userId !== user._id) {
      return { success: false, error: "unauthorized", message: "You do not own this notification" };
    }

    // Use the internal mutation that handles both types.
    await ctx.runMutation(internal.notifications.internal.markNotificationRead, {
      notificationId: args.notificationId,
      userId: user._id,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "mark_notification_read",
      targetId: args.notificationId,
      details: {},
    });
    return { success: true };
  },
});

// ============================================================
// 2. MARK ALL NOTIFICATIONS AS READ
// ============================================================
export const markAllNotificationsRead = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const count = await ctx.runMutation(internal.notifications.internal.markAllNotificationsRead, {
      userId: user._id,
    });
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "mark_all_notifications_read",
      targetId: user._id,
      details: { count },
    });
    return { success: true, data: { count } };
  },
});

// ============================================================
// 3. DELETE A NOTIFICATION (user‑specific only)
// ============================================================
export const deleteNotification = mutation({
  args: {
    token: v.string(),
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const notif = await ctx.db.get(args.notificationId);
    if (!notif) {
      return { success: false, error: "not_found", message: "Notification not found" };
    }

    // Only allow deletion of user‑specific notifications owned by the user.
    if (!notif.userId || notif.userId !== user._id) {
      return {
        success: false,
        error: "unauthorized",
        message: "You cannot delete this notification",
      };
    }

    await ctx.db.delete(args.notificationId);
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "delete_notification",
      targetId: args.notificationId,
      details: {},
    });
    return { success: true };
  },
});