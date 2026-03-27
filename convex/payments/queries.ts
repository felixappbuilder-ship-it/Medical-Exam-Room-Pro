import { v } from "convex/values";
import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";

// -----------------------------------------------------------------------------
// Check payment status by transactionId (our internal ID)
// -----------------------------------------------------------------------------
export const checkPaymentStatus = query({
  args: {
    transactionId: v.string(), // This is the paymentId stored in payments.transactionId
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const payment = await ctx.db
      .query("payments")
      .withIndex("by_transactionId", (q: any) => q.eq("transactionId", args.transactionId))
      .first();

    if (!payment) throw new ConvexError("Payment not found");

    // Ensure the payment belongs to the current user
    if (payment.userId !== identity.subject) throw new ConvexError("Unauthorized");

    return {
      status: payment.status,
      mpesaReceipt: payment.mpesaReceipt,
      completedAt: payment.completedAt,
    };
  },
});

// -----------------------------------------------------------------------------
// Get payment history for current user
// -----------------------------------------------------------------------------
export const getPaymentHistory = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;

    const payments = await ctx.db
      .query("payments")
      .withIndex("by_userId", (q: any) => q.eq("userId", identity.subject))
      .order("desc")
      .take(limit + offset);

    return payments.slice(offset).map((p) => ({
      _id: p._id,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      mpesaReceipt: p.mpesaReceipt,
      createdAt: p.createdAt,
      completedAt: p.completedAt,
      transactionId: p.transactionId,
    }));
  },
});