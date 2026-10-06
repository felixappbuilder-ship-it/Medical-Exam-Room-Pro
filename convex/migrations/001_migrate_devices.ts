// convex/migrations/001_migrate_devices.ts
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Migration: move all device data into the new
 *   deviceIds   (per-user array of device ids)
 *   userDeviceInfo (per-user array of info JSON)
 * tables, and normalise every legacy field.
 *
 * Safe to run multiple times — every step is idempotent.
 */
export const runDeviceMigration = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let migrated = 0;

    for (const user of users) {
      // ---- 1. Collect device ids from all old sources ----
      const idSet = new Set<string>();
      const infoById = new Map<string, any>();

      // 1a. From user.devices[]
      for (const d of user.devices || []) {
        const id = (d as any).deviceId || (d as any).fingerprint;
        if (id) {
          idSet.add(id);
          // Try to enrich from deviceInfo table
          if (!infoById.has(id)) infoById.set(id, null);
        }
      }

      // 1b. From sessions
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();
      for (const s of sessions) {
        const id = s.deviceId || s.deviceFingerprint;
        if (id) {
          idSet.add(id);
          if (!infoById.has(id)) infoById.set(id, null);
        }
      }

      // 1c. From devices table
      const deviceRows = await ctx.db
        .query("devices")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();
      for (const r of deviceRows) {
        const id = r.deviceId || r.fingerprint;
        if (id) {
          idSet.add(id);
          if (!infoById.has(id)) infoById.set(id, null);
        }
      }

      // 1d. From subscriptionDevices
      const subDevices = await ctx.db
        .query("subscriptionDevices")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();
      for (const sd of subDevices) {
        const id = sd.deviceId || sd.deviceFingerprint;
        if (id) {
          idSet.add(id);
          if (!infoById.has(id)) infoById.set(id, null);
        }
      }

      // ---- 2. Enrich info from old deviceInfo table ----
      for (const id of idSet) {
        const infoRow = await ctx.db
          .query("deviceInfo")
          .withIndex("by_deviceId", (q) => q.eq("deviceId", id))
          .first();
        if (infoRow?.info) {
          infoById.set(id, infoRow.info);
        }
      }

      // ---- 3. Build parallel arrays ----
      const ids: string[] = [];
      const infos: any[] = [];
      for (const id of idSet) {
        ids.push(id);
        infos.push(infoById.get(id) || { platform: "unknown" });
      }

      // ---- 4. Upsert deviceIds ----
      const existingIdsRow = await ctx.db
        .query("deviceIds")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .first();
      if (existingIdsRow) {
        await ctx.db.patch(existingIdsRow._id, { ids });
      } else {
        await ctx.db.insert("deviceIds", { userId: user._id, ids });
      }

      // ---- 5. Upsert userDeviceInfo ----
      const existingInfoRow = await ctx.db
        .query("userDeviceInfo")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .first();
      if (existingInfoRow) {
        await ctx.db.patch(existingInfoRow._id, { infos });
      } else {
        await ctx.db.insert("userDeviceInfo", { userId: user._id, infos });
      }

      // ---- 6. Normalise user.devices[] to new shape ----
      const newDevices = ids.map((id, i) => ({
        deviceId: id,
        displayName: buildDisplayName(infos[i]),
        platform: infos[i]?.platform,
        lastUsed:
          (user.devices || []).find(
            (d: any) => (d.deviceId || d.fingerprint) === id
          )?.lastUsed ?? Date.now(),
      }));
      await ctx.db.patch(user._id, { devices: newDevices });

      // ---- 7. Normalise subscriptionDevices ----
      for (const sd of subDevices) {
        if (!(sd as any).deviceId && (sd as any).deviceFingerprint) {
          await ctx.db.patch(sd._id, {
            deviceId: (sd as any).deviceFingerprint,
          });
        }
      }

      migrated++;
    }

    return { migratedUsers: migrated };
  },
});

function buildDisplayName(info: any): string {
  if (!info || typeof info !== "object") return "Unknown device";
  const platform = (info.platform || "").toLowerCase();
  if (platform === "android") {
    const brand = (info.manufacturer || "").trim();
    const model = (info.model || "").trim();
    return [brand, model].filter(Boolean).join(" ") || "Android device";
  }
  if (platform === "ios") return (info.model || "").trim() || "iPhone / iPad";
  if (platform === "windows") return "Windows PC";
  const browser = info.browser || "Browser";
  const os = info.osName || "Web";
  return `${browser} on ${os}`;
}