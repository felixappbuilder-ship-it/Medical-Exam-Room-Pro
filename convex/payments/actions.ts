"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";

// Environment variables (set in Convex dashboard)
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY!;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET!;
const PASSKEY = process.env.MPESA_PASSKEY!;
const SHORTCODE = process.env.MPESA_SHORTCODE!;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL!;
const BUSINESS_SHORTCODE = SHORTCODE; // Usually same as shortcode

// -----------------------------------------------------------------------------
// Helper: Get OAuth token from Safaricom
// -----------------------------------------------------------------------------
async function getAccessToken(): Promise<string> {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  const response = await fetch(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    }
  );
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }
  const data = await response.json() as { access_token: string };
  return data.access_token;
}

// -----------------------------------------------------------------------------
// Helper: Generate STK push password
// -----------------------------------------------------------------------------
function generatePassword(timestamp: string): string {
  const raw = BUSINESS_SHORTCODE + PASSKEY + timestamp;
  return Buffer.from(raw).toString("base64");
}

// -----------------------------------------------------------------------------
// Helper: Generate timestamp in format YYYYMMDDHHmmss
// -----------------------------------------------------------------------------
function getTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

// -----------------------------------------------------------------------------
// initiateMpesaPayment – called from subscription purchase (scheduled)
// -----------------------------------------------------------------------------
export const initiateMpesaPayment = action({
  args: {
    paymentId: v.id("payments"),
    userId: v.id("users"),
    amount: v.number(),
    phoneNumber: v.string(),
    description: v.string(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    try {
      // Get access token
      const accessToken = await getAccessToken();

      // Prepare STK push request
      const timestamp = getTimestamp();
      const password = generatePassword(timestamp);
      const callbackUrl = CALLBACK_URL; // Your public HTTPS endpoint

      const stkPushBody = {
        BusinessShortCode: BUSINESS_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: args.amount,
        PartyA: args.phoneNumber,
        PartyB: BUSINESS_SHORTCODE,
        PhoneNumber: args.phoneNumber,
        CallBackURL: callbackUrl,
        AccountReference: "MedExamPro",
        TransactionDesc: args.description.substring(0, 13), // Max 13 chars
      };

      const response = await fetch(
        "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(stkPushBody),
        }
      );

      const result = await response.json() as {
        MerchantRequestID?: string;
        CheckoutRequestID?: string;
        ResponseCode?: string;
        ResponseDescription?: string;
      };

      if (!response.ok || result.ResponseCode !== "0") {
        // Update payment as failed via internal mutation
        await ctx.runMutation(internal.payments.updatePaymentStatus, {
          paymentId: args.paymentId,
          status: "failed",
          details: { error: result.ResponseDescription || "STK push failed" },
        });
        throw new Error(`M‑Pesa STK push failed: ${result.ResponseDescription}`);
      }

      // Update payment with merchantRequestId
      await ctx.runMutation(internal.payments.updatePaymentStatus, {
        paymentId: args.paymentId,
        status: "pending", // still pending but now with request ID
        merchantRequestId: result.MerchantRequestID,
        checkoutRequestId: result.CheckoutRequestID,
      });

      return {
        transactionId: args.paymentId, // using paymentId as internal transactionId
        merchantRequestID: result.MerchantRequestID,
      };
    } catch (error) {
      // Log error and rethrow
      console.error("initiateMpesaPayment error:", error);
      throw new ConvexError(error instanceof Error ? error.message : "Payment initiation failed");
    }
  },
});

// Note: mpesaCallback has been moved to its own file: convex/payments/mpesaCallback.ts