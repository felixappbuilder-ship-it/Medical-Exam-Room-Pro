// convex/payments/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

// Helper to generate basic auth for M-Pesa API
function getMpesaAuthHeader(consumerKey: string, consumerSecret: string): string {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  return `Basic ${auth}`;
}

export const initiateMpesaPayment = action({
  args: {
    paymentId: v.id("payments"),
    phoneNumber: v.string(),
    amount: v.number(),
    transactionId: v.string(),
    planName: v.string(),
  },
  handler: async (ctx, args) => {
    // Check test mode (R19)
    const isTestMode = process.env.IS_TEST_MODE === "true";
    if (isTestMode) {
      // Mock M-Pesa response
      console.log("TEST MODE: Mock M-Pesa STK push for payment", args.transactionId);
      // Simulate successful callback after 2 seconds (in real scenario, callback would come from Safaricom)
      // For testing, we directly update payment as completed (or you could simulate callback via scheduler)
      await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
        merchantRequestId: `mock_${args.transactionId}`,
        status: "completed",
        receipt: `MOCK_RECEIPT_${args.transactionId}`,
      });
      return { success: true, merchantRequestId: `mock_${args.transactionId}` };
    }

    // Production: Call Safaricom STK push API
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const passkey = process.env.MPESA_PASSKEY;
    const shortcode = process.env.MPESA_SHORTCODE;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    if (!consumerKey || !consumerSecret || !passkey || !shortcode || !callbackUrl) {
      throw new ConvexError("M-Pesa environment variables not configured");
    }

    // Format phone number to 254XXXXXXXXX
    let formattedPhone = args.phoneNumber.replace(/\D/g, "");
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "254" + formattedPhone.slice(1);
    }
    if (!formattedPhone.startsWith("254")) {
      formattedPhone = "254" + formattedPhone;
    }

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

    const stkPushRequest = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(args.amount),
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: callbackUrl,
      AccountReference: `MEDEXAM-${args.transactionId.slice(-8)}`,
      TransactionDesc: "Medical Exam Pro Subscription",
    };

    try {
      const authHeader = getMpesaAuthHeader(consumerKey, consumerSecret);
      const response = await fetch(
        "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(stkPushRequest),
        }
      );

      const data = await response.json();
      if (data.ResponseCode !== "0") {
        // Update payment as failed
        await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
          merchantRequestId: `failed_${args.transactionId}`,
          status: "failed",
        });
        throw new ConvexError(`M-Pesa STK push failed: ${data.ResponseDescription}`);
      }

      const merchantRequestId = data.MerchantRequestID;
      // Store merchantRequestId in payment record
      await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
        merchantRequestId,
        status: "pending", // still pending, waiting for callback
      });
      // Also update the payment document with merchantRequestId (original create didn't have it)
      // We need to patch the payment directly
      const payment = await ctx.db.get(args.paymentId);
      if (payment) {
        await ctx.db.patch(args.paymentId, { merchantRequestId });
      }

      return { success: true, merchantRequestId };
    } catch (err) {
      console.error("M-Pesa STK push error:", err);
      throw new ConvexError("Failed to initiate M-Pesa payment");
    }
  },
});

export const handleStalePayments = action({
  args: {},
  handler: async (ctx) => {
    // Get all pending payments older than 30 minutes
    const stalePayments = await ctx.runQuery(
      internal.payments.internal.getPendingPaymentsOlderThan,
      { minutes: 30 }
    );
    for (const payment of stalePayments) {
      // Only update if still pending (idempotent)
      if (payment.status === "pending") {
        await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
          merchantRequestId: payment.merchantRequestId!,
          status: "expired",
        });
      }
    }
    return { deletedCount: stalePayments.length };
  },
});