// convex/payments/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const checkPaymentStatus = query({
  args: { token: v.string(), transactionId: v.string() },
  handler: async (ctx, args) => {
    // Verify JWT
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
    } catch (err) {
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    const userId = payload.userId;
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_transactionId", (q) => q.eq("transactionId", args.transactionId))
      .first();

    if (!payment) {
      return {
        success: false,
        error: "payment_not_found",
        message: "No payment found with that transaction ID.",
      };
    }

    // Ensure user owns the payment
    if (payment.userId !== userId) {
      return {
        success: false,
        error: "unauthorized",
        message: "You do not have permission to view this payment.",
      };
    }

    return {
      success: true,
      data: {
        status: payment.status,
        receipt: payment.mpesaReceipt || null,
        amount: payment.amount,
        updatedAt: payment.updatedAt,
      },
    };
  },
});

export const getPaymentHistory = query({
  args: { token: v.string(), limit: v.optional(v.number()), cursor: v.optional(v.id("payments")) },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
    } catch (err) {
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    const userId = payload.userId;
    const limit = args.limit || 20;
    let query = ctx.db
      .query("payments")
      .withIndex("by_userId_status", (q) => q.eq("userId", userId));
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const payments = await query.take(limit + 1);
    const hasMore = payments.length > limit;
    const results = payments.slice(0, limit);
    const nextCursor = hasMore ? results[results.length - 1]._id : null;

    // Remove sensitive internal fields
    const sanitized = results.map((p) => ({
      transactionId: p.transactionId,
      amount: p.amount,
      status: p.status,
      receipt: p.mpesaReceipt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    return {
      success: true,
      data: {
        payments: sanitized,
        nextCursor,
        hasMore,
      },
    };
  },
});