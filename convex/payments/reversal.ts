// convex/payments/reversal.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

// ============================================================
// HELPER: Environment-aware endpoint selection
// ============================================================

function getOAuthTokenUrl(): string {
  const isTestMode = process.env.IS_TEST_MODE === "true";
  return isTestMode
    ? "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
    : "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
}

function getReversalUrl(): string {
  const isTestMode = process.env.IS_TEST_MODE === "true";
  return isTestMode
    ? "https://sandbox.safaricom.co.ke/mpesa/reversal/v1/request"
    : "https://api.safaricom.co.ke/mpesa/reversal/v1/request";
}

async function getMpesaAccessToken(): Promise<string> {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    throw new ConvexError("M-Pesa consumer credentials not configured");
  }
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const url = getOAuthTokenUrl();
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = await response.json();
  if (!data.access_token) {
    console.error("[getMpesaAccessToken] Failed to get access token:", data);
    throw new ConvexError("Failed to authenticate with M-Pesa: " + (data.errorMessage || "unknown"));
  }
  return data.access_token;
}

// ============================================================
// REQUEST REVERSAL (Admin only)
// ============================================================
export const requestReversal = action({
  args: {
    token: v.string(),
    paymentId: v.id("payments"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[requestReversal] Called with paymentId:", args.paymentId);
    console.log("[requestReversal] Token present:", !!args.token);

    // 1. Verify admin role
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.warn("[requestReversal] Token verification failed:", result.message);
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
      console.log("[requestReversal] Token verified, userId:", payload.userId);
    } catch (err) {
      console.error("[requestReversal] Token verification error:", err);
      return { success: false, error: "auth_failed", message: "Authentication failed" };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user || user.role !== "admin") {
      console.warn("[requestReversal] Forbidden – user role:", user?.role);
      return { success: false, error: "forbidden", message: "Admin access required" };
    }

    // 2. Validate reason
    if (!args.reason || args.reason.length < 2 || args.reason.length > 100) {
      console.warn("[requestReversal] Invalid reason length:", args.reason?.length);
      return { success: false, error: "invalid_reason", message: "Reason must be between 2 and 100 characters" };
    }

    // 3. Fetch payment
    console.log("[requestReversal] Fetching payment by ID:", args.paymentId);
    const payment = await ctx.runQuery(internal.payments.internal.getPaymentById, {
      paymentId: args.paymentId,
    });
    if (!payment) {
      console.warn("[requestReversal] Payment not found for ID:", args.paymentId);
      return { success: false, error: "payment_not_found", message: "Payment not found" };
    }
    console.log("[requestReversal] Payment found:", {
      id: payment._id,
      status: payment.status,
      amount: payment.amount,
      receipt: payment.mpesaReceipt,
    });

    // 4. Validate payment status
    if (payment.status !== "completed") {
      console.warn("[requestReversal] Invalid payment status:", payment.status);
      return {
        success: false,
        error: "invalid_status",
        message: "Only completed payments can be reversed",
      };
    }
    if (!payment.mpesaReceipt) {
      console.warn("[requestReversal] Missing M-PESA receipt");
      return {
        success: false,
        error: "missing_receipt",
        message: "M-PESA receipt not found for this payment",
      };
    }

    // 5. Check if a reversal already exists for this payment using internal query
    console.log("[requestReversal] Checking for existing reversals for payment:", args.paymentId);
    const existingReversals = await ctx.runQuery(
      internal.payments.internal.getReversalsByPaymentId,
      { paymentId: args.paymentId }
    );
    const hasCompleted = existingReversals.some((r) => r.status === "completed");
    if (hasCompleted) {
      console.warn("[requestReversal] Payment already reversed");
      return {
        success: false,
        error: "already_reversed",
        message: "This payment has already been reversed",
      };
    }

    // 6. Check test mode
    const isTestMode = process.env.IS_TEST_MODE === "true";
    if (isTestMode) {
      console.log("[TEST MODE] Mock reversal for payment:", args.paymentId);
      const mockOriginator = `mock_${Date.now()}`;
      // Create reversal record as completed
      await ctx.runMutation(internal.payments.internal.createReversal, {
        paymentId: args.paymentId,
        userId,
        originatorConversationID: mockOriginator,
        transactionID: payment.mpesaReceipt,
        amount: payment.amount,
        reason: args.reason,
        status: "completed",
        requestPayload: { mock: true },
      });
      // Update payment status to reversed using internal mutation
      await ctx.runMutation(internal.payments.internal.updatePaymentStatusById, {
        paymentId: args.paymentId,
        status: "reversed",
      });
      return {
        success: true,
        data: { originatorConversationID: mockOriginator, status: "completed" },
      };
    }

    // 7. Production: fetch credentials
    const initiatorName = process.env.MPESA_B2C_INITIATOR;
    const securityCredential = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
    const shortcode = process.env.MPESA_SHORTCODE;
    if (!initiatorName || !securityCredential || !shortcode) {
      console.error("[requestReversal] Missing B2C/Reversal credentials");
      throw new ConvexError(
        "Reversal credentials not configured (MPESA_B2C_INITIATOR, MPESA_B2C_SECURITY_CREDENTIAL, MPESA_SHORTCODE)"
      );
    }
    console.log("[requestReversal] Credentials OK");

    // 8. Prepare request
    const originatorConversationID = `REV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const baseUrl = process.env.MPESA_CALLBACK_URL?.replace(/\/stk.*/, "") || "";
    const requestBody = {
      Initiator: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: "TransactionReversal",
      TransactionID: payment.mpesaReceipt,
      Amount: payment.amount,
      ReceiverParty: shortcode,
      RecieverIdentifierType: "11",
      Remarks: args.reason,
      QueueTimeOutURL: `${baseUrl}/reversal/queue`,
      ResultURL: `${baseUrl}/reversal/result`,
    };
    console.log("[requestReversal] Reversal request body:", { ...requestBody, SecurityCredential: "[REDACTED]" });

    // 9. Create reversal record
    const reversalId = await ctx.runMutation(internal.payments.internal.createReversal, {
      paymentId: args.paymentId,
      userId,
      originatorConversationID,
      transactionID: payment.mpesaReceipt,
      amount: payment.amount,
      reason: args.reason,
      status: "requested",
      requestPayload: requestBody,
    });
    console.log("[requestReversal] Reversal record created:", reversalId);

    // 10. Call Reversal API
    try {
      const accessToken = await getMpesaAccessToken();
      const reversalUrl = getReversalUrl();
      console.log("[requestReversal] Calling Reversal API at:", reversalUrl);
      const response = await fetch(reversalUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();
      console.log("[requestReversal] Reversal API response:", data);

      if (data.ResponseCode !== "0") {
        console.error("[requestReversal] Reversal API failed:", data.ResponseDescription);
        await ctx.runMutation(internal.payments.internal.updateReversal, {
          id: reversalId,
          status: "failed",
          responsePayload: data,
        });
        throw new ConvexError(`Reversal failed: ${data.ResponseDescription}`);
      }

      await ctx.runMutation(internal.payments.internal.updateReversal, {
        id: reversalId,
        status: "processing",
        conversationID: data.ConversationID,
        responsePayload: data,
      });
      console.log("[requestReversal] Reversal initiated successfully.");

      return {
        success: true,
        data: {
          originatorConversationID,
          conversationID: data.ConversationID,
          status: "processing",
        },
      };
    } catch (err) {
      console.error("[requestReversal] Error calling Reversal API:", err);
      await ctx.runMutation(internal.payments.internal.updateReversal, {
        id: reversalId,
        status: "failed",
        responsePayload: { error: err.message },
      });
      if (err instanceof ConvexError) throw err;
      throw new ConvexError("Reversal request failed: " + (err.message || "unknown error"));
    }
  },
});