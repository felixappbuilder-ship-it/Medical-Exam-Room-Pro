// convex/referrals/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// REFERRAL WITHDRAWAL INTERNAL MUTATIONS
// ============================================================

/**
 * Update user's referral balances atomically.
 */
export const updateReferralBalances = internalMutation({
  args: {
    userId: v.id("users"),
    referralBalance: v.number(),
    pendingBalance: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      referralBalance: args.referralBalance,
      pendingBalance: args.pendingBalance,
    });
  },
});

/**
 * Create a withdrawal request – uses the phone number provided by the user.
 */
export const createWithdrawal = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("withdrawals", {
      userId: args.userId,
      amount: args.amount,
      status: "pending",
      method: "mpesa",
      phoneNumber: args.phoneNumber, // ✅ uses frontend-provided number
      requestedAt: Date.now(),
    });
  },
});

/**
 * Fetch all withdrawal requests for a user.
 */
export const getUserWithdrawals = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("withdrawals")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});