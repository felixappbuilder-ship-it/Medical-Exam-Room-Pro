// convex/payments/status.ts
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

function getTransactionStatusUrl(): string {
  const isTestMode = process.env.IS_TEST_MODE === "true";
  return isTestMode
    ? "https://sandbox.safaricom.co.ke/mpesa/transactionstatus/v1/query"
    : "https://api.safaricom.co.ke/mpesa/transactionstatus/v1/query";
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
// QUERY TRANSACTION STATUS (Admin only)
// ============================================================
export const queryTransactionStatus = action({
  args: {
    token: v.string(),
    transactionID: v.optional(v.string()),
    originatorConversationID: v.optional(v.string()),
    partyA: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[queryTransactionStatus] Called with:", {
      transactionID: args.transactionID,
      originatorConversationID: args.originatorConversationID,
      partyA: args.partyA,
    });
    console.log("[queryTransactionStatus] Token present:", !!args.token);

    // 1. Verify admin role
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.warn("[queryTransactionStatus] Token verification failed:", result.message);
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
      console.log("[queryTransactionStatus] Token verified, userId:", payload.userId);
    } catch (err) {
      console.error("[queryTransactionStatus] Token verification error:", err);
      return { success: false, error: "auth_failed", message: "Authentication failed" };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user || user.role !== "admin") {
      console.warn("[queryTransactionStatus] Forbidden – user role:", user?.role);
      return { success: false, error: "forbidden", message: "Admin access required" };
    }

    // 2. Validate inputs
    if (!args.transactionID && !args.originatorConversationID) {
      console.warn("[queryTransactionStatus] Missing transactionID and originatorConversationID");
      return {
        success: false,
        error: "missing_id",
        message: "Provide either transactionID (M-PESA receipt) or originatorConversationID",
      };
    }

    // Validate partyA (shortcode)
    if (!args.partyA || !/^\d{6,9}$/.test(args.partyA)) {
      console.warn("[queryTransactionStatus] Invalid partyA (shortcode):", args.partyA);
      return {
        success: false,
        error: "invalid_partyA",
        message: "Invalid shortcode (must be 6-9 digits)",
      };
    }

    // 3. Check test mode
    const isTestMode = process.env.IS_TEST_MODE === "true";
    if (isTestMode) {
      console.log("[TEST MODE] Mock transaction status query");
      const mockOriginator = `mock_${Date.now()}`;
      await ctx.runMutation(internal.payments.internal.createStatusQuery, {
        userId,
        originatorConversationID: mockOriginator,
        transactionID: args.transactionID || "MOCK123456",
        partyA: args.partyA,
        status: "completed",
      });
      return {
        success: true,
        data: {
          originatorConversationID: mockOriginator,
          status: "completed",
          result: {
            ResultCode: 0,
            ResultDesc: "Success (mock)",
            TransactionStatus: "Completed",
          },
        },
      };
    }

    // 4. Production: fetch credentials
    const initiatorName = process.env.MPESA_B2C_INITIATOR;
    const securityCredential = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
    if (!initiatorName || !securityCredential) {
      console.error("[queryTransactionStatus] Missing B2C initiator credentials");
      throw new ConvexError(
        "Status query credentials not configured (MPESA_B2C_INITIATOR, MPESA_B2C_SECURITY_CREDENTIAL)"
      );
    }
    console.log("[queryTransactionStatus] Credentials OK");

    // 5. Prepare request
    const originatorConversationID = `STAT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const baseUrl = process.env.MPESA_CALLBACK_URL?.replace(/\/stk.*/, "") || "";
    const requestBody = {
      Initiator: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: "TransactionStatusQuery",
      TransactionID: args.transactionID,
      OriginalConversationID: args.originatorConversationID,
      PartyA: args.partyA,
      IdentifierType: "4",
      Remarks: "Status query",
      QueueTimeOutURL: `${baseUrl}/status/queue`,
      ResultURL: `${baseUrl}/status/result`,
      Occasion: "Status check",
    };
    console.log("[queryTransactionStatus] Request body:", { ...requestBody, SecurityCredential: "[REDACTED]" });

    // 6. Create DB record
    const statusId = await ctx.runMutation(internal.payments.internal.createStatusQuery, {
      userId,
      originatorConversationID,
      transactionID: args.transactionID,
      partyA: args.partyA,
      status: "pending",
    });
    console.log("[queryTransactionStatus] Status query record created:", statusId);

    // 7. Call Transaction Status API
    try {
      const accessToken = await getMpesaAccessToken();
      const statusUrl = getTransactionStatusUrl();
      console.log("[queryTransactionStatus] Calling Transaction Status API at:", statusUrl);
      const response = await fetch(statusUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();
      console.log("[queryTransactionStatus] Transaction Status API response:", data);

      if (data.ResponseCode !== "0") {
        console.error("[queryTransactionStatus] Transaction Status API failed:", data.ResponseDescription);
        await ctx.runMutation(internal.payments.internal.updateStatusQuery, {
          id: statusId,
          status: "failed",
          result: data,
        });
        throw new ConvexError(`Transaction Status query failed: ${data.ResponseDescription}`);
      }

      await ctx.runMutation(internal.payments.internal.updateStatusQuery, {
        id: statusId,
        status: "pending",
        conversationID: data.ConversationID,
      });
      console.log("[queryTransactionStatus] Status query initiated successfully.");

      return {
        success: true,
        data: {
          originatorConversationID,
          conversationID: data.ConversationID,
          status: "pending",
        },
      };
    } catch (err) {
      console.error("[queryTransactionStatus] Error calling Transaction Status API:", err);
      await ctx.runMutation(internal.payments.internal.updateStatusQuery, {
        id: statusId,
        status: "failed",
        result: { error: err.message },
      });
      if (err instanceof ConvexError) throw err;
      throw new ConvexError("Transaction Status request failed: " + (err.message || "unknown error"));
    }
  },
});