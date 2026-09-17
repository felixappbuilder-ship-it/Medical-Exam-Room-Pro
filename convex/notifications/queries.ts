// convex/notifications/queries.ts
import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Helper: verify token and get user (works inside actions)
async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error(result.message);
  const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId: result.data.userId });
  if (!user) throw new Error("User not found");
  return user;
}

// ============================================================
// 1. GET NOTIFICATIONS FOR CURRENT USER (paginated)
//    Includes user‑specific, global, and group notifications.
// ============================================================
export const getNotifications = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("notifications")),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const limit = args.limit || 20;
      const result = await ctx.runQuery(internal.notifications.internal.getNotificationsForUser, {
        userId: user._id,
        limit,
        cursor: args.cursor,
        unreadOnly: args.unreadOnly,
      });
      return {
        success: true,
        data: {
          notifications: result.notifications,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: "fetch_failed",
        message: err.message || "Failed to fetch notifications",
      };
    }
  },
});

// ============================================================
// 2. GET UNREAD COUNT
// ============================================================
export const getUnreadCount = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const count = await ctx.runQuery(internal.notifications.internal.getUnreadCount, {
        userId: user._id,
      });
      return { success: true, data: { count } };
    } catch (err: any) {
      return {
        success: false,
        error: "fetch_failed",
        message: err.message || "Failed to get unread count",
      };
    }
  },
});

// ============================================================
// 3. GET NOTIFICATIONS SINCE A TIMESTAMP (polling)
// ============================================================
export const getNotificationsSince = action({
  args: {
    token: v.string(),
    since: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const limit = args.limit || 20;
      const notifications = await ctx.runQuery(
        internal.notifications.internal.getNotificationsSince,
        {
          userId: user._id,
          since: args.since,
          limit,
        }
      );
      return { success: true, data: { notifications } };
    } catch (err: any) {
      return {
        success: false,
        error: "fetch_failed",
        message: err.message || "Failed to fetch new notifications",
      };
    }
  },
});

// ============================================================
// 4. GET SINGLE NOTIFICATION
//    - If user‑specific: only owner can view.
//    - If global/group: any authenticated user can view.
// ============================================================
export const getNotification = action({
  args: {
    token: v.string(),
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const notification = await ctx.db.get(args.notificationId);
      if (!notification) {
        return {
          success: false,
          error: "not_found",
          message: "Notification not found",
        };
      }

      // Check permissions
      if (notification.userId) {
        // User‑specific: must be the owner
        if (notification.userId !== user._id) {
          return {
            success: false,
            error: "unauthorized",
            message: "You do not own this notification",
          };
        }
      } else {
        // Global/group: any authenticated user can view
        // No additional check needed
      }

      // For global/group, fetch read status
      let enhanced = { ...notification };
      if (!notification.userId) {
        const readEntry = await ctx.db
          .query("notificationReads")
          .withIndex("by_notificationId_userId", (q) =>
            q.eq("notificationId", args.notificationId).eq("userId", user._id)
          )
          .first();
        enhanced.read = readEntry?.read || false;
      }

      return { success: true, data: enhanced };
    } catch (err: any) {
      return {
        success: false,
        error: "fetch_failed",
        message: err.message || "Failed to fetch notification",
      };
    }
  },
});

// ============================================================
// 5. ADMIN: GET ALL NOTIFICATIONS (paginated)
//    Requires admin role.
// ============================================================
export const adminGetAllNotifications = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("notifications")),
    userId: v.optional(v.id("users")), // filter by user (optional)
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      if (user.role !== "admin") {
        return {
          success: false,
          error: "forbidden",
          message: "Admin role required",
        };
      }
      const limit = args.limit || 50;
      const result = await ctx.runQuery(internal.notifications.internal.adminGetAllNotifications, {
        limit,
        cursor: args.cursor,
        userId: args.userId,
      });
      return {
        success: true,
        data: {
          notifications: result.notifications,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: "fetch_failed",
        message: err.message || "Failed to fetch notifications",
      };
    }
  },
});