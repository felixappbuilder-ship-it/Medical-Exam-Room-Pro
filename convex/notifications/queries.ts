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

export const getNotifications = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("notifications")),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
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
  },
});

export const getUnreadCount = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const count = await ctx.runQuery(internal.notifications.internal.getUnreadCount, {
      userId: user._id,
    });
    return { success: true, data: { count } };
  },
});

export const getNotificationsSince = action({
  args: {
    token: v.string(),
    userId: v.id("users"),
    since: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    if (user._id !== args.userId) {
      throw new Error("Unauthorized: token does not match user");
    }
    const limit = args.limit || 20;
    // ✅ Use internal query instead of direct ctx.db (R7)
    const notifications = await ctx.runQuery(
      internal.notifications.internal.getNotificationsSince,
      {
        userId: args.userId,
        since: args.since,
        limit,
      }
    );
    return { success: true, data: notifications };
  },
});