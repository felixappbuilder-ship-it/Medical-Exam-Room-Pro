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
    // Referral fields – referralCode is optional (frontend may not send it)
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
      // Referral fields – default to empty string if not provided
      referralCode: args.referralCode || "",
      referredBy: args.referredBy,
      isAgent: args.isAgent,
      agentVerified: args.agentVerified || false,
      referralBalance: args.referralBalance,
      totalEarned: args.totalEarned,
      pendingBalance: args.pendingBalance,
      referralRewarded: false,
      // ✅ Performance tracking defaults
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
      // Referral fields (admin might update these)
      isAgent: v.optional(v.boolean()),
      agentVerified: v.optional(v.boolean()),
      referralBalance: v.optional(v.number()),
      pendingBalance: v.optional(v.number()),
      totalEarned: v.optional(v.number()),
      referralRewarded: v.optional(v.boolean()),
      // ✅ Performance fields (admin or internal updates)
      rating: v.optional(v.number()),
      historyEWMA: v.optional(v.number()),
      completedExams: v.optional(v.number()),
      startedExams: v.optional(v.number()),
      leaderboardPoints: v.optional(v.number()),
      integrityScore: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, args.updates);
  },
});

export const addDevice = internalMutation({
  args: {
    userId: v.id("users"),
    fingerprint: v.string(),
    lastUsed: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const devices = user.devices || [];
    const existingIndex = devices.findIndex((d) => d.fingerprint === args.fingerprint);
    if (existingIndex >= 0) {
      devices[existingIndex].lastUsed = args.lastUsed;
    } else {
      devices.push({ fingerprint: args.fingerprint, lastUsed: args.lastUsed });
    }
    await ctx.db.patch(args.userId, { devices });
  },
});

export const removeDeviceByFingerprint = internalMutation({
  args: {
    userId: v.id("users"),
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const devices = user.devices || [];
    const updated = devices.filter((d) => d.fingerprint !== args.fingerprint);
    await ctx.db.patch(args.userId, { devices: updated });
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
    await ctx.db.patch(args.userId, {
      preferences: args.preferences,
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
      .withIndex("by_key_endpoint", (q) => q.eq("key", args.key).eq("endpoint", args.endpoint))
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
      .withIndex("by_key_endpoint", (q) => q.eq("key", args.key).eq("endpoint", args.endpoint))
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
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
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
    await ctx.db.patch(session._id, { revoked: true });
    const user = await ctx.db
      .query("users")
      .withIndex("by_activeSessionId", (q) => q.eq("activeSessionId", args.sessionId))
      .first();
    if (user) {
      await ctx.db.patch(user._id, { activeSessionId: undefined, activeDeviceId: undefined });
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
      await ctx.db.patch(s._id, { revoked: true });
    }
    await ctx.db.patch(args.userId, { activeSessionId: undefined, activeDeviceId: undefined });
  },
});

export const getActiveSession = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || !user.activeSessionId) return null;
    return await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", user.activeSessionId))
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
      await ctx.db.patch(s._id, { revoked: true });
    }
    const users = await ctx.db
      .query("users")
      .filter((q) => q.neq(q.field("activeSessionId"), undefined))
      .collect();
    for (const user of users) {
      if (user.activeSessionId) {
        const session = await ctx.db
          .query("sessions")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", user.activeSessionId))
          .first();
        if (!session || session.revoked || session.expiresAt < now) {
          await ctx.db.patch(user._id, { activeSessionId: undefined, activeDeviceId: undefined });
        }
      }
    }
    return expired.length;
  },
});

// ============================================================
// CLEANUP OLD DEVICES (called by cron every 4 days)
// ============================================================
export const cleanupOldDevices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let totalRemoved = 0;
    let totalSessionsRevoked = 0;

    for (const user of users) {
      let activeDeviceId: string | null = null;
      if (user.activeSessionId) {
        const activeSession = await ctx.db
          .query("sessions")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", user.activeSessionId))
          .first();
        if (activeSession && !activeSession.revoked && activeSession.expiresAt > Date.now()) {
          activeDeviceId = activeSession.deviceId;
        }
      }

      const devices = user.devices || [];
      if (devices.length > 0) {
        const filteredDevices = activeDeviceId
          ? devices.filter((d) => d.fingerprint === activeDeviceId)
          : [];
        if (filteredDevices.length < devices.length) {
          await ctx.db.patch(user._id, { devices: filteredDevices });
          totalRemoved += devices.length - filteredDevices.length;
        }
      }

      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .collect();
      for (const session of sessions) {
        if (session.sessionId !== user.activeSessionId && !session.revoked) {
          await ctx.db.patch(session._id, { revoked: true });
          totalSessionsRevoked++;
        }
      }
    }

    return { removedDevices: totalRemoved, revokedSessions: totalSessionsRevoked };
  },
});