// convex/notifications/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// 1. INSERT USER-SPECIFIC NOTIFICATION
// ============================================================
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
      targetAll: false,
      targetGroups: [],
      createdAt: Date.now(),
    });
    return id;
  },
});

// ============================================================
// 2. INSERT NOTIFICATIONS FOR SPECIFIC USERS (user-specific)
// ============================================================
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
    let count = 0;
    for (const userId of args.userIds) {
      await ctx.db.insert("notifications", {
        userId,
        type: args.type,
        title: args.title,
        message: args.message,
        data: args.data,
        senderId: args.senderId,
        targetAll: false,
        targetGroups: [],
        createdAt: now,
      });
      count++;
    }
    return count;
  },
});

// ============================================================
// 3. INSERT GLOBAL NOTIFICATION (single document, no userId)
// ============================================================
export const insertGlobalNotification = internalMutation({
  args: {
    type: v.string(),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    senderId: v.optional(v.id("users")),
    targetAll: v.optional(v.boolean()),
    targetGroups: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("notifications", {
      userId: undefined,
      type: args.type,
      title: args.title,
      message: args.message,
      data: args.data,
      senderId: args.senderId,
      targetAll: args.targetAll ?? true,
      targetGroups: args.targetGroups ?? [],
      createdAt: Date.now(),
    });
    return id;
  },
});

// ============================================================
// 4. INSERT NOTIFICATION FOR GROUP (e.g., "subscribed", "free")
// ============================================================
export const insertGroupNotification = internalMutation({
  args: {
    groupName: v.string(),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    senderId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("notifications", {
      userId: undefined,
      type: args.type,
      title: args.title,
      message: args.message,
      data: args.data,
      senderId: args.senderId,
      targetAll: false,
      targetGroups: [args.groupName],
      createdAt: Date.now(),
    });
    return id;
  },
});

// ============================================================
// 5. QUERY NOTIFICATIONS FOR USER (user-specific + global/group)
// ============================================================
export const getNotificationsForUser = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.number(),
    cursor: v.optional(v.id("notifications")),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Fetch all notifications that are either:
    // - user-specific (userId == args.userId)
    // - global (targetAll == true)
    // - group (targetGroups contains a group the user belongs to)
    // For simplicity, we'll first fetch all global and group notifications,
    // then join with user-specific ones.

    // Step 1: Fetch user-specific notifications
    let userQuery = ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc");
    if (args.cursor) {
      userQuery = userQuery.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const userNotifs = await userQuery.take(args.limit + 1);

    // Step 2: Fetch global notifications
    let globalQuery = ctx.db
      .query("notifications")
      .filter((q) => q.eq(q.field("targetAll"), true))
      .order("desc");
    const globalNotifs = await globalQuery.take(args.limit + 1);

    // Step 3: Fetch group notifications (if user belongs to any groups)
    // For now, we'll assume we know the user's groups. In production, we'd fetch from user record.
    // We'll fetch all group notifications and filter later.
    let groupQuery = ctx.db
      .query("notifications")
      .filter((q) => q.and(
        q.eq(q.field("targetAll"), false),
        q.isNotNull(q.field("targetGroups")),
        q.gt(q.field("targetGroups"), [])
      ))
      .order("desc");
    const groupNotifs = await groupQuery.take(args.limit + 1);

    // Combine and sort by createdAt desc
    const allNotifs = [...userNotifs, ...globalNotifs, ...groupNotifs];
    allNotifs.sort((a, b) => b.createdAt - a.createdAt);

    // Apply cursor again after merge (if needed)
    let final = allNotifs;
    if (args.cursor) {
      const cursorIdx = final.findIndex(n => n._id === args.cursor);
      if (cursorIdx !== -1) final = final.slice(cursorIdx + 1);
    }

    // Paginate
    const hasMore = final.length > args.limit;
    const result = final.slice(0, args.limit);
    const nextCursor = hasMore ? result[result.length - 1]._id : null;

    // For each notification, determine read status
    const enhanced = await Promise.all(
      result.map(async (notif) => {
        if (notif.userId) {
          // User-specific: read flag is on the notification itself
          return { ...notif, read: (notif as any).read || false };
        } else {
          // Global/group: read status from notificationReads
          const readEntry = await ctx.db
            .query("notificationReads")
            .withIndex("by_notificationId_userId", (q) =>
              q.eq("notificationId", notif._id).eq("userId", args.userId)
            )
            .first();
          return { ...notif, read: readEntry?.read || false };
        }
      })
    );

    // Apply unreadOnly filter
    const filtered = args.unreadOnly ? enhanced.filter(n => !n.read) : enhanced;

    return {
      notifications: filtered,
      nextCursor,
      hasMore,
    };
  },
});

// ============================================================
// 6. GET UNREAD COUNT
// ============================================================
export const getUnreadCount = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Unread user-specific
    const userUnread = await ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("read"), false))
      .collect();

    // Unread global/group
    const globalNotifs = await ctx.db
      .query("notifications")
      .filter((q) => q.or(
        q.eq(q.field("targetAll"), true),
        q.gt(q.field("targetGroups"), [])
      ))
      .collect();

    let globalUnread = 0;
    for (const n of globalNotifs) {
      const readEntry = await ctx.db
        .query("notificationReads")
        .withIndex("by_notificationId_userId", (q) =>
          q.eq("notificationId", n._id).eq("userId", args.userId)
        )
        .first();
      if (!readEntry || !readEntry.read) globalUnread++;
    }

    return userUnread.length + globalUnread;
  },
});

// ============================================================
// 7. GET NOTIFICATIONS SINCE TIMESTAMP
// ============================================================
export const getNotificationsSince = internalQuery({
  args: { userId: v.id("users"), since: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    // Simplified: get user-specific + global/group since timestamp
    const userNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gt(q.field("createdAt"), args.since))
      .order("desc")
      .take(args.limit);

    const globalNotifs = await ctx.db
      .query("notifications")
      .filter((q) => q.and(
        q.or(
          q.eq(q.field("targetAll"), true),
          q.gt(q.field("targetGroups"), [])
        ),
        q.gt(q.field("createdAt"), args.since)
      ))
      .order("desc")
      .take(args.limit);

    const all = [...userNotifs, ...globalNotifs];
    all.sort((a, b) => b.createdAt - a.createdAt);
    return all.slice(0, args.limit);
  },
});

// ============================================================
// 8. MARK NOTIFICATION READ (handles both types)
// ============================================================
export const markNotificationRead = internalMutation({
  args: { notificationId: v.id("notifications"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const notif = await ctx.db.get(args.notificationId);
    if (!notif) throw new Error("Notification not found");

    if (notif.userId) {
      // User-specific: patch read flag
      if (!(notif as any).read) {
        await ctx.db.patch(args.notificationId, { read: true });
      }
    } else {
      // Global/group: upsert into notificationReads
      const existing = await ctx.db
        .query("notificationReads")
        .withIndex("by_notificationId_userId", (q) =>
          q.eq("notificationId", args.notificationId).eq("userId", args.userId)
        )
        .first();
      if (existing) {
        if (!existing.read) {
          await ctx.db.patch(existing._id, { read: true, readAt: Date.now() });
        }
      } else {
        await ctx.db.insert("notificationReads", {
          notificationId: args.notificationId,
          userId: args.userId,
          read: true,
          readAt: Date.now(),
        });
      }
    }
  },
});

// ============================================================
// 9. MARK ALL NOTIFICATIONS READ
// ============================================================
export const markAllNotificationsRead = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Mark user-specific notifications as read
    const userNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("read"), false))
      .collect();
    for (const n of userNotifs) {
      await ctx.db.patch(n._id, { read: true });
    }

    // Mark global/group notifications as read via notificationReads
    const globalNotifs = await ctx.db
      .query("notifications")
      .filter((q) => q.or(
        q.eq(q.field("targetAll"), true),
        q.gt(q.field("targetGroups"), [])
      ))
      .collect();
    let count = 0;
    for (const n of globalNotifs) {
      const existing = await ctx.db
        .query("notificationReads")
        .withIndex("by_notificationId_userId", (q) =>
          q.eq("notificationId", n._id).eq("userId", args.userId)
        )
        .first();
      if (existing) {
        if (!existing.read) {
          await ctx.db.patch(existing._id, { read: true, readAt: Date.now() });
          count++;
        }
      } else {
        await ctx.db.insert("notificationReads", {
          notificationId: n._id,
          userId: args.userId,
          read: true,
          readAt: Date.now(),
        });
        count++;
      }
    }
    return userNotifs.length + count;
  },
});

// ============================================================
// 10. DELETE OLD NOTIFICATIONS (CRON)
// ============================================================
export const deleteOldNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const threeDaysMs = 3 * oneDayMs;
    const sevenDaysMs = 7 * oneDayMs;

    // Delete read user-specific notifications older than 24h
    const readCutoff = now - oneDayMs;
    const readNotifs = await ctx.db
      .query("notifications")
      .filter((q) =>
        q.and(
          q.eq(q.field("read"), true),
          q.lt(q.field("createdAt"), readCutoff)
        )
      )
      .collect();
    for (const n of readNotifs) {
      await ctx.db.delete(n._id);
    }

    // Delete unread user-specific notifications older than 3 days
    const unreadCutoff = now - threeDaysMs;
    const unreadNotifs = await ctx.db
      .query("notifications")
      .filter((q) =>
        q.and(
          q.eq(q.field("read"), false),
          q.lt(q.field("createdAt"), unreadCutoff)
        )
      )
      .collect();
    for (const n of unreadNotifs) {
      await ctx.db.delete(n._id);
    }

    // Delete global/group notifications older than 7 days
    const globalCutoff = now - sevenDaysMs;
    const globalNotifs = await ctx.db
      .query("notifications")
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field("targetAll"), true),
            q.gt(q.field("targetGroups"), [])
          ),
          q.lt(q.field("createdAt"), globalCutoff)
        )
      )
      .collect();
    for (const n of globalNotifs) {
      // Delete associated reads
      const reads = await ctx.db
        .query("notificationReads")
        .withIndex("by_notificationId", (q) => q.eq("notificationId", n._id))
        .collect();
      for (const r of reads) {
        await ctx.db.delete(r._id);
      }
      await ctx.db.delete(n._id);
    }

    return {
      readDeleted: readNotifs.length,
      unreadDeleted: unreadNotifs.length,
      globalDeleted: globalNotifs.length,
    };
  },
});

// ============================================================
// 11. ADMIN: GET ALL NOTIFICATIONS
// ============================================================
export const adminGetAllNotifications = internalQuery({
  args: {
    limit: v.number(),
    cursor: v.optional(v.id("notifications")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query("notifications").order("desc");
    if (args.userId) {
      query = ctx.db
        .query("notifications")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .order("desc");
    }
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const items = await query.take(args.limit + 1);
    const hasMore = items.length > args.limit;
    const result = items.slice(0, args.limit);
    const nextCursor = hasMore ? result[result.length - 1]._id : null;
    return { notifications: result, nextCursor, hasMore };
  },
});