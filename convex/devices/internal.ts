// convex/devices/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// DEVICE INFO — DUAL WRITE
// ------------------------------------------------------------
// 1. Legacy per-device table `deviceInfo` — keyed by deviceId
//    (kept for old app-store clients and any code that reads by deviceId)
// 2. New per-user array `userDeviceInfo.infos` — parallel to
//    `deviceIds.ids` (the source of truth for the new frontend)
//
// Both are kept in sync so neither source drifts.
// ============================================================

export const upsertDeviceInfo = internalMutation({
  args: {
    deviceId: v.string(),
    userId: v.optional(v.id("users")),
    info: v.any(),
    platform: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // ---- 1. Legacy per-device table ----
    const existing = await ctx.db
      .query("deviceInfo")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();

    let legacyId;
    if (existing) {
      await ctx.db.patch(existing._id, {
        userId: args.userId ?? existing.userId,
        info: args.info,
        platform: args.platform,
        userAgent: args.userAgent,
        updatedAt: now,
      });
      legacyId = existing._id;
    } else {
      legacyId = await ctx.db.insert("deviceInfo", {
        deviceId: args.deviceId,
        userId: args.userId,
        info: args.info,
        platform: args.platform,
        userAgent: args.userAgent,
        createdAt: now,
        updatedAt: now,
      });
    }

    // ---- 2. New per-user array (only when userId is known) ----
    if (args.userId) {
      const idRow = await ctx.db
        .query("deviceIds")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId!))
        .first();
      const infoRow = await ctx.db
        .query("userDeviceInfo")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId!))
        .first();

      if (idRow) {
        // The device should already be in deviceIds — addDevice owns that.
        const idx = idRow.ids.indexOf(args.deviceId);

        if (idx >= 0) {
          // Update the parallel info slot
          const infos = [...(infoRow?.infos ?? [])];
          infos[idx] = args.info;
          if (infoRow) {
            await ctx.db.patch(infoRow._id, { infos });
          } else {
            // Repair: idRow exists but infoRow is missing
            await ctx.db.insert("userDeviceInfo", {
              userId: args.userId,
              infos,
            });
          }
        } else {
          // Device not yet in deviceIds — this is unusual for the new
          // frontend but can happen if only upsertDeviceInfo is called
          // without addDevice. Append here so the arrays stay parallel.
          const ids = [...idRow.ids, args.deviceId];
          const infos = [...(infoRow?.infos ?? []), args.info];
          await ctx.db.patch(idRow._id, { ids });
          if (infoRow) {
            await ctx.db.patch(infoRow._id, { infos });
          } else {
            await ctx.db.insert("userDeviceInfo", {
              userId: args.userId,
              infos,
            });
          }
        }
      } else {
        // No deviceIds row yet — create both arrays with this single entry
        await ctx.db.insert("deviceIds", {
          userId: args.userId,
          ids: [args.deviceId],
        });
        await ctx.db.insert("userDeviceInfo", {
          userId: args.userId,
          infos: [args.info],
        });
      }
    }

    return legacyId;
  },
});

// ============================================================
// READ — legacy per-device shape (by deviceId)
// ============================================================
export const getDeviceInfo = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("deviceInfo")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
  },
});

// ============================================================
// READ — new per-user array shape (by userId)
// Returns the infos array parallel to deviceIds.ids for that user.
// ============================================================
export const getDeviceInfoForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    return row?.infos ?? [];
  },
});

// ============================================================
// READ — single device's info by userId + deviceId
// Searches the new array first, falls back to the legacy table.
// ============================================================
export const getDeviceInfoByUserAndDevice = internalQuery({
  args: {
    userId: v.id("users"),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    // ---- New tables first ----
    const idRow = await ctx.db
      .query("deviceIds")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    const infoRow = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (idRow) {
      const idx = idRow.ids.indexOf(args.deviceId);
      if (idx >= 0 && infoRow?.infos?.[idx]) {
        return {
          deviceId: args.deviceId,
          info: infoRow.infos[idx],
          source: "array" as const,
        };
      }
    }

    // ---- Legacy table fallback ----
    const legacy = await ctx.db
      .query("deviceInfo")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();

    if (legacy && (!legacy.userId || legacy.userId === args.userId)) {
      return {
        deviceId: args.deviceId,
        info: legacy.info,
        source: "legacy" as const,
      };
    }

    return null;
  },
});

// ============================================================
// DELETE — remove a device's info from both stores
// Called when the device is removed from the user (cascade).
// ============================================================
export const deleteDeviceInfo = internalMutation({
  args: {
    userId: v.id("users"),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    // ---- 1. Remove from new array ----
    const idRow = await ctx.db
      .query("deviceIds")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    const infoRow = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (idRow) {
      const idx = idRow.ids.indexOf(args.deviceId);
      if (idx >= 0) {
        const ids = idRow.ids.filter((_, i) => i !== idx);
        const infos = (infoRow?.infos ?? []).filter((_, i) => i !== idx);
        await ctx.db.patch(idRow._id, { ids });
        if (infoRow) await ctx.db.patch(infoRow._id, { infos });
      }
    }

    // ---- 2. Remove from legacy table ----
    const legacy = await ctx.db
      .query("deviceInfo")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (legacy && (!legacy.userId || legacy.userId === args.userId)) {
      await ctx.db.delete(legacy._id);
    }
  },
});