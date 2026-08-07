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
// 4. USER DELETION
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
// 5. SYNC HELPERS
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
// 6. REFERRAL HELPERS
// ============================================================

// Helper: generate a random 8-character alphanumeric code
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

/**
 * Credit a referral reward to the referrer.
 * The amount should be pre‑calculated (proportional to days awarded).
 * The referred user's `referralRewarded` flag is set to true.
 */
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
// 7. GET REFERRED USERS (used by referral dashboard)
// ============================================================
export const getReferredUsers = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_referredBy", (q) => q.eq("referredBy", args.userId))
      .collect();
    // Return safe fields (exclude passwordHash, securityQuestions)
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