// convex/subscriptions/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// 1. CREATE SUBSCRIPTION (with device metadata)
// ============================================================
export const createSubscription = internalMutation({
  args: {
    userId: v.id("users"),
    plan: v.string(),
    startDate: v.number(),
    expiryDate: v.number(),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled")),
    updatedAt: v.optional(v.number()),
    maxDevices: v.optional(v.number()),
    hasTwoDeviceDiscount: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = args.updatedAt || args.startDate;
    return await ctx.db.insert("subscriptions", {
      userId: args.userId,
      plan: args.plan,
      startDate: args.startDate,
      expiryDate: args.expiryDate,
      status: args.status,
      updatedAt: now,
      maxDevices: args.maxDevices ?? 1,
      hasTwoDeviceDiscount: args.hasTwoDeviceDiscount ?? false,
    });
  },
});

// ============================================================
// 2. UPDATE SUBSCRIPTION EXPIRY
// ============================================================
export const updateSubscriptionExpiry = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    expiryDate: v.number(),
    status: v.optional(v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled"))),
    updatedAt: v.optional(v.number()),
    maxDevices: v.optional(v.number()),
    hasTwoDeviceDiscount: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const updates: any = {
      expiryDate: args.expiryDate,
      updatedAt: args.updatedAt || Date.now(),
    };
    if (args.status !== undefined) updates.status = args.status;
    if (args.maxDevices !== undefined) updates.maxDevices = args.maxDevices;
    if (args.hasTwoDeviceDiscount !== undefined) updates.hasTwoDeviceDiscount = args.hasTwoDeviceDiscount;
    await ctx.db.patch(args.subscriptionId, updates);
  },
});

// ============================================================
// 3. GET ACTIVE SUBSCRIPTION BY USER
// ============================================================
export const getActiveSubscriptionByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

// ============================================================
// 4. GET USER SUBSCRIPTION HISTORY
// ============================================================
export const getUserSubscriptionHistory = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// ============================================================
// 5. CANCEL SUBSCRIPTION
// ============================================================
export const cancelSubscriptionById = internalMutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
  },
});

// ============================================================
// 6. GET DEVICE BY FINGERPRINT
// ------------------------------------------------------------
// Legacy helper retained for old callers. On the strict schema
// the `fingerprint` field is optional in the devices table, so
// this returns the first matching row for either field.
// ============================================================
export const getDeviceByFingerprint = internalQuery({
  args: { fingerprint: v.string() },
  handler: async (ctx, args) => {
    // Try the fingerprint index first (legacy)
    const byFp = await ctx.db
      .query("devices")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
      .first();
    if (byFp) return byFp;

    // Fallback: treat the same value as a deviceId
    return await ctx.db
      .query("devices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.fingerprint))
      .first();
  },
});

// ============================================================
// 7. GET DEVICE BY deviceId
// ============================================================
export const getDeviceByDeviceId = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("devices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
  },
});

// ============================================================
// 8. GET COMPLETED PAYMENTS FOR USER
// ============================================================
export const getUserCompletedPayments = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("payments")
      .withIndex("by_userId_status", (q) => q.eq("userId", args.userId).eq("status", "completed"))
      .collect();
  },
});

// ============================================================
// 9. GET ALL SUBSCRIPTIONS FOR USER
// ============================================================
export const getUserSubscriptions = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

// ============================================================
// 10. UPDATE SUBSCRIPTION STATUS (used by cron)
// ============================================================
export const updateSubscriptionStatus = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled")),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      status: args.status,
      updatedAt: args.updatedAt || Date.now(),
    });
  },
});

// ============================================================
// 11. GET EXPIRED ACTIVE SUBSCRIPTIONS (used by cron)
// ============================================================
export const getExpiredActiveSubscriptions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_status_expiryDate", (q) => q.eq("status", "active").lt("expiryDate", now))
      .collect();
  },
});

// ============================================================
// 12. GET SUBSCRIPTIONS EXPIRING SOON (used by cron)
// ============================================================
export const getSubscriptionsExpiringSoon = internalQuery({
  args: { days: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const window = now + args.days * 24 * 60 * 60 * 1000;
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_status_expiryDate", (q) =>
        q.eq("status", "active").lt("expiryDate", window).gt("expiryDate", now)
      )
      .collect();
  },
});

// ============================================================
// 13. DEVICE SUBSCRIPTION MANAGEMENT (multi-device feature)
// ------------------------------------------------------------
// `deviceFingerprint` is optional — old callers still pass it,
// new callers only pass `deviceId` and rely on the strict schema.
// ============================================================

/**
 * Register a device to a subscription (max limit enforced by caller).
 * Idempotent — calling twice with the same device refreshes `lastSeen`
 * and returns the existing row.
 */
export const registerDeviceToSubscription = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    userId: v.id("users"),
    deviceId: v.string(),
    deviceFingerprint: v.optional(v.string()),
    platform: v.optional(v.string()),
    isPrimary: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Prevent duplicates
    const existing = await ctx.db
      .query("subscriptionDevices")
      .withIndex("by_subscriptionId_deviceId", (q) =>
        q.eq("subscriptionId", args.subscriptionId).eq("deviceId", args.deviceId)
      )
      .first();

    if (existing) {
      // Refresh lastSeen and revoke flag (re-registration is allowed)
      await ctx.db.patch(existing._id, {
        lastSeen: Date.now(),
        revoked: false,
      });
      return existing._id;
    }

    return await ctx.db.insert("subscriptionDevices", {
      subscriptionId: args.subscriptionId,
      userId: args.userId,
      deviceId: args.deviceId,
      // Mirror the legacy field only when the caller provided it
      deviceFingerprint: args.deviceFingerprint,
      platform: args.platform,
      isPrimary: args.isPrimary,
      registeredAt: Date.now(),
      lastSeen: Date.now(),
      revoked: false,
    });
  },
});

/**
 * List all devices attached to a subscription.
 */
export const getSubscriptionDevices = internalQuery({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptionDevices")
      .withIndex("by_subscriptionId", (q) => q.eq("subscriptionId", args.subscriptionId))
      .collect();
  },
});

/**
 * Count non-revoked devices on a subscription.
 */
export const countSubscriptionDevices = internalQuery({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const devices = await ctx.db
      .query("subscriptionDevices")
      .withIndex("by_subscriptionId", (q) => q.eq("subscriptionId", args.subscriptionId))
      .collect();
    return devices.filter((d) => !d.revoked).length;
  },
});

/**
 * Find all subscriptions attached to a given deviceId.
 */
export const getSubscriptionsForDeviceId = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptionDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .filter((q) => q.eq(q.field("revoked"), false))
      .collect();
  },
});

/**
 * Revoke a device from a subscription.
 */
export const revokeSubscriptionDevice = internalMutation({
  args: { subscriptionDeviceId: v.id("subscriptionDevices") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionDeviceId, {
      revoked: true,
      lastSeen: Date.now(),
    });
  },
});

/**
 * Fetch a device info record by deviceId (legacy per-device table).
 */
export const getDeviceInfoByDeviceId = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("deviceInfo")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
  },
});

/**
 * Fetch the per-user device-info array (new source of truth).
 */
export const getUserDeviceInfoArray = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    return row?.infos ?? [];
  },
});

/**
 * Fetch the per-user device-id array (new source of truth).
 */
export const getUserDeviceIds = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("deviceIds")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    return row?.ids ?? [];
  },
});