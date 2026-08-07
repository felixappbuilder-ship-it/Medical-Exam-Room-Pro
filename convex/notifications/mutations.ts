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
    if (notif.userId !== user._id) {
      return { success: false, error: "unauthorized", message: "You do not own this notification" };
    }
    await ctx.runMutation(internal.notifications.internal.markNotificationRead, {
      notificationId: args.notificationId,
    });
    // Audit log (R16) – not required for user action, but we log it
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "mark_notification_read",
      targetId: args.notificationId,
      details: {},
    });
    return { success: true };
  },
});

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

// Optional: delete a notification (if frontend allows)
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
    if (notif.userId !== user._id) {
      return { success: false, error: "unauthorized", message: "You do not own this notification" };
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