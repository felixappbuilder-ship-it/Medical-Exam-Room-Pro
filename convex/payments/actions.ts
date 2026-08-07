// convex/payments/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

// ============================================================
// HELPERS – Environment-aware endpoint selection
// ============================================================

function getOAuthTokenUrl(): string {
  const isTestMode = process.env.IS_TEST_MODE === "true";
  return isTestMode
    ? "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
    : "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
}

function getStkPushUrl(): string {
  const isTestMode = process.env.IS_TEST_MODE === "true";
  return isTestMode
    ? "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
    : "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
}

function getStkPushQueryUrl(): string {
  const isTestMode = process.env.IS_TEST_MODE === "true";
  return isTestMode
    ? "https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query"
    : "https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query";
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
// 1. INITIATE STK PUSH (in-app payment)
// ============================================================
export const initiateMpesaPayment = action({
  args: {
    paymentId: v.id("payments"),
    phoneNumber: v.string(),
    amount: v.number(),
    transactionId: v.string(),
    planName: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[initiateMpesaPayment] Called with:", {
      paymentId: args.paymentId,
      phoneNumber: args.phoneNumber,
      amount: args.amount,
      transactionId: args.transactionId,
      planName: args.planName,
    });

    const isTestMode = process.env.IS_TEST_MODE === "true";
    if (isTestMode) {
      console.log("[TEST MODE] Mock STK push for payment", args.transactionId);
      await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
        merchantRequestId: `mock_${args.transactionId}`,
        status: "completed",
        receipt: `MOCK_RECEIPT_${args.transactionId}`,
      });
      console.log("[TEST MODE] Mock payment completed");
      return { success: true, merchantRequestId: `mock_${args.transactionId}` };
    }

    // Production: call Safaricom API
    console.log("[initiateMpesaPayment] Production mode – fetching environment variables...");
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const passkey = process.env.MPESA_PASSKEY;
    const shortcode = process.env.MPESA_SHORTCODE;
    const tillNumber = process.env.MPESA_TILL_NUMBER;
    const accountRef = process.env.MPESA_ACCOUNT_REFERENCE || "VertexDigital";
    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    if (!consumerKey || !consumerSecret || !passkey || !shortcode || !callbackUrl) {
      console.error("[initiateMpesaPayment] Missing M-Pesa environment variables");
      throw new ConvexError("M-Pesa environment variables not configured");
    }
    console.log("[initiateMpesaPayment] Environment variables OK");

    // Normalize phone number to 254XXXXXXXXX
    console.log("[initiateMpesaPayment] Normalizing phone number:", args.phoneNumber);
    let formattedPhone = args.phoneNumber.replace(/\D/g, "");
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "254" + formattedPhone.slice(1);
    }
    if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }
    console.log("[initiateMpesaPayment] Normalized phone:", formattedPhone);

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

    const stkPushRequest = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline",
      Amount: Math.round(args.amount),
      PartyA: formattedPhone,
      PartyB: tillNumber || shortcode, // fallback to shortcode if till not set
      PhoneNumber: formattedPhone,
      CallBackURL: callbackUrl,
      AccountReference: accountRef,
      TransactionDesc: "Medical Exam Pro Subscription",
    };
    console.log("[initiateMpesaPayment] STK Request payload:", stkPushRequest);

    try {
      console.log("[initiateMpesaPayment] Obtaining access token...");
      const accessToken = await getMpesaAccessToken();
      console.log("[initiateMpesaPayment] Access token obtained successfully");

      console.log("[initiateMpesaPayment] Sending STK push request...");
      const stkUrl = getStkPushUrl();
      const response = await fetch(stkUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(stkPushRequest),
      });

      const rawText = await response.text();
      console.log("[initiateMpesaPayment] Raw STK response:", rawText);

      let data;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        console.error("[initiateMpesaPayment] Invalid JSON response:", rawText);
        throw new ConvexError("M-Pesa API returned malformed response");
      }
      console.log("[initiateMpesaPayment] Parsed STK response:", data);

      if (data.ResponseCode !== "0") {
        const errorDesc = data.ResponseDescription || "Unknown error";
        console.error("[initiateMpesaPayment] STK push failed:", { ResponseCode: data.ResponseCode, ResponseDescription: data.ResponseDescription });
        await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
          merchantRequestId: `failed_${args.transactionId}`,
          status: "failed",
        });
        throw new ConvexError(`M-Pesa STK push failed: ${errorDesc}`);
      }

      const merchantRequestId = data.MerchantRequestID;
      const checkoutRequestId = data.CheckoutRequestID;
      console.log("[initiateMpesaPayment] STK push successful. MerchantRequestID:", merchantRequestId, "CheckoutRequestID:", checkoutRequestId);

      console.log("[initiateMpesaPayment] Updating payment with request IDs...");
      await ctx.runMutation(internal.payments.internal.updatePaymentWithRequestIds, {
        paymentId: args.paymentId,
        merchantRequestId,
        checkoutRequestId,
        phoneNumber: formattedPhone,
      });
      console.log("[initiateMpesaPayment] Payment updated successfully.");

      return { success: true, merchantRequestId };
    } catch (err) {
      console.error("[initiateMpesaPayment] Error:", err);
      if (err instanceof ConvexError) throw err;
      throw new ConvexError("Failed to initiate M-Pesa payment: " + (err.message || "unknown error"));
    }
  },
});

// ============================================================
// 2. MANUAL CLAIM (for Buy Goods Till payments)
// ============================================================
export const claimManualPayment = action({
  args: {
    token: v.string(),
    mpesaCode: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("[claimManualPayment] Called with mpesaCode:", args.mpesaCode, "phoneNumber:", args.phoneNumber);
    console.log("[claimManualPayment] Token present:", !!args.token);

    let payload;
    try {
      console.log("[claimManualPayment] Verifying token...");
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.warn("[claimManualPayment] Token verification failed:", result.message);
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
      console.log("[claimManualPayment] Token verified, userId:", payload.userId);
    } catch (err) {
      console.error("[claimManualPayment] Token verification error:", err);
      return { success: false, error: "token_verification_failed", message: "Authentication failed" };
    }

    const userId = payload.userId;
    console.log("[claimManualPayment] Fetching user by userId:", userId);
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) {
      console.warn("[claimManualPayment] User not found for userId:", userId);
      return { success: false, error: "user_not_found", message: "User not found" };
    }
    console.log("[claimManualPayment] User found:", { id: user._id, phone: user.phone });

    let payment = null;

    // 1. Try by mpesaCode
    if (args.mpesaCode) {
      console.log("[claimManualPayment] Searching for payment by mpesaCode:", args.mpesaCode);
      payment = await ctx.runQuery(internal.payments.internal.getPendingPaymentByMpesaCode, {
        mpesaCode: args.mpesaCode,
      });
      if (payment) {
        console.log("[claimManualPayment] Found payment by mpesaCode:", payment._id);
      }
    }

    // 2. If not found, try by phoneNumber (either provided or from user profile)
    if (!payment) {
      let phoneToSearch = args.phoneNumber || user.phone;
      if (phoneToSearch) {
        let formattedPhone = phoneToSearch.replace(/\D/g, "");
        if (formattedPhone.startsWith("0")) formattedPhone = "254" + formattedPhone.slice(1);
        if (!formattedPhone.startsWith("254")) formattedPhone = "254" + formattedPhone;
        console.log("[claimManualPayment] Searching for pending payments by phone:", formattedPhone);
        const pendingList = await ctx.runQuery(internal.payments.internal.getPendingPaymentsByPhone, {
          phoneNumber: formattedPhone,
        });
        if (pendingList.length > 0) {
          payment = pendingList[0];
          console.log("[claimManualPayment] Found first pending payment by phone:", payment._id);
        } else {
          console.log("[claimManualPayment] No pending payments found for phone:", formattedPhone);
        }
      }
    }

    // 3. If still not found, check if we can use the user's phone from profile (if we haven't already)
    if (!payment && user.phone && args.phoneNumber !== user.phone) {
      let formattedPhone = user.phone.replace(/\D/g, "");
      if (formattedPhone.startsWith("0")) formattedPhone = "254" + formattedPhone.slice(1);
      if (!formattedPhone.startsWith("254")) formattedPhone = "254" + formattedPhone;
      console.log("[claimManualPayment] Searching by user's profile phone:", formattedPhone);
      const pendingList = await ctx.runQuery(internal.payments.internal.getPendingPaymentsByPhone, {
        phoneNumber: formattedPhone,
      });
      if (pendingList.length > 0) {
        payment = pendingList[0];
        console.log("[claimManualPayment] Found payment by profile phone:", payment._id);
      }
    }

    if (!payment) {
      console.warn("[claimManualPayment] No pending payment found.");
      return {
        success: false,
        error: "payment_not_found",
        message: "No pending payment found for the provided code or phone number.",
      };
    }

    console.log("[claimManualPayment] Payment found:", {
      id: payment._id,
      amount: payment.amount,
      userId: payment.userId,
      status: payment.status,
      mpesaCode: payment.mpesaCode,
      phoneNumber: payment.phoneNumber,
    });

    if (payment.status !== "pending") {
      return {
        success: false,
        error: "payment_processed",
        message: "This payment has already been processed.",
      };
    }
    if (payment.userId && payment.userId !== userId) {
      console.warn("[claimManualPayment] Payment already claimed by another user:", payment.userId);
      return {
        success: false,
        error: "payment_claimed",
        message: "This payment has already been claimed by another user.",
      };
    }

    console.log("[claimManualPayment] Claiming payment for user:", userId);
    await ctx.runMutation(internal.payments.internal.claimPayment, {
      paymentId: payment._id,
      userId,
    });
    console.log("[claimManualPayment] Payment claimed successfully.");

    if (args.mpesaCode && !payment.mpesaCode) {
      console.log("[claimManualPayment] Setting mpesaCode on payment:", args.mpesaCode);
      await ctx.runMutation(internal.payments.internal.setPaymentMpesaCode, {
        paymentId: payment._id,
        mpesaCode: args.mpesaCode,
      });
    }

    console.log("[claimManualPayment] Subscription activated for user:", userId);
    return {
      success: true,
      data: { message: "Subscription activated successfully!" },
    };
  },
});

// ============================================================
// 3. STALE PAYMENT CLEANUP (cron job)
// ============================================================
export const handleStalePayments = action({
  args: {},
  handler: async (ctx) => {
    console.log("[handleStalePayments] Started.");
    const stalePayments = await ctx.runQuery(
      internal.payments.internal.getPendingPaymentsOlderThan,
      { minutes: 30 }
    );
    console.log("[handleStalePayments] Found", stalePayments.length, "stale payments.");
    let updatedCount = 0;
    for (const payment of stalePayments) {
      if (payment.status === "pending" && payment.merchantRequestId) {
        console.log("[handleStalePayments] Expiring payment:", payment._id, "merchantRequestId:", payment.merchantRequestId);
        await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
          merchantRequestId: payment.merchantRequestId,
          status: "expired",
        });
        updatedCount++;
      }
    }
    console.log("[handleStalePayments] Expired", updatedCount, "payments.");
    return { deletedCount: updatedCount };
  },
});

// ============================================================
// 4. STK PUSH QUERY (for callback reliability)
// ============================================================
export const queryStkPushStatus = action({
  args: {
    merchantRequestId: v.string(),
    checkoutRequestId: v.string(),
  },
  handler: async (ctx, args) => {
    const isTestMode = process.env.IS_TEST_MODE === "true";
    if (isTestMode) {
      return { success: true, status: "completed" };
    }

    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    if (!shortcode || !passkey) {
      throw new ConvexError("M-Pesa credentials not configured");
    }

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
    const queryRequest = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: args.checkoutRequestId,
    };

    try {
      const accessToken = await getMpesaAccessToken();
      const queryUrl = getStkPushQueryUrl();
      const response = await fetch(queryUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(queryRequest),
      });
      const data = await response.json();
      const status = data.ResultCode === "0" ? "completed" : data.ResultCode === "1032" ? "failed" : "pending";
      return { success: true, status, raw: data };
    } catch (err) {
      console.error("[queryStkPushStatus] Error:", err);
      return { success: false, status: "unknown", message: err.message };
    }
  },
});

// ============================================================
// 5. VERIFY PENDING STK PAYMENTS (cron job – callback reliability)
// ============================================================
export const verifyPendingStkPayments = action({
  args: {},
  handler: async (ctx) => {
    console.log("[verifyPendingStkPayments] Started.");
    const toVerify = await ctx.runQuery(
      internal.payments.internal.getPendingStkPaymentsToVerify,
      { minutes: 5 }
    );

    console.log(`[verifyPendingStkPayments] Found ${toVerify.length} pending payments to verify.`);

    for (const payment of toVerify) {
      console.log(`[verifyPendingStkPayments] Verifying payment ${payment._id} (Merchant: ${payment.merchantRequestId})`);
      const result = await ctx.runAction(internal.payments.actions.queryStkPushStatus, {
        merchantRequestId: payment.merchantRequestId!,
        checkoutRequestId: payment.checkoutRequestId!,
      });

      if (!result.success) {
        console.warn(`[verifyPendingStkPayments] Status query failed for ${payment._id}: ${result.message}`);
        continue;
      }

      const status = result.status;
      if (status === "completed") {
        console.log(`[verifyPendingStkPayments] Payment ${payment._id} is completed. Updating...`);
        await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
          merchantRequestId: payment.merchantRequestId!,
          status: "completed",
          receipt: result.raw?.MpesaReceiptNumber || undefined,
        });
      } else if (status === "failed") {
        console.log(`[verifyPendingStkPayments] Payment ${payment._id} failed. Updating...`);
        await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
          merchantRequestId: payment.merchantRequestId!,
          status: "failed",
        });
      } else {
        console.log(`[verifyPendingStkPayments] Payment ${payment._id} still pending.`);
      }
    }
    return { verified: toVerify.length };
  },
});

// ============================================================
// 6. VERIFY PENDING B2C TRANSACTIONS (cron job)
// ============================================================
export const verifyPendingB2C = action({
  args: {},
  handler: async (ctx) => {
    console.log("[verifyPendingB2C] Started.");
    const stale = await ctx.runQuery(
      internal.payments.internal.getStaleProcessingB2C,
      { minutes: 10 }
    );
    console.log(`[verifyPendingB2C] Found ${stale.length} stale B2C transactions.`);

    for (const t of stale) {
      if (t.updatedAt < Date.now() - 30 * 60 * 1000) {
        await ctx.runMutation(internal.payments.internal.updateB2CTransaction, {
          id: t._id,
          status: "failed",
          resultPayload: { error: "Timed out waiting for B2C result" },
        });
        console.log(`[verifyPendingB2C] Marked B2C ${t._id} as failed due to timeout.`);
      }
    }
    return { processed: stale.length };
  },
});

// ============================================================
// 7. VERIFY PENDING BALANCE QUERIES (cron job)
// ============================================================
export const verifyPendingBalanceQueries = action({
  args: {},
  handler: async (ctx) => {
    console.log("[verifyPendingBalanceQueries] Started.");
    const stale = await ctx.runQuery(
      internal.payments.internal.getStalePendingBalanceQueries,
      { minutes: 10 }
    );
    console.log(`[verifyPendingBalanceQueries] Found ${stale.length} stale balance queries.`);

    for (const q of stale) {
      if (q.updatedAt < Date.now() - 30 * 60 * 1000) {
        await ctx.runMutation(internal.payments.internal.updateBalanceQuery, {
          id: q._id,
          status: "failed",
          result: { error: "Timed out waiting for balance result" },
        });
        console.log(`[verifyPendingBalanceQueries] Marked balance query ${q._id} as failed.`);
      }
    }
    return { processed: stale.length };
  },
});

// ============================================================
// 8. VERIFY PENDING STATUS QUERIES (cron job)
// ============================================================
export const verifyPendingStatusQueries = action({
  args: {},
  handler: async (ctx) => {
    console.log("[verifyPendingStatusQueries] Started.");
    const stale = await ctx.runQuery(
      internal.payments.internal.getStalePendingStatusQueries,
      { minutes: 10 }
    );
    console.log(`[verifyPendingStatusQueries] Found ${stale.length} stale status queries.`);

    for (const q of stale) {
      if (q.updatedAt < Date.now() - 30 * 60 * 1000) {
        await ctx.runMutation(internal.payments.internal.updateStatusQuery, {
          id: q._id,
          status: "failed",
          result: { error: "Timed out waiting for status result" },
        });
        console.log(`[verifyPendingStatusQueries] Marked status query ${q._id} as failed.`);
      }
    }
    return { processed: stale.length };
  },
});

// ============================================================
// 9. VERIFY PENDING REVERSALS (cron job)
// ============================================================
export const verifyPendingReversals = action({
  args: {},
  handler: async (ctx) => {
    console.log("[verifyPendingReversals] Started.");
    const stale = await ctx.runQuery(
      internal.payments.internal.getStaleProcessingReversals,
      { minutes: 15 }
    );
    console.log(`[verifyPendingReversals] Found ${stale.length} stale reversals.`);

    for (const r of stale) {
      if (r.updatedAt < Date.now() - 60 * 60 * 1000) {
        await ctx.runMutation(internal.payments.internal.updateReversal, {
          id: r._id,
          status: "failed",
          resultPayload: { error: "Timed out waiting for reversal result" },
        });
        console.log(`[verifyPendingReversals] Marked reversal ${r._id} as failed.`);
      }
    }
    return { processed: stale.length };
  },
});