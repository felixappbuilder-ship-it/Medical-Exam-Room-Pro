// convex/notifications/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// SCHEMA REMINDER
// ------------------------------------------------------------
// notifications table fields:
//   userId?      – optional (undefined for global/group)
//   targetAll?   – boolean (true for global)
//   targetGroups?– array of group names
//   type, title, message, data?, createdAt, senderId?
//
// Read status is ALWAYS stored in notificationReads, never
// on the notification itself. This keeps global broadcasts to
// a single document and avoids per-user write storms.
// ============================================================

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
    return await ctx.db.insert("notifications", {
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
  },
});

// ============================================================
// 2. INSERT NOTIFICATIONS FOR MULTIPLE SPECIFIC USERS
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
// 3. INSERT GLOBAL NOTIFICATION (single document)
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
    return await ctx.db.insert("notifications", {
      // userId omitted intentionally
      type: args.type,
      title: args.title,
      message: args.message,
      data: args.data,
      senderId: args.senderId,
      targetAll: args.targetAll ?? true,
      targetGroups: args.targetGroups ?? [],
      createdAt: Date.now(),
    });
  },
});

// ============================================================
// 4. INSERT GROUP NOTIFICATION (single document, groups array)
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
    return await ctx.db.insert("notifications", {
      type: args.type,
      title: args.title,
      message: args.message,
      data: args.data,
      senderId: args.senderId,
      targetAll: false,
      targetGroups: [args.groupName],
      createdAt: Date.now(),
    });
  },
});

// ============================================================
// 5. GET NOTIFICATIONS FOR USER
//    Merges user-specific + global + group, then attaches read status.
//    Assumes `userGroups` is an array of group names the user belongs to.
// ============================================================
export const getNotificationsForUser = internalQuery({
  args: {
    userId: v.id("users"),
    userGroups: v.optional(v.array(v.string())),
    limit: v.number(),
    cursor: v.optional(v.id("notifications")),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const groups = args.userGroups ?? [];

    // ---- 1. User-specific notifications ----
    let userQuery = ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId));
    const userNotifs = await userQuery.collect();

    // ---- 2. Global notifications ----
    const globalNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_targetAll", (q) => q.eq("targetAll", true))
      .collect();

    // ---- 3. Group notifications matching user's groups ----
    let groupNotifs: any[] = [];
    if (groups.length > 0) {
      const allGroupNotifs = await ctx.db
        .query("notifications")
        .withIndex("by_targetAll", (q) => q.eq("targetAll", false))
        .collect();
      groupNotifs = allGroupNotifs.filter((n) => {
        const tg = n.targetGroups ?? [];
        return tg.some((g) => groups.includes(g));
      });
    }

    // ---- 4. Merge + sort by createdAt desc ----
    const merged = [...userNotifs, ...globalNotifs, ...groupNotifs];
    merged.sort((a, b) => b.createdAt - a.createdAt);

    // ---- 5. Attach read status from notificationReads ----
    const enriched = await Promise.all(
      merged.map(async (n) => {
        const readEntry = await ctx.db
          .query("notificationReads")
          .withIndex("by_notificationId_userId", (q) =>
            q.eq("notificationId", n._id).eq("userId", args.userId)
          )
          .first();
        return { ...n, read: readEntry?.read ?? false };
      })
    );

    // ---- 6. Unread filter ----
    let filtered = args.unreadOnly ? enriched.filter((n) => !n.read) : enriched;

    // ---- 7. Cursor (skip past the cursor _id) ----
    if (args.cursor) {
      const idx = filtered.findIndex((n) => n._id === args.cursor);
      if (idx !== -1) filtered = filtered.slice(idx + 1);
    }

    // ---- 8. Paginate ----
    const hasMore = filtered.length > args.limit;
    const result = filtered.slice(0, args.limit);
    const nextCursor = hasMore ? result[result.length - 1]._id : null;

    return { notifications: result, nextCursor, hasMore };
  },
});

// ============================================================
// 6. UNREAD COUNT (user-specific + global + group)
// ============================================================
export const getUnreadCount = internalQuery({
  args: {
    userId: v.id("users"),
    userGroups: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const groups = args.userGroups ?? [];

    // User-specific
    const userNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    // Global
    const globalNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_targetAll", (q) => q.eq("targetAll", true))
      .collect();

    // Group
    let groupNotifs: any[] = [];
    if (groups.length > 0) {
      const allGroupNotifs = await ctx.db
        .query("notifications")
        .withIndex("by_targetAll", (q) => q.eq("targetAll", false))
        .collect();
      groupNotifs = allGroupNotifs.filter((n) => {
        const tg = n.targetGroups ?? [];
        return tg.some((g) => groups.includes(g));
      });
    }

    const all = [...userNotifs, ...globalNotifs, ...groupNotifs];
    let unread = 0;
    for (const n of all) {
      const readEntry = await ctx.db
        .query("notificationReads")
        .withIndex("by_notificationId_userId", (q) =>
          q.eq("notificationId", n._id).eq("userId", args.userId)
        )
        .first();
      if (!readEntry || !readEntry.read) unread++;
    }
    return unread;
  },
});

// ============================================================
// 7. GET NOTIFICATIONS SINCE A TIMESTAMP
// ============================================================
export const getNotificationsSince = internalQuery({
  args: {
    userId: v.id("users"),
    userGroups: v.optional(v.array(v.string())),
    since: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const groups = args.userGroups ?? [];

    const userNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const globalNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_targetAll", (q) => q.eq("targetAll", true))
      .collect();

    let groupNotifs: any[] = [];
    if (groups.length > 0) {
      const allGroupNotifs = await ctx.db
        .query("notifications")
        .withIndex("by_targetAll", (q) => q.eq("targetAll", false))
        .collect();
      groupNotifs = allGroupNotifs.filter((n) => {
        const tg = n.targetGroups ?? [];
        return tg.some((g) => groups.includes(g));
      });
    }

    const merged = [...userNotifs, ...globalNotifs, ...groupNotifs]
      .filter((n) => n.createdAt > args.since)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, args.limit);

    return merged;
  },
});

// ============================================================
// 8. MARK ONE NOTIFICATION READ
// ============================================================
export const markNotificationRead = internalMutation({
  args: { notificationId: v.id("notifications"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const notif = await ctx.db.get(args.notificationId);
    if (!notif) throw new Error("Notification not found");

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
  },
});

// ============================================================
// 9. MARK ALL NOTIFICATIONS READ FOR USER
// ============================================================
export const markAllNotificationsRead = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Gather all notifications visible to this user
    const userNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    const globalNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_targetAll", (q) => q.eq("targetAll", true))
      .collect();
    const groupNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_targetAll", (q) => q.eq("targetAll", false))
      .collect();

    const all = [...userNotifs, ...globalNotifs, ...groupNotifs];
    const now = Date.now();
    let updated = 0;

    for (const n of all) {
      const existing = await ctx.db
        .query("notificationReads")
        .withIndex("by_notificationId_userId", (q) =>
          q.eq("notificationId", n._id).eq("userId", args.userId)
        )
        .first();
      if (existing) {
        if (!existing.read) {
          await ctx.db.patch(existing._id, { read: true, readAt: now });
          updated++;
        }
      } else {
        await ctx.db.insert("notificationReads", {
          notificationId: n._id,
          userId: args.userId,
          read: true,
          readAt: now,
        });
        updated++;
      }
    }
    return updated;
  },
});

// ============================================================
// 10. CRON: DELETE OLD NOTIFICATIONS
//     Read status lives in notificationReads, so we clean up by age.
// ============================================================
export const deleteOldNotifications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const threeDays = 3 * oneDay;
    const sevenDays = 7 * oneDay;

    // Delete read user-specific notifications older than 1 day
    const readCutoff = now - oneDay;
    const readNotifs = await ctx.db
      .query("notifications")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", readCutoff))
      .collect();

    let deletedRead = 0;
    let deletedUnread = 0;
    let deletedGlobal = 0;

    for (const n of readNotifs) {
      const reads = await ctx.db
        .query("notificationReads")
        .withIndex("by_notificationId", (q) => q.eq("notificationId", n._id))
        .collect();

      if (n.userId) {
        // User-specific: if all readers have read → delete
        const allRead = reads.length > 0 && reads.every((r) => r.read);
        if (allRead) {
          for (const r of reads) await ctx.db.delete(r._id);
          await ctx.db.delete(n._id);
          deletedRead++;
        }
      } else {
        // Global/group: age threshold is 7 days
        if (n.createdAt < now - sevenDays) {
          for (const r of reads) await ctx.db.delete(r._id);
          await ctx.db.delete(n._id);
          deletedGlobal++;
        }
      }
    }

    // Delete unread user-specific notifications older than 3 days
    const unreadCutoff = now - threeDays;
    const userNotifs = await ctx.db.query("notifications").collect();
    for (const n of userNotifs) {
      if (!n.userId) continue;
      if (n.createdAt < unreadCutoff) {
        const reads = await ctx.db
          .query("notificationReads")
          .withIndex("by_notificationId", (q) => q.eq("notificationId", n._id))
          .collect();
        if (!reads.some((r) => r.read)) {
          for (const r of reads) await ctx.db.delete(r._id);
          await ctx.db.delete(n._id);
          deletedUnread++;
        }
      }
    }

    return { deletedRead, deletedUnread, deletedGlobal };
  },
});

// ============================================================
// 11. ADMIN: GET ALL NOTIFICATIONS (with optional user filter)
// ============================================================
export const adminGetAllNotifications = internalQuery({
  args: {
    limit: v.number(),
    cursor: v.optional(v.id("notifications")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    let query;
    if (args.userId) {
      query = ctx.db
        .query("notifications")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .order("desc");
    } else {
      query = ctx.db.query("notifications").withIndex("by_createdAt").order("desc");
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