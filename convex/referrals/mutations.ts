import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error(result.message);
  const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId: result.data.userId });
  if (!user) throw new Error("User not found");
  return user;
}

export const requestWithdrawal = mutation({
  args: {
    token: v.string(),
    amount: v.number(),
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    if (user.referralBalance < args.amount) {
      return { success: false, error: "insufficient_balance", message: "Not enough balance" };
    }
    if (args.amount < 100) {
      return { success: false, error: "min_withdrawal", message: "Minimum withdrawal is KSh 100" };
    }
    // Deduct from available balance, add to pending
    const newBalance = user.referralBalance - args.amount;
    const newPending = (user.pendingBalance || 0) + args.amount;
    await ctx.db.patch(user._id, {
      referralBalance: newBalance,
      pendingBalance: newPending,
    });
    // Create withdrawal request
    await ctx.db.insert("withdrawals", {
      userId: user._id,
      amount: args.amount,
      status: "pending",
      method: "mpesa",
      phoneNumber: args.phoneNumber,
      requestedAt: Date.now(),
    });
    // Audit log (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "request_withdrawal",
      targetId: user._id,
      details: { amount: args.amount },
    });
    return { success: true, data: { message: "Withdrawal request submitted" } };
  },
});