// convex/payments/b2c.ts
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

function getB2CUrl(): string {
  const isTestMode = process.env.IS_TEST_MODE === "true";
  // Sandbox uses v3, production uses v1
  return isTestMode
    ? "https://sandbox.safaricom.co.ke/mpesa/b2c/v3/paymentrequest"
    : "https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest";
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
// 1. INITIATE B2C DISBURSEMENT (Admin only)
// ============================================================
export const initiateB2C = action({
  args: {
    token: v.string(),
    phoneNumber: v.string(),
    amount: v.number(),
    commandID: v.union(
      v.literal("SalaryPayment"),
      v.literal("BusinessPayment"),
      v.literal("PromotionPayment")
    ),
    remarks: v.string(),
    occasion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("[initiateB2C] Called with:", {
      phoneNumber: args.phoneNumber,
      amount: args.amount,
      commandID: args.commandID,
      remarks: args.remarks,
    });

    // 1. Verify admin role
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.warn("[initiateB2C] Token verification failed:", result.message);
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
      console.log("[initiateB2C] Token verified, userId:", payload.userId);
    } catch (err) {
      console.error("[initiateB2C] Token verification error:", err);
      return { success: false, error: "auth_failed", message: "Authentication failed" };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user || user.role !== "admin") {
      console.warn("[initiateB2C] Forbidden – user role:", user?.role);
      return { success: false, error: "forbidden", message: "Admin access required" };
    }

    // 2. Validate and normalize phone number
    let phone = args.phoneNumber.replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "254" + phone.slice(1);
    if (!phone.startsWith("254") || phone.length !== 12) {
      console.warn("[initiateB2C] Invalid phone number:", phone);
      return { success: false, error: "invalid_phone", message: "Invalid phone number (must be 254XXXXXXXXX)" };
    }
    console.log("[initiateB2C] Normalized phone:", phone);

    // 3. Validate amount
    if (args.amount < 10) {
      return { success: false, error: "invalid_amount", message: "Minimum B2C amount is KES 10" };
    }
    if (args.amount > 250000) {
      return { success: false, error: "invalid_amount", message: "Maximum B2C amount is KES 250,000 per transaction" };
    }

    // 4. Check test mode
    const isTestMode = process.env.IS_TEST_MODE === "true";
    if (isTestMode) {
      console.log("[TEST MODE] Mock B2C disbursement for phone:", phone, "amount:", args.amount);
      const mockOriginator = `mock_${Date.now()}`;
      await ctx.runMutation(internal.payments.internal.createB2CTransaction, {
        userId,
        originatorConversationID: mockOriginator,
        amount: args.amount,
        phoneNumber: phone,
        requestPayload: { mock: true },
        status: "completed",
      });
      return {
        success: true,
        data: { originatorConversationID: mockOriginator, status: "completed" },
      };
    }

    // 5. Production: fetch credentials and make API call
    const initiatorName = process.env.MPESA_B2C_INITIATOR;
    const securityCredential = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
    const shortcode = process.env.MPESA_SHORTCODE;
    if (!initiatorName || !securityCredential || !shortcode) {
      console.error("[initiateB2C] Missing B2C environment variables");
      throw new ConvexError("B2C environment variables not configured (MPESA_B2C_INITIATOR, MPESA_B2C_SECURITY_CREDENTIAL, MPESA_SHORTCODE)");
    }
    console.log("[initiateB2C] B2C environment variables OK");

    // 6. Prepare request
    const originatorConversationID = `B2C_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const baseUrl = process.env.MPESA_CALLBACK_URL?.replace(/\/stk.*/, "") || "";
    const requestBody = {
      OriginatorConversationID: originatorConversationID,
      InitiatorName: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: args.commandID,
      Amount: args.amount,
      PartyA: shortcode,
      PartyB: phone,
      Remarks: args.remarks,
      QueueTimeOutURL: `${baseUrl}/b2c/queue`,
      ResultURL: `${baseUrl}/b2c/result`,
      Occasion: args.occasion || "",
    };
    console.log("[initiateB2C] B2C request body:", { ...requestBody, SecurityCredential: "[REDACTED]" });

    // 7. Create DB record
    const b2cId = await ctx.runMutation(internal.payments.internal.createB2CTransaction, {
      userId,
      originatorConversationID,
      amount: args.amount,
      phoneNumber: phone,
      requestPayload: requestBody,
      status: "pending",
    });
    console.log("[initiateB2C] B2C transaction record created:", b2cId);

    // 8. Call B2C API
    try {
      const accessToken = await getMpesaAccessToken();
      const b2cUrl = getB2CUrl();
      console.log("[initiateB2C] Calling B2C API at:", b2cUrl);
      const response = await fetch(b2cUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();
      console.log("[initiateB2C] B2C API response:", data);

      if (data.ResponseCode !== "0") {
        console.error("[initiateB2C] B2C API failed:", data.ResponseDescription);
        await ctx.runMutation(internal.payments.internal.updateB2CTransaction, {
          id: b2cId,
          status: "failed",
          responsePayload: data,
        });
        throw new ConvexError(`B2C failed: ${data.ResponseDescription}`);
      }

      await ctx.runMutation(internal.payments.internal.updateB2CTransaction, {
        id: b2cId,
        status: "processing",
        conversationID: data.ConversationID,
        responsePayload: data,
      });
      console.log("[initiateB2C] B2C initiated successfully.");

      return {
        success: true,
        data: {
          originatorConversationID,
          conversationID: data.ConversationID,
          status: "processing",
        },
      };
    } catch (err) {
      console.error("[initiateB2C] Error calling B2C API:", err);
      // Update record as failed if we have an ID
      await ctx.runMutation(internal.payments.internal.updateB2CTransaction, {
        id: b2cId,
        status: "failed",
        responsePayload: { error: err.message },
      });
      if (err instanceof ConvexError) throw err;
      throw new ConvexError("B2C request failed: " + (err.message || "unknown error"));
    }
  },
});