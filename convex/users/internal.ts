// convex/users/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// 1. USER FETCHING
// ============================================================

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
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

export const getUserByUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
  },
});

// NEW: Fetch user's referral info (agent status, referredBy, reward status)
export const getUserReferralInfo = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return {
      referredBy: user.referredBy,
      isAgent: user.isAgent || false,
      referralRewarded: user.referralRewarded || false,
      referralBalance: user.referralBalance || 0,
      totalEarned: user.totalEarned || 0,
    };
  },
});

// NEW: Get all users (used by cron jobs and admin)
export const getAllUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

// NEW: Get all user IDs (used by notifications for all-user broadcasts)
export const getAllUserIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.map((u) => u._id);
  },
});

// ============================================================
// 2. USER UPDATES
// ============================================================

export const updateUserById = internalMutation({
  args: {
    userId: v.id("users"),
    updates: v.object({
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      isLocked: v.optional(v.boolean()),
      lockReason: v.optional(v.string()),
      trialUsed: v.optional(v.boolean()),
      institution: v.optional(v.string()),
      yearOfStudy: v.optional(v.number()),
      role: v.optional(v.string()),
      username: v.optional(v.string()),
      displayName: v.optional(v.string()),
      lastLogin: v.optional(v.number()),
      lastSeen: v.optional(v.number()),
      preferences: v.optional(
        v.object({
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
        })
      ),
      status: v.optional(v.union(v.literal("online"), v.literal("offline"))),
      // Referral fields
      isAgent: v.optional(v.boolean()),
      agentVerified: v.optional(v.boolean()),
      referralBalance: v.optional(v.number()),
      pendingBalance: v.optional(v.number()),
      totalEarned: v.optional(v.number()),
      referralRewarded: v.optional(v.boolean()),
      // Exam encouragement
      lastExamEncouragementSentAt: v.optional(v.number()),
      examEncouragementOptOut: v.optional(v.boolean()),
      // Performance tracking fields
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

// NEW: Reset referral rewarded flag (for testing or admin correction)
export const resetReferralRewarded = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { referralRewarded: false });
  },
});

// ============================================================
// 3. DEVICE MANAGEMENT
// ============================================================

export const getUserDevices = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user?.devices || [];
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

export const addDevice = internalMutation({
  args: {
    userId: v.id("users"),
    fingerprint: v.string(),
    lastUsed: v.number(),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const devices = user.devices || [];
    const existingIndex = devices.findIndex((d) => d.fingerprint === args.fingerprint);
    if (existingIndex >= 0) {
      devices[existingIndex].lastUsed = args.lastUsed;
      if (args.platform) devices[existingIndex].platform = args.platform;
    } else {
      devices.push({ fingerprint: args.fingerprint, lastUsed: args.lastUsed, platform: args.platform });
    }
    await ctx.db.patch(args.userId, { devices });
  },
});

// ============================================================
// 4. USER DELETION (simple hard delete – used by admin or legacy)
// ============================================================

export const deleteUserById = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const s of sessions) {
      await ctx.db.delete(s._id);
    }
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const d of devices) {
      await ctx.db.delete(d._id);
    }
    await ctx.db.delete(args.userId);
  },
});

// ============================================================
// 5. COMPREHENSIVE USER DATA DELETION (GDPR / privacy)
//    Deletes all personal data, anonymizes payments & audit logs.
//    Used by deleteAccount action and dormant account cron.
// ============================================================

export const deleteAllUserData = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const userId = args.userId;

    const user = await ctx.db.get(userId);
    if (!user) return;

    // 1. Delete sessions
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const s of sessions) await ctx.db.delete(s._id);

    // 2. Delete devices (from the separate devices table)
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const d of devices) await ctx.db.delete(d._id);

    // 3. Delete exam results and answers
    const examResults = await ctx.db
      .query("examResults")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const er of examResults) {
      const answers = await ctx.db
        .query("examAnswers")
        .withIndex("by_examResultId", (q) => q.eq("examResultId", er._id))
        .collect();
      for (const a of answers) await ctx.db.delete(a._id);
      await ctx.db.delete(er._id);
    }

    // 4. Delete seenQuestions
    const seen = await ctx.db
      .query("seenQuestions")
      .withIndex("by_user_subject_topic", (q) => q.eq("userId", userId))
      .collect();
    for (const s of seen) await ctx.db.delete(s._id);

    // 5. Delete notes
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_userId_updatedAt", (q) => q.eq("userId", userId))
      .collect();
    for (const n of notes) await ctx.db.delete(n._id);

    // 6. Delete conversations and their chunks/summaries
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_userId_updatedAt", (q) => q.eq("userId", userId))
      .collect();
    for (const conv of conversations) {
      const chunks = await ctx.db
        .query("conversation_chunks")
        .withIndex("by_conversationId_chunkNumber", (q) => q.eq("conversationId", conv._id))
        .collect();
      for (const c of chunks) await ctx.db.delete(c._id);
      const summaries = await ctx.db
        .query("summaries")
        .withIndex("by_conversationId_createdAt", (q) => q.eq("conversationId", conv._id))
        .collect();
      for (const s of summaries) await ctx.db.delete(s._id);
      await ctx.db.delete(conv._id);
    }

    // 7. Delete sharedLinks created by the user
    const links = await ctx.db
      .query("sharedLinks")
      .withIndex("by_user_target", (q) => q.eq("userId", userId))
      .collect();
    for (const l of links) await ctx.db.delete(l._id);

    // 8. Delete notifications
    const notifs = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read", (q) => q.eq("userId", userId))
      .collect();
    for (const n of notifs) await ctx.db.delete(n._id);

    // 9. Delete withdrawals
    const withdrawals = await ctx.db
      .query("withdrawals")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const w of withdrawals) await ctx.db.delete(w._id);

    // 10. Delete wallet and walletTransactions
    const wallet = await ctx.db
      .query("wallets")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (wallet) {
      const txns = await ctx.db
        .query("walletTransactions")
        .withIndex("by_walletId", (q) => q.eq("walletId", wallet._id))
        .collect();
      for (const t of txns) await ctx.db.delete(t._id);
      await ctx.db.delete(wallet._id);
    }

    // 11. Delete subscription records
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const s of subs) await ctx.db.delete(s._id);

    // 12. Delete challenge participants and results
    const challengeParticipants = await ctx.db
      .query("challengeParticipants")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const cp of challengeParticipants) await ctx.db.delete(cp._id);

    const challengeResults = await ctx.db
      .query("results")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const r of challengeResults) await ctx.db.delete(r._id);

    // 13. Delete chat messages sent by user
    const chatMessages = await ctx.db
      .query("chatMessages")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();
    for (const cm of chatMessages) await ctx.db.delete(cm._id);

    // 14. Anonymize payments (set userId to null) – keep for financial records
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_userId_status", (q) => q.eq("userId", userId))
      .collect();
    for (const p of payments) {
      await ctx.db.patch(p._id, { userId: undefined });
    }

    // 15. Anonymize audit logs (set actorId to "deleted_user" and targetId to undefined)
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_actorId_timestamp", (q) => q.eq("actorId", userId))
      .collect();
    for (const log of logs) {
      await ctx.db.patch(log._id, { actorId: "deleted_user", targetId: undefined });
    }

    // 16. Anonymize securityEvents (set userId to undefined)
    const events = await ctx.db
      .query("securityEvents")
      .withIndex("by_userId_timestamp", (q) => q.eq("userId", userId))
      .collect();
    for (const e of events) {
      await ctx.db.patch(e._id, { userId: undefined });
    }

    // 17. Anonymize sharedExams (set userId to undefined)
    const sharedExams = await ctx.db
      .query("sharedExams")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();
    for (const se of sharedExams) {
      await ctx.db.patch(se._id, { userId: undefined });
    }

    // 18. Finally, delete the user document itself
    await ctx.db.delete(userId);
  },
});

// ============================================================
// 6. SYNC HELPERS
// ============================================================

export const getUserStatistics = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const examResults = await ctx.db
      .query("examResults")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    const totalExams = examResults.length;
    const totalQuestions = examResults.reduce((acc, e) => acc + (e.totalQuestions || 0), 0);
    const avgScore = totalExams > 0 ? examResults.reduce((acc, e) => acc + (e.scorePercentage || e.score || 0), 0) / totalExams : 0;
    const totalStudyTime = examResults.reduce((acc, e) => acc + (e.timeSpent || 0), 0);
    return {
      totalExams,
      totalQuestions,
      averageScore: avgScore,
      totalStudyTime,
    };
  },
});

// ============================================================
// 7. REFERRAL HELPERS
// ============================================================

function generateRandomCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export const generateUniqueReferralCode = internalMutation({
  args: {},
  handler: async (ctx) => {
    let code = generateRandomCode();
    let attempts = 0;
    while (attempts < 100) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_referralCode", (q) => q.eq("referralCode", code))
        .first();
      if (!existing) return code;
      code = generateRandomCode();
      attempts++;
    }
    throw new Error("Could not generate unique referral code");
  },
});

export const getUserByReferralCode = internalQuery({
  args: { referralCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_referralCode", (q) => q.eq("referralCode", args.referralCode))
      .first();
  },
});

export const getReferralStats = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const referredUsers = await ctx.db
      .query("users")
      .withIndex("by_referredBy", (q) => q.eq("referredBy", args.userId))
      .collect();
    const count = referredUsers.length;
    let successful = 0;
    for (const u of referredUsers) {
      const payments = await ctx.db
        .query("payments")
        .withIndex("by_userId_status", (q) => q.eq("userId", u._id).eq("status", "completed"))
        .collect();
      if (payments.length > 0) successful++;
    }
    return { count, successful };
  },
});

export const creditReferralReward = internalMutation({
  args: {
    referrerId: v.id("users"),
    referredUserId: v.id("users"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    const referrer = await ctx.db.get(args.referrerId);
    if (!referrer) return;
    const newBalance = (referrer.referralBalance || 0) + args.amount;
    const newTotal = (referrer.totalEarned || 0) + args.amount;
    await ctx.db.patch(args.referrerId, {
      referralBalance: newBalance,
      totalEarned: newTotal,
    });
    await ctx.db.patch(args.referredUserId, { referralRewarded: true });
  },
});

// ============================================================
// 8. GET REFERRED USERS (used by referral dashboard)
// ============================================================
export const getReferredUsers = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_referredBy", (q) => q.eq("referredBy", args.userId))
      .collect();
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      displayName: u.displayName,
      createdAt: u.createdAt,
      isAgent: u.isAgent || false,
      referralBalance: u.referralBalance || 0,
      totalEarned: u.totalEarned || 0,
    }));
  },
});

// ============================================================
// 9. PERFORMANCE HELPERS
// ============================================================

export const incrementLeaderboardPoints = internalMutation({
  args: {
    userId: v.id("users"),
    points: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const current = user.leaderboardPoints || 0;
    await ctx.db.patch(args.userId, {
      leaderboardPoints: current + args.points,
    });
  },
});

export const updateUserPerformance = internalMutation({
  args: {
    userId: v.id("users"),
    rating: v.number(),
    historyEWMA: v.number(),
    completedExams: v.number(),
    startedExams: v.number(),
    leaderboardPoints: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: any = {
      rating: args.rating,
      historyEWMA: args.historyEWMA,
      completedExams: args.completedExams,
      startedExams: args.startedExams,
    };
    if (args.leaderboardPoints !== undefined) {
      updates.leaderboardPoints = args.leaderboardPoints;
    }
    await ctx.db.patch(args.userId, updates);
  },
});