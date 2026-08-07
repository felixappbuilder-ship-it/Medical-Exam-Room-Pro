// convex/users/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ============================================================
// 1. GET PROFILE (existing)
// ============================================================
export const getProfile = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    // 1. Verify JWT (R8)
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
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
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });

    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User account no longer exists.",
      };
    }

    // Return safe profile (exclude passwordHash and securityQuestions) (R13, R20)
    const { passwordHash, securityQuestions, ...safeUser } = user;
    return {
      success: true,
      data: { user: safeUser },
    };
  },
});

// ============================================================
// 2. GET DEVICES (for profile page)
// ============================================================
export const getDevices = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    // 1. Verify JWT (R8)
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
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
    const user = await ctx.db.get(userId);
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User not found.",
      };
    }

    // 2. Get all sessions for this user (to know which devices are active)
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    // Map sessions to device info, marking the current one
    // Current session is the one with sessionId == payload.sessionId (if present)
    const currentSessionId = payload.sessionId || null;

    // Get the user's stored devices list (from devices table or user.devices array)
    // The user.devices array contains fingerprints and lastUsed. We'll combine with sessions.
    const userDevices = user.devices || [];

    // Build response: for each device fingerprint, show info
    const deviceList = userDevices.map((dev) => {
      // Find if this device has an active session (not revoked and not expired)
      const session = sessions.find(
        (s) => s.deviceId === dev.fingerprint && !s.revoked && s.expiresAt > Date.now()
      );
      const isCurrent = currentSessionId && session && session.sessionId === currentSessionId;
      return {
        fingerprint: dev.fingerprint,
        platform: dev.platform || "Unknown",
        lastUsed: dev.lastUsed,
        isCurrent: !!isCurrent,
        sessionId: session ? session.sessionId : null,
        isActive: !!session,
      };
    });

    // Sort: current device first, then by lastUsed descending
    deviceList.sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return b.lastUsed - a.lastUsed;
    });

    return {
      success: true,
      data: {
        devices: deviceList,
        currentSessionId,
      },
    };
  },
});