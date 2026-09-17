// convex/users/mutations.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ============================================================
// 1. UPDATE PROFILE (action – direct JWT, no session check)
// ============================================================
export const updateProfile = action({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    institution: v.optional(v.string()),
    yearOfStudy: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // 1. Verify JWT using the helper (R8)
    let payload;
    try {
      payload = await ctx.runAction(internal.auth.helpers.verifyJWT, { token: args.token });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("[updateProfile] JWT verification failed:", errorMessage);
      return {
        success: false,
        error: "invalid_token",
        message: `Failed to verify authentication token: ${errorMessage}`,
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

    if (user.isLocked) {
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}.`,
      };
    }

    // 2. Prepare updates
    const updates: any = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.phone !== undefined) updates.phone = args.phone;
    if (args.email !== undefined) updates.email = args.email;
    if (args.institution !== undefined) updates.institution = args.institution;
    if (args.yearOfStudy !== undefined) updates.yearOfStudy = args.yearOfStudy;

    if (Object.keys(updates).length === 0) {
      return {
        success: false,
        error: "no_updates",
        message: "No valid fields to update.",
      };
    }

    // 3. If email is being updated, check uniqueness (R2)
    if (args.email !== undefined && args.email !== user.email) {
      const existing = await ctx.runQuery(internal.auth.internal.getUserByEmail, { email: args.email });
      if (existing && existing._id !== userId) {
        return {
          success: false,
          error: "email_taken",
          message: "This email is already in use by another account.",
        };
      }
    }

    // 4. Update user (R7: call internal mutation)
    await ctx.runMutation(internal.users.internal.updateUserById, {
      userId,
      updates,
    });

    // 5. Audit log (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "update_profile",
      targetId: userId,
      details: updates,
    });

    // 6. Return updated safe profile (R20)
    const updatedUser = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    const { passwordHash, securityQuestions, ...safeUser } = updatedUser!;
    return {
      success: true,
      data: { user: safeUser },
    };
  },
});

// ============================================================
// 2. DELETE ACCOUNT (action – full token verification)
//    Permanently deletes all user data, anonymizing payments & logs.
// ============================================================
export const deleteAccount = action({
  args: {
    token: v.string(),
    password: v.optional(v.string()), // optional re‑authentication
  },
  handler: async (ctx, args) => {
    // 1. Verify token
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

    // 2. Optional: verify password (if provided)
    if (args.password) {
      const isValid = await ctx.runAction(internal.auth.helpers.comparePassword, {
        password: args.password,
        hash: user.passwordHash,
      });
      if (!isValid) {
        return {
          success: false,
          error: "invalid_password",
          message: "Incorrect password.",
        };
      }
    }

    // 3. Audit log before deletion
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "delete_account",
      targetId: userId,
      details: { email: user.email, phone: user.phone },
    });

    // 4. Delete all user data via internal mutation (hard delete + anonymization)
    //    This also deletes sessions and the user document.
    await ctx.runMutation(internal.users.internal.deleteAllUserData, { userId });

    // 5. ✅ REMOVED: revokeAllSessions – already handled inside deleteAllUserData
    //    Calling it again would try to update a deleted user document.

    return {
      success: true,
      data: { message: "Account permanently deleted." },
    };
  },
});

// ============================================================
// 3. UPDATE PREFERENCES (action – flat args, direct JWT)
// ============================================================
export const updatePreferences = action({
  args: {
    token: v.string(),
    theme: v.optional(v.string()),
    notifications: v.optional(
      v.object({
        examReminders: v.optional(v.boolean()),
        subscriptionExpiry: v.optional(v.boolean()),
        newFeatures: v.optional(v.boolean()),
      })
    ),
    dataUsage: v.optional(
      v.object({
        syncOnMobile: v.optional(v.boolean()),
        downloadImages: v.optional(v.string()),
        cacheSize: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    // 1. Verify JWT directly (no session check)
    let payload;
    try {
      payload = await ctx.runAction(internal.auth.helpers.verifyJWT, { token: args.token });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("[updatePreferences] JWT verification failed:", errorMessage);
      return {
        success: false,
        error: "invalid_token",
        message: `Failed to verify authentication token: ${errorMessage}`,
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

    // 2. Build preferences object from flat args
    const preferences: any = {};
    if (args.theme !== undefined) preferences.theme = args.theme;
    if (args.notifications !== undefined) preferences.notifications = args.notifications;
    if (args.dataUsage !== undefined) preferences.dataUsage = args.dataUsage;

    // 3. Update preferences (R7: call internal mutation)
    await ctx.runMutation(internal.users.internal.updateUserPreferences, {
      userId,
      preferences,
    });

    // 4. Audit log (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "update_preferences",
      targetId: userId,
      details: preferences,
    });

    // 5. Return success (R20)
    return {
      success: true,
      data: { message: "Preferences updated successfully." },
    };
  },
});

// ============================================================
// 4. LOGOUT DEVICE (action – full token verification)
// ============================================================
export const logoutDevice = action({
  args: {
    token: v.string(),
    fingerprint: v.string(),
  },
  handler: async (ctx, args) => {
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

    const currentSession = await ctx.runQuery(internal.auth.internal.getActiveSession, { userId });
    if (currentSession && currentSession.deviceId === args.fingerprint) {
      return {
        success: false,
        error: "cannot_logout_current",
        message: "Cannot logout the current device.",
      };
    }

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.fingerprint))
      .collect();
    for (const session of sessions) {
      await ctx.runMutation(internal.auth.internal.revokeSession, { sessionId: session.sessionId });
    }

    await ctx.runMutation(internal.auth.internal.removeDeviceByFingerprint, {
      userId,
      fingerprint: args.fingerprint,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "logout_device",
      targetId: userId,
      details: { fingerprint: args.fingerprint },
    });

    return {
      success: true,
      data: { message: "Device logged out successfully." },
    };
  },
});

// ============================================================
// 5. LOGOUT ALL OTHER DEVICES (action – full token verification)
// ============================================================
export const logoutAllDevices = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
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

    const currentSessionId = payload.sessionId || null;
    const sessions = await ctx.runQuery(internal.auth.internal.getSessionsForUser, { userId });
    for (const session of sessions) {
      if (session.sessionId !== currentSessionId) {
        await ctx.runMutation(internal.auth.internal.revokeSession, { sessionId: session.sessionId });
      }
    }

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "logout_all_other_devices",
      targetId: userId,
      details: { count: sessions.length - (currentSessionId ? 1 : 0) },
    });

    return {
      success: true,
      data: { message: "All other devices logged out." },
    };
  },
});

// ============================================================
// 6. UPGRADE TO AGENT (action – direct JWT, no session check)
// ============================================================
export const upgradeToAgent = action({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Verify JWT directly (no session check)
    let payload;
    try {
      payload = await ctx.runAction(internal.auth.helpers.verifyJWT, { token: args.token });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("[upgradeToAgent] JWT verification failed:", errorMessage);
      return {
        success: false,
        error: "invalid_token",
        message: `Failed to verify authentication token: ${errorMessage}`,
      };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) {
      return { success: false, error: "user_not_found", message: "User not found." };
    }

    if (user.isAgent) {
      return { success: false, error: "already_agent", message: "You are already an agent." };
    }

    // Upgrade to agent
    await ctx.runMutation(internal.auth.internal.updateUser, {
      userId,
      updates: { isAgent: true, agentVerified: false },
    });

    // Audit log (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "upgrade_to_agent",
      targetId: userId,
      details: {},
    });

    return { success: true, data: { message: "You are now an agent! Your account will be verified by admin soon." } };
  },
});