// convex/payments/queries.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ============================================================
// 1. CHECK PAYMENT STATUS (for STK push polling)
// ============================================================
export const checkPaymentStatus = action({
  args: { token: v.string(), transactionId: v.string() },
  handler: async (ctx, args) => {
    console.log("[checkPaymentStatus] Called with transactionId:", args.transactionId);
    console.log("[checkPaymentStatus] Token present:", !!args.token);

    let payload;
    try {
      console.log("[checkPaymentStatus] Verifying token...");
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.warn("[checkPaymentStatus] Token verification failed:", result.message);
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
      console.log("[checkPaymentStatus] Token verified, userId:", payload.userId);
    } catch (err) {
      console.error("[checkPaymentStatus] Token verification error:", err);
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    const userId = payload.userId;
    console.log("[checkPaymentStatus] Querying payment for transactionId:", args.transactionId);
    const payment = await ctx.runQuery(
      internal.payments.internal.getPaymentByTransactionId,
      { transactionId: args.transactionId }
    );

    if (!payment) {
      console.warn("[checkPaymentStatus] No payment found for transactionId:", args.transactionId);
      return {
        success: false,
        error: "payment_not_found",
        message: "No payment found with that transaction ID.",
      };
    }
    console.log("[checkPaymentStatus] Payment found:", {
      paymentId: payment._id,
      status: payment.status,
      userId: payment.userId,
      amount: payment.amount,
    });

    if (payment.userId && payment.userId !== userId && payload.role !== "admin") {
      console.warn("[checkPaymentStatus] Unauthorized access – payment userId:", payment.userId, "requesting userId:", userId);
      return {
        success: false,
        error: "unauthorized",
        message: "You do not have permission to view this payment.",
      };
    }
    console.log("[checkPaymentStatus] Authorization passed.");

    return {
      success: true,
      data: {
        status: payment.status,
        receipt: payment.mpesaReceipt || null,
        amount: payment.amount,
        updatedAt: payment.updatedAt,
        mpesaCode: payment.mpesaCode || null,
        phoneNumber: payment.phoneNumber || null,
      },
    };
  },
});

// ============================================================
// 2. GET PENDING PAYMENTS BY PHONE NUMBER (for manual claim UI)
// ============================================================
export const getPendingPaymentsByPhone = action({
  args: { token: v.string(), phoneNumber: v.string() },
  handler: async (ctx, args) => {
    console.log("[getPendingPaymentsByPhone] Called for phone:", args.phoneNumber);
    console.log("[getPendingPaymentsByPhone] Token present:", !!args.token);

    let payload;
    try {
      console.log("[getPendingPaymentsByPhone] Verifying token...");
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.warn("[getPendingPaymentsByPhone] Token verification failed:", result.message);
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
      console.log("[getPendingPaymentsByPhone] Token verified, userId:", payload.userId);
    } catch (err) {
      console.error("[getPendingPaymentsByPhone] Token verification error:", err);
      return {
        success: false,
        error: "token_verification_failed",
        message: "Authentication failed.",
      };
    }

    const userId = payload.userId;
    console.log("[getPendingPaymentsByPhone] Fetching user by userId:", userId);
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) {
      console.warn("[getPendingPaymentsByPhone] User not found for userId:", userId);
      return { success: false, error: "user_not_found", message: "User not found." };
    }
    console.log("[getPendingPaymentsByPhone] User found:", { id: user._id, phone: user.phone });

    if (user.phone !== args.phoneNumber && payload.role !== "admin") {
      console.warn("[getPendingPaymentsByPhone] Phone mismatch – user.phone:", user.phone, "requested phone:", args.phoneNumber);
      return {
        success: false,
        error: "forbidden",
        message: "Phone number does not match your account.",
      };
    }
    console.log("[getPendingPaymentsByPhone] Phone number matches.");

    console.log("[getPendingPaymentsByPhone] Fetching pending payments for phone:", args.phoneNumber);
    const pending = await ctx.runQuery(internal.payments.internal.getPendingPaymentsByPhone, {
      phoneNumber: args.phoneNumber,
    });
    console.log("[getPendingPaymentsByPhone] Found", pending.length, "pending payments.");

    return {
      success: true,
      data: pending.map((p) => ({
        id: p._id,
        amount: p.amount,
        mpesaCode: p.mpesaCode || null,
        phoneNumber: p.phoneNumber || null,
        createdAt: p.createdAt,
        status: p.status,
        transactionId: p.transactionId,
      })),
    };
  },
});

// ============================================================
// 3. GET PAYMENT HISTORY (paginated)
// ============================================================
export const getPaymentHistory = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("payments")),
  },
  handler: async (ctx, args) => {
    console.log("[getPaymentHistory] Called with limit:", args.limit, "cursor:", args.cursor);
    console.log("[getPaymentHistory] Token present:", !!args.token);

    let payload;
    try {
      console.log("[getPaymentHistory] Verifying token...");
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.warn("[getPaymentHistory] Token verification failed:", result.message);
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
      console.log("[getPaymentHistory] Token verified, userId:", payload.userId);
    } catch (err) {
      console.error("[getPaymentHistory] Token verification error:", err);
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    const userId = payload.userId;
    const limit = args.limit || 20;
    console.log("[getPaymentHistory] Querying payments for user:", userId);
    const payments = await ctx.runQuery(
      internal.payments.internal.getPaymentHistoryByUser,
      { userId, limit, cursor: args.cursor }
    );

    const hasMore = payments.length > limit;
    const results = payments.slice(0, limit);
    const nextCursor = hasMore ? results[results.length - 1]._id : null;
    console.log("[getPaymentHistory] Retrieved", results.length, "payments, hasMore:", hasMore, "nextCursor:", nextCursor);

    const sanitized = results.map((p) => ({
      transactionId: p.transactionId,
      amount: p.amount,
      status: p.status,
      receipt: p.mpesaReceipt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      mpesaCode: p.mpesaCode || null,
      phoneNumber: p.phoneNumber || null,
      claimedAt: p.claimedAt || null,
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

// ============================================================
// 4. GET PAYMENT BY ID (Admin only)
// ============================================================
export const getPaymentById = action({
  args: {
    token: v.string(),
    paymentId: v.id("payments"),
  },
  handler: async (ctx, args) => {
    console.log("[getPaymentById] Called with paymentId:", args.paymentId);
    console.log("[getPaymentById] Token present:", !!args.token);

    let payload;
    try {
      console.log("[getPaymentById] Verifying token...");
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.warn("[getPaymentById] Token verification failed:", result.message);
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
      console.log("[getPaymentById] Token verified, userId:", payload.userId);
    } catch (err) {
      console.error("[getPaymentById] Token verification error:", err);
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    // Only admins can view payment by ID directly
    if (payload.role !== "admin") {
      console.warn("[getPaymentById] Forbidden – user role:", payload.role);
      return {
        success: false,
        error: "forbidden",
        message: "Admin access required.",
      };
    }

    console.log("[getPaymentById] Fetching payment by ID:", args.paymentId);
    const payment = await ctx.runQuery(internal.payments.internal.getPaymentById, {
      paymentId: args.paymentId,
    });

    if (!payment) {
      console.warn("[getPaymentById] Payment not found for ID:", args.paymentId);
      return {
        success: false,
        error: "payment_not_found",
        message: "Payment not found.",
      };
    }

    console.log("[getPaymentById] Payment found:", {
      paymentId: payment._id,
      status: payment.status,
      userId: payment.userId,
      amount: payment.amount,
    });

    return {
      success: true,
      data: {
        id: payment._id,
        transactionId: payment.transactionId,
        amount: payment.amount,
        status: payment.status,
        userId: payment.userId,
        phoneNumber: payment.phoneNumber,
        mpesaReceipt: payment.mpesaReceipt,
        mpesaCode: payment.mpesaCode,
        merchantRequestId: payment.merchantRequestId,
        checkoutRequestId: payment.checkoutRequestId,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        claimedAt: payment.claimedAt,
        claimedByUserId: payment.claimedByUserId,
      },
    };
  },
});

// ============================================================
// 5. GET B2C TRANSACTION STATUS (Admin only)
// ============================================================
export const getB2CTransactionStatus = action({
  args: {
    token: v.string(),
    originatorConversationID: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[getB2CTransactionStatus] Called with originatorConversationID:", args.originatorConversationID);
    console.log("[getB2CTransactionStatus] Token present:", !!args.token);

    let payload;
    try {
      console.log("[getB2CTransactionStatus] Verifying token...");
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.warn("[getB2CTransactionStatus] Token verification failed:", result.message);
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
      console.log("[getB2CTransactionStatus] Token verified, userId:", payload.userId);
    } catch (err) {
      console.error("[getB2CTransactionStatus] Token verification error:", err);
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    if (payload.role !== "admin") {
      console.warn("[getB2CTransactionStatus] Forbidden – user role:", payload.role);
      return {
        success: false,
        error: "forbidden",
        message: "Admin access required.",
      };
    }

    console.log("[getB2CTransactionStatus] Fetching B2C transaction by originatorConversationID:", args.originatorConversationID);
    const b2c = await ctx.runQuery(
      internal.payments.internal.getB2CByOriginatorConversationID,
      { originatorConversationID: args.originatorConversationID }
    );

    if (!b2c) {
      console.warn("[getB2CTransactionStatus] B2C transaction not found for:", args.originatorConversationID);
      return {
        success: false,
        error: "not_found",
        message: "B2C transaction not found.",
      };
    }

    return {
      success: true,
      data: {
        id: b2c._id,
        transactionId: b2c.transactionId,
        originatorConversationID: b2c.originatorConversationID,
        conversationID: b2c.conversationID,
        amount: b2c.amount,
        phoneNumber: b2c.phoneNumber,
        status: b2c.status,
        requestPayload: b2c.requestPayload,
        responsePayload: b2c.responsePayload,
        resultPayload: b2c.resultPayload,
        createdAt: b2c.createdAt,
        updatedAt: b2c.updatedAt,
      },
    };
  },
});