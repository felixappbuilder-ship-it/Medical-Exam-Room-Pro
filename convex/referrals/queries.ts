// convex/referrals/queries.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Helper: verify token and get user (works inside actions)
async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error(result.message);
  const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId: result.data.userId });
  if (!user) throw new Error("User not found");
  return user;
}

// ============================================================
// 1. Get Referral Dashboard
// ============================================================
export const getReferralDashboard = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    // Fetch referred users and stats via internal queries
    const referredUsers = await ctx.runQuery(internal.users.internal.getReferredUsers, {
      userId: user._id,
    });
    const stats = await ctx.runQuery(internal.users.internal.getReferralStats, {
      userId: user._id,
    });
    return {
      success: true,
      data: {
        referralCode: user.referralCode,
        balance: user.referralBalance || 0,
        totalEarned: user.totalEarned || 0,
        pendingBalance: user.pendingBalance || 0,
        referrals: referredUsers,
        count: stats.count,
        successful: stats.successful,
        isAgent: user.isAgent || false,
      },
    };
  },
});

// ============================================================
// 2. Get Agent Dashboard (extends referral dashboard)
// ============================================================
export const getAgentDashboard = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    if (!user.isAgent) {
      return { success: false, error: "unauthorized", message: "Not an agent" };
    }
    // Reuse referral dashboard data
    const result = await getReferralDashboard(ctx, args);
    return result;
  },
});

// ============================================================
// 3. Validate a referral code (public, no token needed)
// ============================================================
export const validateReferralCode = action({
  args: { referralCode: v.string() },
  handler: async (ctx, args) => {
    const referrer = await ctx.runQuery(internal.users.internal.getUserByReferralCode, {
      referralCode: args.referralCode,
    });
    if (!referrer) {
      return {
        success: true,
        data: { valid: false, referrerName: null, isAgent: false },
      };
    }
    return {
      success: true,
      data: {
        valid: true,
        referrerName: referrer.displayName || referrer.name,
        isAgent: referrer.isAgent || false,
      },
    };
  },
});