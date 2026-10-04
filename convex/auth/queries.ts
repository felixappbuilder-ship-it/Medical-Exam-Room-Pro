// convex/auth/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ============================================================
// PUBLIC QUERIES
// ============================================================

// ============================================================
// 1. GET SECURITY QUESTIONS (public – used during password reset)
// ============================================================
export const getSecurityQuestions = query({
  args: { identifier: v.string() },
  handler: async (ctx, args) => {
    let user = await ctx.runQuery(internal.auth.internal.getUserByEmail, {
      email: args.identifier,
    });
    if (!user) {
      user = await ctx.runQuery(internal.auth.internal.getUserByPhone, {
        phone: args.identifier,
      });
    }
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "No account found with that email or phone.",
      };
    }

    // Never expose answer hashes – only the questions themselves
    const questions = (user.securityQuestions || []).map((sq) => sq.question);

    // Google-only accounts have no security questions
    if (questions.length === 0) {
      return {
        success: false,
        error: "no_security_questions",
        message:
          "This account has no security questions set. Please use Google Sign-In or contact support.",
      };
    }

    return {
      success: true,
      data: { questions },
    };
  },
});

// ============================================================
// 2. GET AUTH METHODS FOR CURRENT USER (authenticated)
//    Returns which providers are linked to the account.
//    Used by the settings page to decide whether to show
//    "Link Google" / "Unlink Google" / "Set Password" actions.
// ============================================================
export const getAuthMethods = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    // Verify JWT
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, {
        token: args.token,
      });
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
    const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId });
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User not found.",
      };
    }

    // Load auth identities for this user
    const identities = await ctx.runQuery(
      internal.auth.internal.getAuthIdentitiesForUser,
      { userId }
    );

    const passwordIdentity = identities.find((i) => i.provider === "password") || null;
    const googleIdentity = identities.find((i) => i.provider === "google") || null;

    // For password accounts, include when password was last used
    // For Google accounts, include the linked email (for display only)
    return {
      success: true,
      data: {
        providers: identities.map((i) => i.provider),
        hasPassword: !!passwordIdentity,
        hasGoogle: !!googleIdentity,
        googleEmail: user.googleEmail || null,
        googlePicture: user.googlePicture || null,
        googleLinkedAt: googleIdentity?.createdAt || null,
        passwordLastUsedAt: passwordIdentity?.lastUsedAt || null,
      },
    };
  },
});

// ============================================================
// 3. GET SESSIONS FOR CURRENT USER (authenticated)
//    Returns the user's active/revoked sessions.
//    Used by the "Devices" / "Active Sessions" settings panel.
// ============================================================
export const getMySessions = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, {
        token: args.token,
      });
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
    const currentSessionId = payload.sessionId || null;

    const sessions = await ctx.runQuery(
      internal.auth.internal.getSessionsForUser,
      { userId }
    );

    // Sort: current first, then most recent lastSeen
    const sanitized = sessions
      .filter((s) => !s.revoked && s.expiresAt > Date.now())
      .map((s) => ({
        sessionId: s.sessionId,
        deviceId: s.deviceId,
        platform: s.platform || "unknown",
        createdAt: s.createdAt,
        lastSeen: s.lastSeen,
        isCurrent: s.sessionId === currentSessionId,
      }))
      .sort((a, b) => {
        if (a.isCurrent) return -1;
        if (b.isCurrent) return 1;
        return b.lastSeen - a.lastSeen;
      });

    return {
      success: true,
      data: { sessions: sanitized },
    };
  },
});