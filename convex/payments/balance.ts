// convex/payments/balance.ts
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

function getAccountBalanceUrl(): string {
  const isTestMode = process.env.IS_TEST_MODE === "true";
  return isTestMode
    ? "https://sandbox.safaricom.co.ke/mpesa/accountbalance/v1/query"
    : "https://api.safaricom.co.ke/mpesa/accountbalance/v1/query";
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
// QUERY ACCOUNT BALANCE (Admin only)
// ============================================================
export const queryAccountBalance = action({
  args: {
    token: v.string(),
    shortcode: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[queryAccountBalance] Called for shortcode:", args.shortcode);
    console.log("[queryAccountBalance] Token present:", !!args.token);

    // 1. Verify admin role
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        console.warn("[queryAccountBalance] Token verification failed:", result.message);
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
      console.log("[queryAccountBalance] Token verified, userId:", payload.userId);
    } catch (err) {
      console.error("[queryAccountBalance] Token verification error:", err);
      return { success: false, error: "auth_failed", message: "Authentication failed" };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user || user.role !== "admin") {
      console.warn("[queryAccountBalance] Forbidden – user role:", user?.role);
      return { success: false, error: "forbidden", message: "Admin access required" };
    }

    // 2. Validate shortcode
    if (!args.shortcode || !/^\d{6,9}$/.test(args.shortcode)) {
      console.warn("[queryAccountBalance] Invalid shortcode:", args.shortcode);
      return { success: false, error: "invalid_shortcode", message: "Invalid shortcode (must be 6-9 digits)" };
    }

    // 3. Check test mode
    const isTestMode = process.env.IS_TEST_MODE === "true";
    if (isTestMode) {
      console.log("[TEST MODE] Mock account balance query for shortcode:", args.shortcode);
      const mockOriginator = `mock_${Date.now()}`;
      // Create a mock record
      await ctx.runMutation(internal.payments.internal.createBalanceQuery, {
        userId,
        originatorConversationID: mockOriginator,
        shortcode: args.shortcode,
        status: "completed",
      });
      return {
        success: true,
        data: {
          originatorConversationID: mockOriginator,
          status: "completed",
          balance: "Working Account|KES|700000.00|700000.00|0.00|0.00&Utility Account|KES|228037.00|228037.00|0.00|0.00&Charges Paid Account|KES|0.00|0.00|0.00|0.00",
        },
      };
    }

    // 4. Production: fetch credentials
    const initiatorName = process.env.MPESA_B2C_INITIATOR;
    const securityCredential = process.env.MPESA_B2C_SECURITY_CREDENTIAL;
    if (!initiatorName || !securityCredential) {
      console.error("[queryAccountBalance] Missing B2C initiator credentials");
      throw new ConvexError("Balance query credentials not configured (MPESA_B2C_INITIATOR, MPESA_B2C_SECURITY_CREDENTIAL)");
    }
    console.log("[queryAccountBalance] Credentials OK");

    // 5. Prepare request
    const originatorConversationID = `BAL_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const baseUrl = process.env.MPESA_CALLBACK_URL?.replace(/\/stk.*/, "") || "";
    const requestBody = {
      Initiator: initiatorName,
      SecurityCredential: securityCredential,
      CommandID: "AccountBalance",
      PartyA: args.shortcode,
      IdentifierType: "4",
      Remarks: "Balance query",
      QueueTimeOutURL: `${baseUrl}/balance/queue`,
      ResultURL: `${baseUrl}/balance/result`,
    };
    console.log("[queryAccountBalance] Request body:", { ...requestBody, SecurityCredential: "[REDACTED]" });

    // 6. Create DB record
    const balanceId = await ctx.runMutation(internal.payments.internal.createBalanceQuery, {
      userId,
      originatorConversationID,
      shortcode: args.shortcode,
      status: "pending",
    });
    console.log("[queryAccountBalance] Balance query record created:", balanceId);

    // 7. Call Account Balance API
    try {
      const accessToken = await getMpesaAccessToken();
      const balanceUrl = getAccountBalanceUrl();
      console.log("[queryAccountBalance] Calling Account Balance API at:", balanceUrl);
      const response = await fetch(balanceUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();
      console.log("[queryAccountBalance] Account Balance API response:", data);

      if (data.ResponseCode !== "0") {
        console.error("[queryAccountBalance] Account Balance API failed:", data.ResponseDescription);
        await ctx.runMutation(internal.payments.internal.updateBalanceQuery, {
          id: balanceId,
          status: "failed",
          result: data,
        });
        throw new ConvexError(`Account Balance query failed: ${data.ResponseDescription}`);
      }

      await ctx.runMutation(internal.payments.internal.updateBalanceQuery, {
        id: balanceId,
        status: "pending",
        conversationID: data.ConversationID,
      });
      console.log("[queryAccountBalance] Balance query initiated successfully.");

      return {
        success: true,
        data: {
          originatorConversationID,
          conversationID: data.ConversationID,
          status: "pending",
        },
      };
    } catch (err) {
      console.error("[queryAccountBalance] Error calling Account Balance API:", err);
      await ctx.runMutation(internal.payments.internal.updateBalanceQuery, {
        id: balanceId,
        status: "failed",
        result: { error: err.message },
      });
      if (err instanceof ConvexError) throw err;
      throw new ConvexError("Account Balance request failed: " + (err.message || "unknown error"));
    }
  },
});