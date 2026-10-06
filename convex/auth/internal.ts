// convex/auth/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// USER MANAGEMENT
// ============================================================

export const insertUser = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    passwordHash: v.string(),
    securityQuestions: v.array(
      v.object({
        question: v.string(),
        answerHash: v.string(),
      })
    ),
    role: v.optional(v.string()),
    username: v.string(),
    displayName: v.string(),
    referralCode: v.optional(v.string()),
    referredBy: v.optional(v.id("users")),
    isAgent: v.boolean(),
    agentVerified: v.optional(v.boolean()),
    referralBalance: v.number(),
    totalEarned: v.number(),
    pendingBalance: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      phone: args.phone,
      passwordHash: args.passwordHash,
      securityQuestions: args.securityQuestions,
      isLocked: false,
      trialUsed: false,
      devices: [],
      role: args.role || "user",
      username: args.username,
      displayName: args.displayName,
      lastSeen: Date.now(),
      status: "online",
      referralCode: args.referralCode || "",
      referredBy: args.referredBy,
      isAgent: args.isAgent,
      agentVerified: args.agentVerified || false,
      referralBalance: args.referralBalance,
      totalEarned: args.totalEarned,
      pendingBalance: args.pendingBalance,
      referralRewarded: false,
      rating: 100,
      historyEWMA: 0.5,
      completedExams: 0,
      startedExams: 0,
      leaderboardPoints: 0,
      integrityScore: 1,
    });
    return userId;
  },
});

export const getUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});

export const getUserByPhone = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();
  },
});

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const getUserByUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
  },
});

export const updateUser = internalMutation({
  args: {
    userId: v.id("users"),
    updates: v.object({
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      passwordHash: v.optional(v.string()),
      isLocked: v.optional(v.boolean()),
      lockReason: v.optional(v.string()),
      trialUsed: v.optional(v.boolean()),
      role: v.optional(v.string()),
      username: v.optional(v.string()),
      displayName: v.optional(v.string()),
      status: v.optional(v.union(v.literal("online"), v.literal("offline"))),
      lastLogin: v.optional(v.number()),
      lastSeen: v.optional(v.number()),
      preferences: v.optional(
        v.object({
          theme: v.optional(v.string()),
          notifications: v.optional(v.boolean()),
        })
      ),
      isAgent: v.optional(v.boolean()),
      agentVerified: v.optional(v.boolean()),
      referralBalance: v.optional(v.number()),
      pendingBalance: v.optional(v.number()),
      totalEarned: v.optional(v.number()),
      referralRewarded: v.optional(v.boolean()),
      rating: v.optional(v.number()),
      historyEWMA: v.optional(v.number()),
      completedExams: v.optional(v.number()),
      startedExams: v.optional(v.number()),
      leaderboardPoints: v.optional(v.number()),
      integrityScore: v.optional(v.number()),
      googleSubject: v.optional(v.union(v.string(), v.null())),
      googleEmail: v.optional(v.union(v.string(), v.null())),
      googlePicture: v.optional(v.union(v.string(), v.null())),
    }),
  },
  handler: async (ctx, args) => {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(args.updates)) {
      if (value === null) {
        cleaned[key] = undefined;
      } else if (value !== undefined) {
        cleaned[key] = value;
      }
    }
    await ctx.db.patch(args.userId, cleaned);
  },
});

// ============================================================
// DEVICE STORAGE — DUAL WRITE
// ------------------------------------------------------------
// New source of truth: deviceIds + userDeviceInfo (per-user arrays).
// Legacy tables: users.devices[], sessions, devices, deviceInfo.
//
// Every write goes to the new tables AND mirrors into users.devices[]
// so old clients and the UI continue to work.
//
// Every read prefers the new tables and falls back to legacy sources
// if the new tables are empty.
//
// IMPORTANT: getUserDevicesForUI returns ONLY devices that currently
// have an ACTIVE (non-revoked, non-expired) session. This is what
// the device-limit logic uses, and it is what the UI displays.
// ============================================================

// ---------- Display name helper ----------
function buildDisplayName(info: any): string {
  if (!info || typeof info !== "object") return "Unknown device";
  const platform = String(info.platform || "").toLowerCase();

  if (platform === "android") {
    const brand = String(info.manufacturer || "").trim();
    const model = String(info.model || "").trim();
    return [brand, model].filter(Boolean).join(" ") || "Android device";
  }
  if (platform === "ios") return String(info.model || "").trim() || "iPhone / iPad";
  if (platform === "windows") return "Windows PC";

  const browser = info.browser || "Browser";
  const os = info.osName || "Web";
  return `${browser} on ${os}`;
}

// ---------- Read helpers (new tables) ----------
export const getDeviceIds = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("deviceIds")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    return row?.ids ?? [];
  },
});

export const getDeviceInfoArray = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    return row?.infos ?? [];
  },
});

// ---------- Write helpers (new tables) ----------
export const setDeviceArrays = internalMutation({
  args: {
    userId: v.id("users"),
    ids: v.array(v.string()),
    infos: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const idRow = await ctx.db
      .query("deviceIds")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    const infoRow = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (idRow) await ctx.db.patch(idRow._id, { ids: args.ids });
    else await ctx.db.insert("deviceIds", { userId: args.userId, ids: args.ids });

    if (infoRow) await ctx.db.patch(infoRow._id, { infos: args.infos });
    else await ctx.db.insert("userDeviceInfo", { userId: args.userId, infos: args.infos });
  },
});

// ============================================================
// addDevice — accepts both old and new payloads
// ------------------------------------------------------------
// - Writes the deviceId + info into the new tables
// - Mirrors the entry into users.devices[] (with displayName)
// - Keeps the legacy devices table in sync (best-effort)
// ============================================================
export const addDevice = internalMutation({
  args: {
    userId: v.id("users"),
    fingerprint: v.optional(v.string()),
    deviceId: v.optional(v.string()),
    lastUsed: v.number(),
    platform: v.optional(v.string()),
    deviceInfo: v.optional(v.any()),
    maxDevices: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;

    const deviceId = args.deviceId || args.fingerprint;
    if (!deviceId) return;

    const info = args.deviceInfo || {
      platform: args.platform || "unknown",
    };

    // ---- 1. Update users.devices[] (mirror) ----
    const devices = user.devices || [];
    const idx = devices.findIndex(
      (d) =>
        (d as any).deviceId === deviceId ||
        d.fingerprint === args.fingerprint
    );
    const displayName = buildDisplayName(info);
    if (idx >= 0) {
      devices[idx].lastUsed = args.lastUsed;
      if (args.platform) devices[idx].platform = args.platform;
      (devices[idx] as any).deviceId = deviceId;
      (devices[idx] as any).displayName = displayName;
    } else {
      devices.push({
        fingerprint: args.fingerprint || deviceId,
        deviceId,
        displayName,
        lastUsed: args.lastUsed,
        platform: args.platform,
      } as any);
    }
    await ctx.db.patch(args.userId, { devices });

    // ---- 2. Update deviceIds + userDeviceInfo (per-user arrays) ----
    const idRow = await ctx.db
      .query("deviceIds")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    const infoRow = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const ids = idRow ? [...idRow.ids] : [];
    const infos = infoRow ? [...infoRow.infos] : [];

    const arrIdx = ids.indexOf(deviceId);
    if (arrIdx >= 0) {
      infos[arrIdx] = info;
    } else {
      if (args.maxDevices !== undefined && ids.length >= args.maxDevices) {
        return;
      }
      ids.push(deviceId);
      infos.push(info);
    }

    if (idRow) await ctx.db.patch(idRow._id, { ids });
    else await ctx.db.insert("deviceIds", { userId: args.userId, ids });

    if (infoRow) await ctx.db.patch(infoRow._id, { infos });
    else await ctx.db.insert("userDeviceInfo", { userId: args.userId, infos });

    // ---- 3. Legacy devices table (best-effort) ----
    try {
      const row = await ctx.db
        .query("devices")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
        .first();
      if (row) {
        await ctx.db.patch(row._id, {
          userId: args.userId,
          fingerprint: args.fingerprint || deviceId,
          lastUsed: args.lastUsed,
          platform: args.platform,
        });
      } else {
        await ctx.db.insert("devices", {
          userId: args.userId,
          deviceId,
          fingerprint: args.fingerprint || deviceId,
          lastUsed: args.lastUsed,
          platform: args.platform,
        });
      }
    } catch {
      // Legacy table unavailable — ignore
    }
  },
});

// ============================================================
// removeDeviceByFingerprint
// ------------------------------------------------------------
// Removes the device from every store it might live in and
// PHYSICALLY DELETES any session tied to it, so dead rows never
// accumulate in the sessions table.
// ============================================================
export const removeDeviceByFingerprint = internalMutation({
  args: {
    userId: v.id("users"),
    fingerprint: v.optional(v.string()),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;

    const targetDeviceId = args.deviceId || args.fingerprint;

    // ---- 1. Remove from users.devices[] ----
    const devices = user.devices || [];
    const updated = devices.filter((d) => {
      const matchesFingerprint =
        args.fingerprint && d.fingerprint === args.fingerprint;
      const matchesDeviceId =
        args.deviceId && (d as any).deviceId === args.deviceId;
      return !(matchesFingerprint || matchesDeviceId);
    });
    await ctx.db.patch(args.userId, { devices: updated });

    // ---- 2. Remove from deviceIds + userDeviceInfo ----
    if (targetDeviceId) {
      const idRow = await ctx.db
        .query("deviceIds")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .first();
      const infoRow = await ctx.db
        .query("userDeviceInfo")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .first();

      if (idRow) {
        const keptIds: string[] = [];
        const keptInfos: any[] = [];
        for (let i = 0; i < idRow.ids.length; i++) {
          if (idRow.ids[i] !== targetDeviceId) {
            keptIds.push(idRow.ids[i]);
            keptInfos.push(infoRow?.infos?.[i] ?? {});
          }
        }
        await ctx.db.patch(idRow._id, { ids: keptIds });
        if (infoRow) await ctx.db.patch(infoRow._id, { infos: keptInfos });
      }
    }

    // ---- 3. PHYSICALLY DELETE sessions tied to this device ----
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const s of sessions) {
      const matchesDeviceId = args.deviceId && s.deviceId === args.deviceId;
      const matchesFingerprint =
        args.fingerprint && s.deviceFingerprint === args.fingerprint;
      if (matchesDeviceId || matchesFingerprint) {
        await ctx.db.delete(s._id);
      }
    }

    // ---- 4. Remove from legacy devices table ----
    if (targetDeviceId) {
      const row = await ctx.db
        .query("devices")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", targetDeviceId))
        .first();
      if (row) await ctx.db.delete(row._id);
    }
    if (args.fingerprint) {
      const rows = await ctx.db
        .query("devices")
        .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint!))
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
    }
  },
});

// ============================================================
// getUserDevicesForUI — ACTIVE SESSIONS ONLY
// ------------------------------------------------------------
// The device list shown to the user is driven EXCLUSIVELY by
// sessions that are currently active (not revoked, not expired).
//
// Enrichment sources (deviceIds, userDeviceInfo, users.devices[])
// are used only to attach friendly metadata to a device that
// already has an active session — never to add new entries.
//
// This is what prevents the "500 devices" problem after many
// logins/logouts over time.
// ============================================================
export const getUserDevicesForUI = internalQuery({
  args: {
    userId: v.id("users"),
    currentDeviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return [];

    // ---- Source of truth: ACTIVE sessions only ----
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const now = Date.now();
    const activeSessions = sessions.filter(
      (s) => !s.revoked && s.expiresAt > now
    );

    // Deduplicate by deviceId — keep the most-recently-seen session
    const byDevice = new Map<string, (typeof activeSessions)[number]>();
    for (const s of activeSessions) {
      const prev = byDevice.get(s.deviceId);
      if (!prev || s.lastSeen > prev.lastSeen) byDevice.set(s.deviceId, s);
    }

    // ---- Enrichment: device metadata (never used to add entries) ----
    const idRow = await ctx.db
      .query("deviceIds")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    const infoRow = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const infoById = new Map<string, any>();
    if (idRow && infoRow) {
      for (let i = 0; i < idRow.ids.length; i++) {
        if (infoRow.infos[i]) infoById.set(idRow.ids[i], infoRow.infos[i]);
      }
    }

    // Also keep legacy users.devices[] as a fallback for displayName
    const legacyById = new Map<string, any>();
    for (const d of user.devices || []) {
      const id = (d as any).deviceId || d.fingerprint;
      if (id) legacyById.set(id, d);
    }

    // ---- Build the result — only devices with active sessions ----
    const result: Array<{
      deviceId: string;
      deviceName: string;
      platform: string;
      lastSeen: number;
      isCurrent: boolean;
      sessionId: string;
      fingerprint: string;
    }> = [];

    for (const [deviceId, session] of byDevice) {
      const info = infoById.get(deviceId) || {};
      const legacy = legacyById.get(deviceId);
      const platform =
        info.platform || session.platform || legacy?.platform || "unknown";
      const deviceName =
        buildDisplayName(info) ||
        legacy?.displayName ||
        session.platform ||
        "Unknown device";

      result.push({
        deviceId,
        deviceName,
        platform,
        lastSeen: session.lastSeen,
        isCurrent: args.currentDeviceId === deviceId,
        sessionId: session.sessionId,
        fingerprint: session.deviceFingerprint || deviceId,
      });
    }

    // Sort: current device first, then most recently seen
    result.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      return b.lastSeen - a.lastSeen;
    });

    return result;
  },
});

// ============================================================
// getActiveDeviceCount — ACTIVE SESSIONS ONLY
// ------------------------------------------------------------
// Used by the device-limit gate. Counts unique deviceIds that
// currently have an active session.
// ============================================================
export const getActiveDeviceCount = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const activeDevices = new Set<string>();
    for (const s of sessions) {
      if (!s.revoked && s.expiresAt > now) {
        activeDevices.add(s.deviceId);
      }
    }
    return activeDevices.size;
  },
});

// ============================================================
// purgeRevokedSessions — physically delete dead sessions
// ------------------------------------------------------------
// Deletes any session that is either revoked or expired.
// Called opportunistically at login, on Manage Devices load,
// and by the hourly cron.
// ============================================================
export const purgeRevokedSessions = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let deleted = 0;

    let sessions;
    if (args.userId) {
      sessions = await ctx.db
        .query("sessions")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId!))
        .collect();
    } else {
      sessions = await ctx.db.query("sessions").collect();
    }

    for (const s of sessions) {
      if (s.revoked || s.expiresAt < now) {
        await ctx.db.delete(s._id);
        deleted++;
      }
    }

    return { deleted };
  },
});

// ============================================================
// pruneUserDevicesArray — keep users.devices[] in sync
// ------------------------------------------------------------
// Trims users.devices[] down to the set of deviceIds that still
// have an active session. Enrichment tables are left alone.
// ============================================================
export const pruneUserDevicesArray = internalMutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { removed: 0 };

    const now = Date.now();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const activeIds = new Set(
      sessions
        .filter((s) => !s.revoked && s.expiresAt > now)
        .map((s) => s.deviceId)
    );

    const original = user.devices || [];
    const pruned = original.filter((d) => {
      const id = (d as any).deviceId || d.fingerprint;
      return id && activeIds.has(id);
    });

    if (pruned.length !== original.length) {
      await ctx.db.patch(args.userId, { devices: pruned });
      return { removed: original.length - pruned.length };
    }
    return { removed: 0 };
  },
});

export const updateUserPreferences = internalMutation({
  args: {
    userId: v.id("users"),
    preferences: v.object({
      theme: v.optional(v.string()),
      notifications: v.optional(
        v.object({
          examReminders: v.optional(v.boolean()),
          subscriptionExpiry: v.optional(v.boolean()),
          newFeatures: v.optional(v.boolean()),
        })
      ),
      dataUsage: v.optional(
        v.object({
          syncOnMobile: v.optional(v.boolean()),
          downloadImages: v.optional(v.string()),
          cacheSize: v.optional(v.string()),
        })
      ),
    }),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    await ctx.db.patch(args.userId, { preferences: args.preferences });
  },
});

export const deleteUserById = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // Sessions
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const s of sessions) await ctx.db.delete(s._id);

    // Devices table
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const d of devices) await ctx.db.delete(d._id);

    // deviceIds + userDeviceInfo
    const idRow = await ctx.db
      .query("deviceIds")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (idRow) await ctx.db.delete(idRow._id);

    const infoRow = await ctx.db
      .query("userDeviceInfo")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (infoRow) await ctx.db.delete(infoRow._id);

    // Auth identities
    const identities = await ctx.db
      .query("authIdentities")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const id of identities) await ctx.db.delete(id._id);

    await ctx.db.delete(args.userId);
  },
});

// ============================================================
// AUTH IDENTITY HELPERS (multi-provider model)
// ============================================================

export const getAuthIdentity = internalQuery({
  args: {
    provider: v.union(v.literal("password"), v.literal("google")),
    providerSubject: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("authIdentities")
      .withIndex("by_provider_subject", (q) =>
        q.eq("provider", args.provider).eq("providerSubject", args.providerSubject)
      )
      .first();
  },
});

export const getAuthIdentitiesForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("authIdentities")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const getUserAuthIdentityByProvider = internalQuery({
  args: {
    userId: v.id("users"),
    provider: v.union(v.literal("password"), v.literal("google")),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("authIdentities")
      .withIndex("by_userId_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider)
      )
      .first();
  },
});

export const createAuthIdentity = internalMutation({
  args: {
    userId: v.id("users"),
    provider: v.union(v.literal("password"), v.literal("google")),
    providerSubject: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authIdentities")
      .withIndex("by_provider_subject", (q) =>
        q.eq("provider", args.provider).eq("providerSubject", args.providerSubject)
      )
      .first();
    if (existing) {
      throw new Error(
        `Auth identity already exists for ${args.provider}:${args.providerSubject}`
      );
    }
    const now = Date.now();
    return await ctx.db.insert("authIdentities", {
      userId: args.userId,
      provider: args.provider,
      providerSubject: args.providerSubject,
      createdAt: now,
      lastUsedAt: now,
    });
  },
});

export const createPasswordIdentity = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("authIdentities")
      .withIndex("by_userId_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "password")
      )
      .first();
    if (existing) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("authIdentities", {
      userId: args.userId,
      provider: "password",
      providerSubject: String(args.userId),
      createdAt: now,
      lastUsedAt: now,
    });
  },
});

export const touchAuthIdentity = internalMutation({
  args: { identityId: v.id("authIdentities") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.identityId, { lastUsedAt: Date.now() });
  },
});

export const deleteAuthIdentityById = internalMutation({
  args: { identityId: v.id("authIdentities") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.identityId);
  },
});

export const deleteAuthIdentitiesForUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const identities = await ctx.db
      .query("authIdentities")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const id of identities) await ctx.db.delete(id._id);
    return identities.length;
  },
});

// ============================================================
// GOOGLE OAUTH HELPERS
// ============================================================

export const getUserByGoogleSubject = internalQuery({
  args: { googleSubject: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_googleSubject", (q) => q.eq("googleSubject", args.googleSubject))
      .first();
  },
});

export const insertGoogleUser = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    googleSubject: v.string(),
    googleEmail: v.string(),
    googlePicture: v.optional(v.string()),
    username: v.string(),
    displayName: v.string(),
    referralCode: v.string(),
    referredBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      phone: args.phone || "",
      passwordHash: `GOOGLE_OAUTH_ONLY_NO_PASSWORD_${Math.random().toString(36).slice(2)}`,
      securityQuestions: [],
      isLocked: false,
      trialUsed: false,
      devices: [],
      role: "user",
      username: args.username,
      displayName: args.displayName,
      lastSeen: now,
      status: "online",
      referralCode: args.referralCode,
      referredBy: args.referredBy,
      isAgent: false,
      agentVerified: false,
      referralBalance: 0,
      totalEarned: 0,
      pendingBalance: 0,
      referralRewarded: false,
      createdAt: now,
      rating: 100,
      historyEWMA: 0.5,
      completedExams: 0,
      startedExams: 0,
      leaderboardPoints: 0,
      integrityScore: 1,
      googleSubject: args.googleSubject,
      googleEmail: args.googleEmail,
      googlePicture: args.googlePicture,
    });
    return userId;
  },
});

export const linkGoogleAccount = internalMutation({
  args: {
    userId: v.id("users"),
    googleSubject: v.string(),
    googleEmail: v.string(),
    googlePicture: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      googleSubject: args.googleSubject,
      googleEmail: args.googleEmail,
      googlePicture: args.googlePicture,
    });
  },
});

// ============================================================
// SECURITY EVENTS & AUDIT LOG
// ============================================================

export const logSecurityEvent = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    eventType: v.string(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("securityEvents", {
      userId: args.userId,
      eventType: args.eventType,
      timestamp: Date.now(),
      metadata: args.metadata,
    });
  },
});

export const logAuditEvent = internalMutation({
  args: {
    actorId: v.string(),
    action: v.string(),
    targetId: v.optional(v.string()),
    details: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      actorId: args.actorId,
      action: args.action,
      targetId: args.targetId,
      timestamp: Date.now(),
      details: args.details,
    });
  },
});

// ============================================================
// RATE LIMITING
// ============================================================

export const incrementRateLimit = internalMutation({
  args: {
    key: v.string(),
    endpoint: v.string(),
    resetAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rateLimit")
      .withIndex("by_key_endpoint", (q) =>
        q.eq("key", args.key).eq("endpoint", args.endpoint)
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        count: existing.count + 1,
        resetAt: args.resetAt,
      });
    } else {
      await ctx.db.insert("rateLimit", {
        key: args.key,
        endpoint: args.endpoint,
        count: 1,
        resetAt: args.resetAt,
      });
    }
  },
});

export const getRateLimit = internalQuery({
  args: {
    key: v.string(),
    endpoint: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rateLimit")
      .withIndex("by_key_endpoint", (q) =>
        q.eq("key", args.key).eq("endpoint", args.endpoint)
      )
      .first();
  },
});

export const lockUser = internalMutation({
  args: {
    userId: v.id("users"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      isLocked: true,
      lockReason: args.reason,
    });
    await ctx.db.insert("securityEvents", {
      userId: args.userId,
      eventType: "account_locked",
      timestamp: Date.now(),
      metadata: { reason: args.reason },
    });
  },
});

// ============================================================
// SESSION MANAGEMENT
// ============================================================

export const createSession = internalMutation({
  args: {
    userId: v.id("users"),
    deviceId: v.string(),
    deviceFingerprint: v.optional(v.string()),
    platform: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const sessionId =
      typeof crypto !== "undefined" &&
      typeof (crypto as any).randomUUID === "function"
        ? (crypto as any).randomUUID()
        : Math.random().toString(36).substring(2, 15) +
          Math.random().toString(36).substring(2, 15);
    const now = Date.now();
    await ctx.db.insert("sessions", {
      sessionId,
      userId: args.userId,
      deviceId: args.deviceId,
      deviceFingerprint: args.deviceFingerprint,
      platform: args.platform,
      createdAt: now,
      expiresAt: args.expiresAt,
      lastSeen: now,
      revoked: false,
    });
    await ctx.db.patch(args.userId, {
      activeSessionId: sessionId,
      activeDeviceId: args.deviceId,
    });
    return sessionId;
  },
});

export const revokeSession = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();
    if (!session) return;
    await ctx.db.delete(session._id);
    const user = await ctx.db
      .query("users")
      .withIndex("by_activeSessionId", (q) =>
        q.eq("activeSessionId", args.sessionId)
      )
      .first();
    if (user) {
      await ctx.db.patch(user._id, {
        activeSessionId: undefined,
        activeDeviceId: undefined,
      });
    }
  },
});

export const revokeAllSessions = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const s of sessions) {
      await ctx.db.delete(s._id);
    }
    await ctx.db.patch(args.userId, {
      activeSessionId: undefined,
      activeDeviceId: undefined,
    });
  },
});

export const revokeAllOtherSessions = internalMutation({
  args: {
    userId: v.id("users"),
    keepSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    let revokedCount = 0;
    for (const s of sessions) {
      if (s.sessionId !== args.keepSessionId) {
        await ctx.db.delete(s._id);
        revokedCount++;
      }
    }
    return { revokedCount };
  },
});

export const getActiveSession = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.activeSessionId) return null;
    return await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) =>
        q.eq("sessionId", user.activeSessionId!)
      )
      .first();
  },
});

export const getSessionByDeviceId = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
  },
});

export const getSessionsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const getSessionBySessionId = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();
  },
});

export const updateSessionLastSeen = internalMutation({
  args: { sessionId: v.string(), lastSeen: v.number() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();
    if (session) {
      await ctx.db.patch(session._id, { lastSeen: args.lastSeen });
    }
  },
});

export const cleanupExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("sessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .collect();
    for (const s of expired) {
      await ctx.db.delete(s._id);
    }
    return expired.length;
  },
});

// ============================================================
// CLEANUP OLD DEVICES — periodic reconciliation
// ------------------------------------------------------------
// Runs every few hours via cron. For each user:
//   - Purges revoked/expired sessions
//   - Prunes users.devices[] to the set of active deviceIds
// Never touches a live session.
// ============================================================
export const cleanupOldDevices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const now = Date.now();
    let totalRemovedDevices = 0;
    let totalDeletedSessions = 0;

    for (const user of users) {
      // ---- Purge dead sessions ----
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();

      const activeIds = new Set<string>();
      for (const s of sessions) {
        if (s.revoked || s.expiresAt < now) {
          await ctx.db.delete(s._id);
          totalDeletedSessions++;
        } else {
          activeIds.add(s.deviceId);
        }
      }

      // ---- Trim users.devices[] ----
      const devices = user.devices || [];
      const filtered = devices.filter((d) => {
        const id = (d as any).deviceId || d.fingerprint;
        return id && activeIds.has(id);
      });
      if (filtered.length < devices.length) {
        await ctx.db.patch(user._id, { devices: filtered });
        totalRemovedDevices += devices.length - filtered.length;
      }
    }

    return {
      removedDevices: totalRemovedDevices,
      deletedSessions: totalDeletedSessions,
    };
  },
});