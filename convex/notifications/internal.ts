// convex/notifications/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const insertNotification = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    senderId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("notifications", {
      userId: args.userId,
      type: args.type,
      title: args.title,
      message: args.message,
      data: args.data,
      senderId: args.senderId,
      read: false,
      createdAt: Date.now(),
    });
    return id;
  },
});

export const insertNotificationsForUsers = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    senderId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const notifications = args.userIds.map((userId) => ({
      userId,
      type: args.type,
      title: args.title,
      message: args.message,
      data: args.data,
      senderId: args.senderId,
      read: false,
      createdAt: now,
    }));
    let count = 0;
    for (const notif of notifications) {
      await ctx.db.insert("notifications", notif);
      count++;
    }
    return count;
  },
});

export const getNotificationsForUser = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.number(),
    cursor: v.optional(v.id("notifications")),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("notifications")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", args.userId))
      .order("desc");
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    if (args.unreadOnly) {
      query = query.filter((q) => q.eq(q.field("read"), false));
    }
    const items = await query.take(args.limit + 1);
    const hasMore = items.length > args.limit;
    const result = items.slice(0, args.limit);
    const nextCursor = hasMore ? result[result.length - 1]._id : null;
    return { notifications: result, nextCursor, hasMore };
  },
});

export const getUnreadCount = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read", (q) => q.eq("userId", args.userId).eq("read", false))
      .collect();
    return all.length;
  },
});

export const markNotificationRead = internalMutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notif = await ctx.db.get(args.notificationId);
    if (!notif) throw new Error("Notification not found");
    if (notif.read) return; // already read
    await ctx.db.patch(args.notificationId, { read: true });
  },
});

export const markAllNotificationsRead = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read", (q) => q.eq("userId", args.userId).eq("read", false))
      .collect();
    for (const n of unread) {
      await ctx.db.patch(n._id, { read: true });
    }
    return unread.length;
  },
});

export const deleteOldNotifications = internalMutation({
  args: { olderThan: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThan;
    const old = await ctx.db
      .query("notifications")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .collect();
    for (const n of old) {
      await ctx.db.delete(n._id);
    }
    return old.length;
  },
});

// ============================================================
// NEW: Internal query for polling new notifications since a timestamp
// Used by the action getNotificationsSince (R7 compliance)
// ============================================================
export const getNotificationsSince = internalQuery({
  args: { userId: v.id("users"), since: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notifications")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gt(q.field("createdAt"), args.since))
      .order("desc")
      .take(args.limit);
  },
});