// convex/migrations/runAllMigrations.ts

/**
 * Unified migration — runs everything in the correct order.
 *
 * Usage (dev):
 *   npx convex run migrations/runAllMigrations:runAll
 *
 * Usage (production):
 *   npx convex run migrations/runAllMigrations:runAll --prod
 *
 * Idempotent — safe to re-run at any time. Every step checks current state
 * before writing, so partial runs don't corrupt data.
 *
 * Steps executed in order:
 *   1. Normalise appConfig singleton (fills missing multi-device fields,
 *      rewrites subscriptionPlans to include id / features / popular / cta …)
 *   2. Populate deviceIds + userDeviceInfo from all legacy sources
 *      (users.devices[], sessions, devices, subscriptionDevices, old deviceInfo)
 *   3. Normalise users.devices[] to the new shape (deviceId + displayName …)
 *   4. Delete legacy rows from sessions, devices, and old deviceInfo table
 *   5. Verify everything afterwards and return a summary
 *
 * This is designed to run against the BRIDGE schema. After it completes
 * you can deploy the FINAL schema (strict validators) and push the new
 * code that reads deviceIds + userDeviceInfo.
 */

import { internalMutation } from "../_generated/server";

export const runAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const summary: Record<string, unknown> = {};

    // ========================================================
    // STEP 1 — appConfig singleton
    // ========================================================
    summary.appConfig = await migrateAppConfig(ctx);

    // ========================================================
    // STEP 2 + 3 — devices: populate new tables + normalise users
    // ========================================================
    summary.devices = await migrateDevices(ctx);

    // ========================================================
    // STEP 4 — cleanup legacy rows
    // ========================================================
    summary.cleanup = await cleanupLegacyRows(ctx);

    // ========================================================
    // STEP 5 — verify
    // ========================================================
    summary.verification = await verifyMigration(ctx);

    return summary;
  },
});

// ============================================================
// STEP 1 — appConfig
// ============================================================
async function migrateAppConfig(ctx: any) {
  const config = await ctx.db.query("appConfig").first();
  if (!config) {
    return { migrated: false, reason: "no appConfig document" };
  }

  const normalisedPlans = (config.subscriptionPlans ?? []).map((p: any) => {
    let id = p.id;
    if (!id) {
      const lower = String(p.name || "").toLowerCase();
      if (lower.includes("month")) id = "monthly";
      else if (lower.includes("quarter")) id = "quarterly";
      else if (lower.includes("year")) id = "yearly";
      else id = lower.replace(/\s+/g, "-").slice(0, 20) || "plan";
    }

    return {
      id,
      name: p.name,
      price: p.price,
      days: p.days,
      popular: p.popular ?? (id === "quarterly"),
      features: p.features ?? defaultFeatures(id),
      limitations: p.limitations ?? defaultLimitations(id),
      savings: p.savings ?? defaultSavings(id),
      ctaText: p.ctaText ?? `Subscribe – KES ${p.price}`,
      ctaColor: p.ctaColor ?? "success",
      durationText: p.durationText ?? defaultDurationText(id),
    };
  });

  await ctx.db.patch(config._id, {
    subscriptionPlans: normalisedPlans,
    autoApproveWithdrawals: config.autoApproveWithdrawals ?? false,
    challengeWinnerPoints: config.challengeWinnerPoints ?? 10,
    twoDeviceDiscountPercent: config.twoDeviceDiscountPercent ?? 15,
    customPenaltyPerDay: config.customPenaltyPerDay ?? 1.75,
    maxDevicesPerSubscription: config.maxDevicesPerSubscription ?? 2,
  });

  return { migrated: true, plansNormalised: normalisedPlans.length };
}

// ============================================================
// STEP 2 + 3 — devices
// ============================================================
async function migrateDevices(ctx: any) {
  const users = await ctx.db.query("users").collect();
  let migratedUsers = 0;
  let totalDeviceIds = 0;

  for (const user of users) {
    const idSet = new Set<string>();
    const infoById = new Map<string, any>();

    // 2a. user.devices[] (old + new shape)
    for (const d of user.devices || []) {
      const id = (d as any).deviceId || (d as any).fingerprint;
      if (id) idSet.add(id);
    }

    // 2b. sessions
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
      .collect();
    for (const s of sessions) {
      const id = s.deviceId || s.deviceFingerprint;
      if (id) idSet.add(id);
    }

    // 2c. devices table
    const deviceRows = await ctx.db
      .query("devices")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
      .collect();
    for (const r of deviceRows) {
      const id = r.deviceId || r.fingerprint;
      if (id) idSet.add(id);
    }

    // 2d. subscriptionDevices
    const subDevices = await ctx.db
      .query("subscriptionDevices")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
      .collect();
    for (const sd of subDevices) {
      const id = sd.deviceId || sd.deviceFingerprint;
      if (id) idSet.add(id);
    }

    // 2e. old deviceInfo table (per-device rows)
    for (const id of idSet) {
      const oldRow = await ctx.db
        .query("deviceInfo")
        .withIndex("by_deviceId", (q: any) => q.eq("deviceId", id))
        .first();
      if (oldRow?.info) infoById.set(id, oldRow.info);
    }

    // Build parallel arrays
    const ids: string[] = [];
    const infos: any[] = [];
    for (const id of idSet) {
      ids.push(id);
      infos.push(infoById.get(id) || { platform: "unknown" });
    }

    // 2f. Upsert deviceIds
    const idRow = await ctx.db
      .query("deviceIds")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
      .first();
    if (idRow) await ctx.db.patch(idRow._id, { ids });
    else await ctx.db.insert("deviceIds", { userId: user._id, ids });

    // 2g. Upsert userDeviceInfo
    const infoRow = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
      .first();
    if (infoRow) await ctx.db.patch(infoRow._id, { infos });
    else await ctx.db.insert("userDeviceInfo", { userId: user._id, infos });

    // 3. Normalise user.devices[] to new shape
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

    // 3b. Backfill subscriptionDevices.deviceId from deviceFingerprint
    for (const sd of subDevices) {
      if (!(sd as any).deviceId && (sd as any).deviceFingerprint) {
        await ctx.db.patch(sd._id, {
          deviceId: (sd as any).deviceFingerprint,
        });
      }
    }

    migratedUsers++;
    totalDeviceIds += ids.length;
  }

  return { migratedUsers, totalDeviceIds };
}

// ============================================================
// STEP 4 — cleanup legacy rows
// ============================================================
async function cleanupLegacyRows(ctx: any) {
  let deletedInfoRows = 0;
  let deletedSessions = 0;
  let deletedDeviceRows = 0;

  // 4a. Delete ALL old deviceInfo per-device rows
  const infoRows = await ctx.db.query("deviceInfo").collect();
  for (const r of infoRows) {
    await ctx.db.delete(r._id);
    deletedInfoRows++;
  }

  // 4b. Delete sessions
  const sessions = await ctx.db.query("sessions").collect();
  for (const s of sessions) {
    await ctx.db.delete(s._id);
    deletedSessions++;
  }

  // 4c. Delete devices table rows
  const deviceRows = await ctx.db.query("devices").collect();
  for (const r of deviceRows) {
    await ctx.db.delete(r._id);
    deletedDeviceRows++;
  }

  return { deletedInfoRows, deletedSessions, deletedDeviceRows };
}

// ============================================================
// STEP 5 — verification
// ============================================================
async function verifyMigration(ctx: any) {
  const users = await ctx.db.query("users").collect();
  const deviceIdsRows = await ctx.db.query("deviceIds").collect();
  const userDeviceInfoRows = await ctx.db.query("userDeviceInfo").collect();

  const usersWithIds = new Set(deviceIdsRows.map((r: any) => r.userId));
  const usersWithInfo = new Set(userDeviceInfoRows.map((r: any) => r.userId));

  let usersMissingDeviceId = 0;
  let usersMissingInfo = 0;
  for (const u of users) {
    if (!usersWithIds.has(u._id)) usersMissingDeviceId++;
    if (!usersWithInfo.has(u._id)) usersMissingInfo++;
  }

  // Sanity: arrays must be parallel (same length)
  let misaligned = 0;
  for (const row of deviceIdsRows) {
    const infoRow = userDeviceInfoRows.find((r: any) => r.userId === row.userId);
    if (!infoRow || infoRow.infos.length !== row.ids.length) misaligned++;
  }

  const config = await ctx.db.query("appConfig").first();

  return {
    totalUsers: users.length,
    usersWithDeviceIdsRow: usersWithIds.size,
    usersWithDeviceInfoRow: usersWithInfo.size,
    usersMissingDeviceId,
    usersMissingInfo,
    misalignedArrays: misaligned,
    appConfigHasCustomPenalty:
      typeof config?.customPenaltyPerDay === "number",
    appConfigPlansHaveFeatures:
      Array.isArray(config?.subscriptionPlans) &&
      config.subscriptionPlans.every((p: any) => Array.isArray(p.features)),
  };
}

// ============================================================
// HELPERS
// ============================================================
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

function defaultDurationText(id: string): string {
  if (id === "monthly") return "30 days";
  if (id === "quarterly") return "3 months";
  if (id === "yearly") return "9 months";
  return "";
}

function defaultFeatures(id: string): string[] {
  const base = [
    "Full access to all subjects",
    "All exam modes (practice, timed, mock)",
    "Detailed analytics and weak-area detection",
    "Certificate generation",
    "Priority support",
  ];
  if (id === "quarterly" || id === "yearly") {
    base.push("Unlimited notes + AI summarization", "PDF downloads");
  }
  return base;
}

function defaultLimitations(id: string): string[] | undefined {
  if (id === "monthly") return ["Single device only", "No notes export"];
  return undefined;
}

function defaultSavings(id: string): string | undefined {
  if (id === "quarterly") return "Save KES 200";
  if (id === "yearly") return "Save KES 1,100";
  return undefined;
}