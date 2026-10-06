// convex/auth/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import * as notificationTriggers from "../notifications/triggers";

// ============================================================
// DEVICE NORMALIZER
// ------------------------------------------------------------
// Old app-store clients send: { deviceFingerprint }
// New clients send:           { deviceId, deviceInfo }
// Both may also send their respective `deviceInfo`.
// This helper makes the two shapes equivalent everywhere below.
// ============================================================
function normalizeDevice(args: {
  deviceId?: string | null;
  deviceFingerprint?: string | null;
  deviceInfo?: any;
}): { deviceId: string; deviceFingerprint: string; deviceInfo: any } {
  const id =
    (typeof args.deviceId === "string" && args.deviceId.trim()) ||
    (typeof args.deviceFingerprint === "string" && args.deviceFingerprint.trim()) ||
    "";

  if (!id) {
    throw new Error("DEVICE_ID_REQUIRED");
  }

  let info: any = {};
  if (args.deviceInfo && typeof args.deviceInfo === "object") {
    info = { ...args.deviceInfo };
  } else if (typeof args.deviceInfo === "string") {
    info = { platform: args.deviceInfo };
  }
  if (!info.platform) info.platform = "unknown";

  return {
    deviceId: id,
    deviceFingerprint: id,   // same value — for legacy columns / indexes
    deviceInfo: info,
  };
}

// ============================================================
// REGISTER
// ============================================================
export const register = action({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    password: v.string(),
    securityQuestions: v.array(
      v.object({
        question: v.string(),
        answer: v.string(),
      })
    ),
    deviceId: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
    deviceInfo: v.optional(v.any()),
    referralCode: v.optional(v.string()),
    isAgent: v.optional(v.boolean()),
    agentVerified: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let device;
    try {
      device = normalizeDevice({
        deviceId: args.deviceId,
        deviceFingerprint: args.deviceFingerprint,
        deviceInfo: args.deviceInfo,
      });
    } catch {
      return {
        success: false,
        error: "device_id_required",
        message: "A device identifier is required.",
      };
    }
    const { deviceId, deviceFingerprint, deviceInfo } = device;

    const now = Date.now();
    const resetAt = now + 60 * 1000;
    const rateKey = `register_${deviceId}`;
    const rateRecord = await ctx.runQuery(internal.auth.internal.getRateLimit, {
      key: rateKey,
      endpoint: "register",
    });
    if (rateRecord && rateRecord.count >= 5 && rateRecord.resetAt > now) {
      return {
        success: false,
        error: "rate_limit_exceeded",
        message: "Too many registration attempts. Please try again later.",
      };
    }
    await ctx.runMutation(internal.auth.internal.incrementRateLimit, {
      key: rateKey,
      endpoint: "register",
      resetAt,
    });

    const existingByEmail = await ctx.runQuery(internal.auth.internal.getUserByEmail, {
      email: args.email,
    });
    if (existingByEmail) {
      return {
        success: false,
        error: "email_exists",
        message: "An account with this email already exists. Please login.",
      };
    }
    const existingByPhone = await ctx.runQuery(internal.auth.internal.getUserByPhone, {
      phone: args.phone,
    });
    if (existingByPhone) {
      return {
        success: false,
        error: "phone_exists",
        message: "An account with this phone number already exists.",
      };
    }

    const passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, {
      password: args.password,
    });
    const hashedQuestions = await Promise.all(
      args.securityQuestions.map(async (sq) => ({
        question: sq.question,
        answerHash: await ctx.runAction(internal.auth.helpers.hashSecurityAnswer, {
          answer: sq.answer,
        }),
      }))
    );

    const baseName = args.name.replace(/\s+/g, "");
    const username = await ctx.runMutation(internal.challenges.internal.generateUniqueUsername, {
      baseName,
    });
    const displayName = args.name;

    const referralCode = await ctx.runMutation(internal.users.internal.generateUniqueReferralCode, {});

    let referredBy: string | undefined = undefined;
    if (args.referralCode) {
      const referrer = await ctx.runQuery(internal.users.internal.getUserByReferralCode, {
        referralCode: args.referralCode,
      });
      if (referrer) referredBy = referrer._id;
    }

    const isAgent = args.isAgent || false;
    const agentVerified = args.agentVerified || false;

    const userId = await ctx.runMutation(internal.auth.internal.insertUser, {
      name: args.name,
      email: args.email,
      phone: args.phone,
      passwordHash,
      securityQuestions: hashedQuestions,
      username,
      displayName,
      referralCode,
      referredBy,
      isAgent,
      agentVerified,
      referralBalance: 0,
      totalEarned: 0,
      pendingBalance: 0,
    });

    // Password identity (multi-provider model)
    await ctx.runMutation(internal.auth.internal.createPasswordIdentity, { userId });

    // Register device (dual-write into arrays + users.devices mirror)
    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId,
      fingerprint: deviceFingerprint,
      deviceId,
      lastUsed: now,
      platform: deviceInfo?.platform,
      deviceInfo,
    });

    // Also persist the full info blob
    await ctx.runMutation(internal.devices.internal.upsertDeviceInfo, {
      deviceId,
      userId,
      info: deviceInfo,
      platform: deviceInfo?.platform,
      userAgent: deviceInfo?.userAgent,
    });

    // Create initial session
    const sessionId = await ctx.runMutation(internal.auth.internal.createSession, {
      userId,
      deviceId,
      deviceFingerprint,
      platform: deviceInfo?.platform || "web",
      expiresAt: now + 365 * 24 * 60 * 60 * 1000,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "user_register",
      targetId: userId,
      details: {
        email: args.email,
        phone: args.phone,
        deviceInfo,
        deviceId,
        referralCode: args.referralCode,
        referredBy: referredBy ?? null,
        isAgent: args.isAgent,
        agentVerified: args.agentVerified,
      },
    });

    await notificationTriggers.notifyAccountCreated(ctx, userId, args.name, args.email);

    const token = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: { userId, email: args.email, role: "user", sessionId, deviceId },
      expiresIn: "30d",
    });

    return {
      success: true,
      data: {
        token,
        userId,
        name: args.name,
        email: args.email,
        username,
        displayName,
        referralCode,
        isAgent,
        agentVerified,
        sessionId,
        deviceId,
      },
    };
  },
});

// ============================================================
// LOGIN – blocking device-limit enforcement
// ------------------------------------------------------------
// BEFORE building the device list:
//   1. purgeRevokedSessions(userId)  — deletes every dead row
//   2. pruneUserDevicesArray(userId) — trims users.devices[]
// This guarantees the list contains ONLY live devices.
// ============================================================
export const login = action({
  args: {
    identifier: v.string(),
    password: v.string(),
    deviceId: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
    deviceInfo: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    let device;
    try {
      device = normalizeDevice({
        deviceId: args.deviceId,
        deviceFingerprint: args.deviceFingerprint,
        deviceInfo: args.deviceInfo,
      });
    } catch {
      return {
        success: false,
        error: "device_id_required",
        message: "A device identifier is required.",
      };
    }
    const { deviceId, deviceFingerprint, deviceInfo } = device;

    const now = Date.now();
    const rateKey = `login_${args.identifier}`;
    const rateRecord = await ctx.runQuery(internal.auth.internal.getRateLimit, {
      key: rateKey,
      endpoint: "login",
    });
    if (rateRecord && rateRecord.count >= 5 && rateRecord.resetAt > now) {
      await ctx.runMutation(internal.auth.internal.logSecurityEvent, {
        userId: undefined,
        eventType: "rate_limit_exceeded",
        metadata: { identifier: args.identifier, endpoint: "login" },
      });
      return {
        success: false,
        error: "rate_limit_exceeded",
        message: "Too many login attempts. Please try again later.",
      };
    }

    let user = await ctx.runQuery(internal.auth.internal.getUserByEmail, { email: args.identifier });
    if (!user) {
      user = await ctx.runQuery(internal.auth.internal.getUserByPhone, { phone: args.identifier });
    }
    if (!user) {
      await ctx.runMutation(internal.auth.internal.incrementRateLimit, {
        key: rateKey,
        endpoint: "login",
        resetAt: now + 60 * 1000,
      });
      return {
        success: false,
        error: "invalid_credentials",
        message: "Invalid email/phone or password.",
      };
    }

    if (user.isLocked) {
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}. Contact support.`,
      };
    }

    const isValid = await ctx.runAction(internal.auth.helpers.comparePassword, {
      password: args.password,
      hash: user.passwordHash,
    });
    if (!isValid) {
      await ctx.runMutation(internal.auth.internal.incrementRateLimit, {
        key: rateKey,
        endpoint: "login",
        resetAt: now + 60 * 1000,
      });
      await ctx.runMutation(internal.auth.internal.logSecurityEvent, {
        userId: user._id,
        eventType: "failed_login",
        metadata: { identifier: args.identifier },
      });
      return {
        success: false,
        error: "invalid_credentials",
        message: "Invalid email/phone or password.",
      };
    }

    // Touch password identity
    const pwIdentity = await ctx.runQuery(
      internal.auth.internal.getUserAuthIdentityByProvider,
      { userId: user._id, provider: "password" }
    );
    if (pwIdentity) {
      await ctx.runMutation(internal.auth.internal.touchAuthIdentity, {
        identityId: pwIdentity._id,
      });
    }

    // ============================================================
    // CLEANUP DEAD SESSIONS BEFORE LISTING DEVICES
    // ------------------------------------------------------------
    // This is what prevents the "500 devices" symptom. Every revoked
    // or expired session is physically deleted, and users.devices[]
    // is trimmed to match.
    // ============================================================
    await ctx.runMutation(internal.auth.internal.purgeRevokedSessions, {
      userId: user._id,
    });
    await ctx.runMutation(internal.auth.internal.pruneUserDevicesArray, {
      userId: user._id,
    });

    // ============================================================
    // DEVICE LIMIT CHECK — now sees ONLY active devices
    // ============================================================
    const devicesList = await ctx.runQuery(internal.auth.internal.getUserDevicesForUI, {
      userId: user._id,
      currentDeviceId: deviceId,
    });

    const activeSub = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId: user._id }
    );
    const maxDevices = activeSub?.maxDevices ?? 1;

    const thisDeviceAlreadyActive = devicesList.some((d) => d.deviceId === deviceId);
    const atLimit = devicesList.length >= maxDevices;
    const blockedByLimit = !thisDeviceAlreadyActive && atLimit;

    if (blockedByLimit) {
      const switchToken = await ctx.runAction(internal.auth.helpers.signJWT, {
        payload: {
          purpose: "device_switch",
          userId: user._id,
          email: user.email,
          role: user.role || "user",
          newDeviceId: deviceId,
          newDeviceFingerprint: deviceFingerprint,
          newDeviceInfo: deviceInfo,
        },
        expiresIn: "10m",
      });

      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: user._id,
        action: "login_blocked_device_limit",
        targetId: user._id,
        details: {
          deviceId,
          activeDevices: devicesList.length,
          maxDevices,
        },
      });

      return {
        success: false,
        status: "DEVICE_LIMIT_REACHED",
        error: "device_limit_reached",
        message: `You're already signed in on ${maxDevices} device${maxDevices === 1 ? "" : "s"}. Remove one to continue on this device.`,
        data: {
          devices: devicesList,
          maxDevices,
          devicesUsed: devicesList.length,
          switchToken,
          newDevice: {
            deviceId,
            platform: deviceInfo?.platform || "unknown",
          },
          via: "password",
        },
      };
    }

    // ============================================================
    // PROCEED: create session
    // ============================================================
    await ctx.runMutation(internal.auth.internal.updateUser, {
      userId: user._id,
      updates: { lastLogin: now, lastSeen: now },
    });

    const sessionId = await ctx.runMutation(internal.auth.internal.createSession, {
      userId: user._id,
      deviceId,
      deviceFingerprint,
      platform: deviceInfo?.platform || "web",
      expiresAt: now + 365 * 24 * 60 * 60 * 1000,
    });

    const deviceExists = (user.devices || []).some(
      (d) => d.deviceId === deviceId || d.fingerprint === deviceFingerprint
    );

    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId: user._id,
      fingerprint: deviceFingerprint,
      deviceId,
      lastUsed: now,
      platform: deviceInfo?.platform,
      deviceInfo,
    });

    await ctx.runMutation(internal.devices.internal.upsertDeviceInfo, {
      deviceId,
      userId: user._id,
      info: deviceInfo,
      platform: deviceInfo?.platform,
      userAgent: deviceInfo?.userAgent,
    });

    if (!deviceExists) {
      await ctx.runMutation(internal.auth.internal.logSecurityEvent, {
        userId: user._id,
        eventType: "device_change",
        metadata: { fingerprint: deviceFingerprint, deviceId, timestamp: now },
      });
      await notificationTriggers.notifyNewDevice(
        ctx,
        user._id,
        deviceInfo?.platform || "unknown",
        deviceId
      );
    }

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "user_login",
      targetId: user._id,
      details: {
        deviceFingerprint,
        deviceId,
        sessionId,
        isNewDevice: !deviceExists,
        deviceCount: devicesList.length,
        maxDevices,
      },
    });

    const userRole = user.role || "user";
    const token = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: { userId: user._id, email: user.email, role: userRole, sessionId, deviceId },
      expiresIn: "30d",
    });

    return {
      success: true,
      status: "SUCCESS",
      data: {
        token,
        userId: user._id,
        name: user.name,
        email: user.email,
        role: userRole,
        username: user.username,
        displayName: user.displayName,
        sessionId,
        deviceId,
        isNewDevice: !deviceExists,
      },
    };
  },
});

// ============================================================
// REMOVE DEVICE AND CONTINUE
// ------------------------------------------------------------
// Internally this now DELETES the removed device's session row
// (rather than marking it revoked). Everything else stays the same.
// ============================================================
export const removeDeviceAndContinue = action({
  args: {
    switchToken: v.string(),
    deviceToRemoveId: v.string(),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      payload = await ctx.runAction(internal.auth.helpers.verifyJWT, {
        token: args.switchToken,
      });
    } catch (err) {
      return {
        success: false,
        status: "INVALID_TOKEN",
        error: "invalid_switch_token",
        message: "Session expired. Please log in again.",
      };
    }

    if (payload.purpose !== "device_switch") {
      return {
        success: false,
        status: "INVALID_TOKEN",
        error: "invalid_token_purpose",
        message: "Invalid token.",
      };
    }

    const {
      userId,
      email,
      role,
      newDeviceId,
      newDeviceFingerprint,
      newDeviceInfo,
    } = payload;

    if (args.deviceToRemoveId === newDeviceId) {
      return {
        success: false,
        error: "cannot_remove_current",
        message: "You cannot remove the device you are currently signing in on.",
      };
    }

    const now = Date.now();

    // This mutation now deletes the session row and all mirrored entries.
    await ctx.runMutation(internal.auth.internal.removeDeviceByFingerprint, {
      userId,
      deviceId: args.deviceToRemoveId,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "user_login_removed_device",
      targetId: args.deviceToRemoveId,
      details: { newDeviceId },
    });

    const sessionId = await ctx.runMutation(internal.auth.internal.createSession, {
      userId,
      deviceId: newDeviceId,
      deviceFingerprint: newDeviceFingerprint || newDeviceId,
      platform: newDeviceInfo?.platform || "web",
      expiresAt: now + 365 * 24 * 60 * 60 * 1000,
    });

    await ctx.runMutation(internal.auth.internal.updateUser, {
      userId,
      updates: { lastLogin: now, lastSeen: now },
    });

    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId,
      fingerprint: newDeviceFingerprint || newDeviceId,
      deviceId: newDeviceId,
      lastUsed: now,
      platform: newDeviceInfo?.platform,
      deviceInfo: newDeviceInfo,
    });

    await ctx.runMutation(internal.devices.internal.upsertDeviceInfo, {
      deviceId: newDeviceId,
      userId,
      info: newDeviceInfo || {},
      platform: newDeviceInfo?.platform,
      userAgent: newDeviceInfo?.userAgent,
    });

    await notificationTriggers.notifyNewDevice(
      ctx,
      userId,
      newDeviceInfo?.platform || "unknown",
      newDeviceId
    );

    const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId });
    if (!user) {
      return { success: false, error: "user_not_found", message: "User no longer exists." };
    }

    const userRole = role || user.role || "user";
    const token = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: { userId, email: email || user.email, role: userRole, sessionId, deviceId: newDeviceId },
      expiresIn: "30d",
    });

    return {
      success: true,
      status: "SUCCESS",
      data: {
        token,
        userId,
        name: user.name,
        email: user.email,
        role: userRole,
        username: user.username,
        displayName: user.displayName,
        sessionId,
        deviceId: newDeviceId,
        isNewDevice: true,
      },
    };
  },
});

// ============================================================
// LIST ACTIVE DEVICES
// ------------------------------------------------------------
// Purges dead sessions before returning the list so the UI never
// sees ghost devices.
// ============================================================
export const listActiveDevices = action({
  args: {
    token: v.string(),
    currentDeviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      return { success: false, error: "token_verification_failed", message: "Authentication failed." };
    }

    const userId = payload.userId;

    // Purge dead sessions before listing
    await ctx.runMutation(internal.auth.internal.purgeRevokedSessions, { userId });
    await ctx.runMutation(internal.auth.internal.pruneUserDevicesArray, { userId });

    const activeSub = await ctx.runQuery(
      internal.subscriptions.internal.getActiveSubscriptionByUserId,
      { userId }
    );
    const maxDevices = activeSub?.maxDevices ?? 1;

    const devices = await ctx.runQuery(internal.auth.internal.getUserDevicesForUI, {
      userId,
      currentDeviceId: args.currentDeviceId,
    });

    return {
      success: true,
      data: {
        devices,
        maxDevices,
        devicesUsed: devices.length,
        overLimit: devices.length > maxDevices,
      },
    };
  },
});

// ============================================================
// REMOVE OTHER DEVICE
// ------------------------------------------------------------
// This now physically deletes the session row internally.
// ============================================================
export const removeOtherDevice = action({
  args: {
    token: v.string(),
    deviceId: v.string(),
    currentDeviceId: v.string(),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      return { success: false, error: "token_verification_failed", message: "Auth failed." };
    }

    const userId = payload.userId;

    if (args.deviceId === args.currentDeviceId) {
      return {
        success: false,
        error: "cannot_remove_current",
        message: "You cannot remove the device you are currently using. Logout instead.",
      };
    }

    await ctx.runMutation(internal.auth.internal.removeDeviceByFingerprint, {
      userId,
      deviceId: args.deviceId,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "user_remove_device",
      targetId: args.deviceId,
      details: {},
    });

    return { success: true, data: { message: "Device removed." } };
  },
});

// ============================================================
// REMOVE ALL OTHER DEVICES
// ------------------------------------------------------------
// revokeAllOtherSessions now DELETES rows. Response shape unchanged.
// ============================================================
export const removeOtherDevices = action({
  args: {
    token: v.string(),
    currentSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      return { success: false, error: "token_verification_failed", message: "Auth failed." };
    }

    const userId = payload.userId;

    const result = await ctx.runMutation(internal.auth.internal.revokeAllOtherSessions, {
      userId,
      keepSessionId: args.currentSessionId,
    });

    // Trim users.devices[] to the remaining active set
    await ctx.runMutation(internal.auth.internal.pruneUserDevicesArray, { userId });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "user_logout_other_devices",
      targetId: userId,
      details: { revoked: result.revokedCount },
    });

    return {
      success: true,
      data: {
        message: `Logged out from ${result.revokedCount} other device${result.revokedCount === 1 ? "" : "s"}.`,
        revokedCount: result.revokedCount,
      },
    };
  },
});

// ============================================================
// VERIFY TOKEN
// ------------------------------------------------------------
// Since revoked sessions are now DELETED, "not found" means the
// session is no longer valid.
// ============================================================
export const verifyToken = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const payload = await ctx.runAction(internal.auth.helpers.verifyJWT, { token: args.token });
      if (payload.sessionId) {
        const session = await ctx.runQuery(internal.auth.internal.getSessionBySessionId, {
          sessionId: payload.sessionId,
        });
        if (!session || session.revoked) {
          return { success: false, error: "session_expired", message: "Session revoked or expired." };
        }
        await ctx.runMutation(internal.auth.internal.updateSessionLastSeen, {
          sessionId: payload.sessionId,
          lastSeen: Date.now(),
        });
      }
      return { success: true, data: payload };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Token is invalid or expired.";
      console.error("[verifyToken] Verification failed:", errorMessage);
      return { success: false, error: "invalid_token", message: errorMessage };
    }
  },
});

// ============================================================
// REFRESH SESSION
// ============================================================
export const refreshSession = action({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.runQuery(
      internal.auth.internal.getSessionBySessionId,
      { sessionId: args.sessionId }
    );
    if (!session) {
      return { success: false, error: "session_not_found", message: "Session no longer exists." };
    }
    if (session.revoked) {
      return { success: false, error: "session_revoked", message: "Session has been revoked." };
    }
    if (session.expiresAt <= Date.now()) {
      return { success: false, error: "session_expired", message: "Session has expired." };
    }

    const user = await ctx.runQuery(internal.auth.internal.getUserById, {
      userId: session.userId,
    });
    if (!user) {
      return { success: false, error: "user_not_found", message: "User no longer exists." };
    }
    if (user.isLocked) {
      return { success: false, error: "account_locked", message: "Account is locked." };
    }

    const userRole = user.role || "user";
    const token = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: {
        userId: user._id,
        email: user.email,
        role: userRole,
        sessionId: session.sessionId,
        deviceId: session.deviceId,
      },
      expiresIn: "30d",
    });

    await ctx.runMutation(internal.auth.internal.updateSessionLastSeen, {
      sessionId: session.sessionId,
      lastSeen: Date.now(),
    });

    return {
      success: true,
      data: { token, userId: user._id, sessionId: session.sessionId, deviceId: session.deviceId },
    };
  },
});

// ============================================================
// CHANGE PASSWORD
// ============================================================
export const changePassword = action({
  args: {
    token: v.string(),
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch (err) {
      return { success: false, error: "token_verification_failed", message: "Invalid token." };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId });
    if (!user) {
      return { success: false, error: "user_not_found", message: "User not found." };
    }

    const isValid = await ctx.runAction(internal.auth.helpers.comparePassword, {
      password: args.currentPassword,
      hash: user.passwordHash,
    });
    if (!isValid) {
      await ctx.runMutation(internal.auth.internal.logSecurityEvent, {
        userId: user._id,
        eventType: "failed_password_change",
        metadata: {},
      });
      return { success: false, error: "invalid_password", message: "Current password is incorrect." };
    }

    const newHash = await ctx.runAction(internal.auth.helpers.hashPassword, {
      password: args.newPassword,
    });

    await ctx.runMutation(internal.auth.internal.updateUser, {
      userId,
      updates: { passwordHash: newHash },
    });

    await ctx.runMutation(internal.auth.internal.createPasswordIdentity, { userId });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "change_password",
      targetId: userId,
      details: {},
    });

    // Deletes every session (revokeAllSessions now deletes rows)
    await ctx.runMutation(internal.auth.internal.revokeAllSessions, { userId });

    await notificationTriggers.notifyPasswordChanged(ctx, userId);

    return {
      success: true,
      data: { message: "Password changed successfully. You have been logged out from other devices." },
    };
  },
});

// ============================================================
// PASSWORD RESET FLOW
// ============================================================
export const resetPasswordRequest = action({
  args: { identifier: v.string(), securityAnswers: v.array(v.string()) },
  handler: async (ctx, args) => {
    let user = await ctx.runQuery(internal.auth.internal.getUserByEmail, { email: args.identifier });
    if (!user) {
      user = await ctx.runQuery(internal.auth.internal.getUserByPhone, { phone: args.identifier });
    }
    if (!user) {
      return { success: false, error: "user_not_found", message: "No account found with that email or phone." };
    }

    const storedQuestions = user.securityQuestions || [];
    if (storedQuestions.length !== args.securityAnswers.length) {
      return { success: false, error: "invalid_answers", message: "Security answer verification failed." };
    }
    for (let i = 0; i < storedQuestions.length; i++) {
      const isValid = await ctx.runAction(internal.auth.helpers.compareSecurityAnswer, {
        answer: args.securityAnswers[i],
        hash: storedQuestions[i].answerHash,
      });
      if (!isValid) {
        await ctx.runMutation(internal.auth.internal.logSecurityEvent, {
          userId: user._id,
          eventType: "failed_password_reset",
          metadata: { identifier: args.identifier },
        });
        return { success: false, error: "invalid_answers", message: "Security answer verification failed." };
      }
    }

    await notificationTriggers.notifyPasswordResetRequested(ctx, user._id);

    const resetToken = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: { userId: user._id, purpose: "password_reset" },
      expiresIn: "15m",
    });

    return { success: true, data: { resetToken } };
  },
});

export const resetPasswordConfirm = action({
  args: { resetToken: v.string(), newPassword: v.string() },
  handler: async (ctx, args) => {
    let payload;
    try {
      payload = await ctx.runAction(internal.auth.helpers.verifyJWT, { token: args.resetToken });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Reset token is invalid or expired.";
      console.error("[resetPasswordConfirm] Token verification failed:", errorMessage);
      return { success: false, error: "invalid_token", message: errorMessage };
    }
    if (payload.purpose !== "password_reset") {
      return { success: false, error: "invalid_token", message: "Invalid token purpose." };
    }

    const userId = payload.userId;
    const newHash = await ctx.runAction(internal.auth.helpers.hashPassword, {
      password: args.newPassword,
    });
    await ctx.runMutation(internal.auth.internal.updateUser, {
      userId,
      updates: { passwordHash: newHash },
    });

    await ctx.runMutation(internal.auth.internal.createPasswordIdentity, { userId });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "password_reset",
      targetId: userId,
      details: {},
    });

    await notificationTriggers.notifyPasswordResetCompleted(ctx, userId);

    return { success: true, data: { message: "Password has been reset successfully." } };
  },
});

export const verifySecurityAnswers = action({
  args: { identifier: v.string(), answers: v.array(v.string()) },
  handler: async (ctx, args) => {
    const result = await resetPasswordRequest(ctx, {
      identifier: args.identifier,
      securityAnswers: args.answers,
    });
    if (!result.success) return result;
    return { success: true, data: { resetToken: result.data.resetToken } };
  },
});

export const resetPassword = action({
  args: {
    identifier: v.string(),
    newPassword: v.string(),
    resetToken: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await resetPasswordConfirm(ctx, {
      resetToken: args.resetToken,
      newPassword: args.newPassword,
    });
    return result;
  },
});

// ============================================================
// GOOGLE SIGN-IN
// ------------------------------------------------------------
// Same purge-before-listing pattern as password login (CASE A).
// ============================================================
export const googleSignIn = action({
  args: {
    idToken: v.string(),
    deviceId: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
    deviceInfo: v.optional(v.any()),
    referralCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      return {
        success: false,
        status: "SERVER_ERROR",
        error: "google_not_configured",
        message: "Google sign-in is not configured on the server.",
      };
    }

    let device;
    try {
      device = normalizeDevice({
        deviceId: args.deviceId,
        deviceFingerprint: args.deviceFingerprint,
        deviceInfo: args.deviceInfo,
      });
    } catch {
      return {
        success: false,
        status: "SERVER_ERROR",
        error: "device_id_required",
        message: "A device identifier is required.",
      };
    }
    const { deviceId, deviceFingerprint, deviceInfo } = device;

    const now = Date.now();
    const resetAt = now + 60 * 1000;
    const rateKey = `google_signin_${deviceId}`;
    const rateRecord = await ctx.runQuery(internal.auth.internal.getRateLimit, {
      key: rateKey,
      endpoint: "google_signin",
    });
    if (rateRecord && rateRecord.count >= 10 && rateRecord.resetAt > now) {
      return {
        success: false,
        status: "RATE_LIMITED",
        error: "rate_limit_exceeded",
        message: "Too many Google sign-in attempts. Please try again later.",
      };
    }
    await ctx.runMutation(internal.auth.internal.incrementRateLimit, {
      key: rateKey,
      endpoint: "google_signin",
      resetAt,
    });

    let googlePayload;
    try {
      googlePayload = await ctx.runAction(
        internal.auth.googleHelpers.verifyGoogleIdToken,
        { idToken: args.idToken, clientId: googleClientId }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      console.error("[googleSignIn] Token verification error:", msg);
      await ctx.runMutation(internal.auth.internal.logSecurityEvent, {
        userId: undefined,
        eventType: "invalid_google_token",
        metadata: { reason: msg },
      });
      return {
        success: false,
        status: "INVALID_GOOGLE_TOKEN",
        error: "invalid_google_token",
        message: "Google authentication failed. Please try again.",
      };
    }

    const {
      sub: googleSubject,
      email: googleEmail,
      emailVerified,
      name,
      picture,
    } = googlePayload;

    if (!emailVerified) {
      return {
        success: false,
        status: "INVALID_GOOGLE_TOKEN",
        error: "email_not_verified",
        message: "Your Google email is not verified. Please verify it with Google first.",
      };
    }

    // CASE A — existing Google identity → LOGIN (with device gate)
    const existingIdentity = await ctx.runQuery(
      internal.auth.internal.getAuthIdentity,
      { provider: "google", providerSubject: googleSubject }
    );

    if (existingIdentity) {
      const user = await ctx.runQuery(internal.auth.internal.getUserById, {
        userId: existingIdentity.userId,
      });
      if (!user) {
        await ctx.runMutation(internal.auth.internal.logSecurityEvent, {
          userId: undefined,
          eventType: "orphaned_google_identity",
          metadata: { googleSubject },
        });
        return {
          success: false,
          status: "GOOGLE_IDENTITY_CONFLICT",
          error: "identity_orphaned",
          message: "Account not found. Please contact support.",
        };
      }
      if (user.isLocked) {
        return {
          success: false,
          status: "ACCOUNT_DISABLED",
          error: "account_locked",
          message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}.`,
        };
      }

      await ctx.runMutation(internal.auth.internal.touchAuthIdentity, {
        identityId: existingIdentity._id,
      });

      // Purge dead sessions before listing
      await ctx.runMutation(internal.auth.internal.purgeRevokedSessions, {
        userId: user._id,
      });
      await ctx.runMutation(internal.auth.internal.pruneUserDevicesArray, {
        userId: user._id,
      });

      const devicesList = await ctx.runQuery(internal.auth.internal.getUserDevicesForUI, {
        userId: user._id,
        currentDeviceId: deviceId,
      });

      const activeSub = await ctx.runQuery(
        internal.subscriptions.internal.getActiveSubscriptionByUserId,
        { userId: user._id }
      );
      const maxDevices = activeSub?.maxDevices ?? 1;

      const thisDeviceAlreadyActive = devicesList.some((d) => d.deviceId === deviceId);
      const atLimit = devicesList.length >= maxDevices;
      const blockedByLimit = !thisDeviceAlreadyActive && atLimit;

      if (blockedByLimit) {
        const switchToken = await ctx.runAction(internal.auth.helpers.signJWT, {
          payload: {
            purpose: "device_switch",
            userId: user._id,
            email: user.email,
            role: user.role || "user",
            newDeviceId: deviceId,
            newDeviceFingerprint: deviceFingerprint,
            newDeviceInfo: deviceInfo,
          },
          expiresIn: "10m",
        });

        await ctx.runMutation(internal.auth.internal.logAuditEvent, {
          actorId: user._id,
          action: "google_login_blocked_device_limit",
          targetId: user._id,
          details: { deviceId, activeDevices: devicesList.length, maxDevices },
        });

        return {
          success: false,
          status: "DEVICE_LIMIT_REACHED",
          error: "device_limit_reached",
          message: `You're already signed in on ${maxDevices} device${maxDevices === 1 ? "" : "s"}. Remove one to continue on this device.`,
          data: {
            devices: devicesList,
            maxDevices,
            devicesUsed: devicesList.length,
            switchToken,
            newDevice: {
              deviceId,
              platform: deviceInfo?.platform || "unknown",
            },
            via: "google",
          },
        };
      }

      const sessionId = await ctx.runMutation(internal.auth.internal.createSession, {
        userId: user._id,
        deviceId,
        deviceFingerprint,
        platform: deviceInfo?.platform || "web",
        expiresAt: now + 365 * 24 * 60 * 60 * 1000,
      });

      await ctx.runMutation(internal.auth.internal.updateUser, {
        userId: user._id,
        updates: { lastLogin: now, lastSeen: now },
      });

      const deviceExists = (user.devices || []).some(
        (d) => d.deviceId === deviceId || d.fingerprint === deviceFingerprint
      );

      if (!deviceExists) {
        await ctx.runMutation(internal.auth.internal.logSecurityEvent, {
          userId: user._id,
          eventType: "device_change",
          metadata: { fingerprint: deviceFingerprint, deviceId, via: "google" },
        });
      }

      await ctx.runMutation(internal.auth.internal.addDevice, {
        userId: user._id,
        fingerprint: deviceFingerprint,
        deviceId,
        lastUsed: now,
        platform: deviceInfo?.platform,
        deviceInfo,
      });

      await ctx.runMutation(internal.devices.internal.upsertDeviceInfo, {
        deviceId,
        userId: user._id,
        info: deviceInfo,
        platform: deviceInfo?.platform,
        userAgent: deviceInfo?.userAgent,
      });

      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: user._id,
        action: "google_login_success",
        targetId: user._id,
        details: { email: googleEmail, sessionId, deviceCount: devicesList.length, maxDevices },
      });

      const userRole = user.role || "user";
      const token = await ctx.runAction(internal.auth.helpers.signJWT, {
        payload: { userId: user._id, email: user.email, role: userRole, sessionId, deviceId },
        expiresIn: "30d",
      });

      return {
        success: true,
        status: "SUCCESS",
        data: {
          token,
          userId: user._id,
          name: user.name,
          email: user.email,
          username: user.username,
          displayName: user.displayName,
          sessionId,
          deviceId,
          isNewDevice: !deviceExists,
        },
      };
    }

    const existingUser = await ctx.runQuery(internal.auth.internal.getUserByEmail, {
      email: googleEmail,
    });

    // CASE B — no existing account → CREATE
    if (!existingUser) {
      const baseName = (name || googleEmail.split("@")[0]).replace(/\s+/g, "");
      const username = await ctx.runMutation(
        internal.challenges.internal.generateUniqueUsername,
        { baseName }
      );
      const referralCode = await ctx.runMutation(
        internal.users.internal.generateUniqueReferralCode,
        {}
      );

      let referredBy: string | undefined = undefined;
      if (args.referralCode) {
        const referrer = await ctx.runQuery(
          internal.users.internal.getUserByReferralCode,
          { referralCode: args.referralCode }
        );
        if (referrer) referredBy = referrer._id;
      }

      const userId = await ctx.runMutation(internal.auth.internal.insertGoogleUser, {
        email: googleEmail,
        name,
        phone: "",
        googleSubject,
        googleEmail,
        googlePicture: picture,
        username,
        displayName: name,
        referralCode,
        referredBy,
      });

      const winner = await ctx.runQuery(internal.auth.internal.getUserByEmail, {
        email: googleEmail,
      });
      let finalUserId = userId;
      if (winner && winner._id !== userId) {
        await ctx.runMutation(internal.auth.internal.deleteUserById, { userId });
        finalUserId = winner._id;
      }

      try {
        await ctx.runMutation(internal.auth.internal.createAuthIdentity, {
          userId: finalUserId,
          provider: "google",
          providerSubject: googleSubject,
        });
      } catch (err) {
        console.warn("[googleSignIn] createAuthIdentity race:", err);
      }

      const sessionId = await ctx.runMutation(internal.auth.internal.createSession, {
        userId: finalUserId,
        deviceId,
        deviceFingerprint,
        platform: deviceInfo?.platform || "web",
        expiresAt: now + 365 * 24 * 60 * 60 * 1000,
      });

      await ctx.runMutation(internal.auth.internal.updateUser, {
        userId: finalUserId,
        updates: { lastLogin: now, lastSeen: now },
      });

      await ctx.runMutation(internal.auth.internal.addDevice, {
        userId: finalUserId,
        fingerprint: deviceFingerprint,
        deviceId,
        lastUsed: now,
        platform: deviceInfo?.platform,
        deviceInfo,
      });

      await ctx.runMutation(internal.devices.internal.upsertDeviceInfo, {
        deviceId,
        userId: finalUserId,
        info: deviceInfo,
        platform: deviceInfo?.platform,
        userAgent: deviceInfo?.userAgent,
      });

      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: finalUserId,
        action: "google_account_created",
        targetId: finalUserId,
        details: {
          email: googleEmail,
          incomingReferralCode: args.referralCode ?? null,
          referredBy: referredBy ?? null,
        },
      });

      try {
        await notificationTriggers.notifyAccountCreated(ctx, finalUserId, name, googleEmail);
      } catch (e) {
        console.warn("[googleSignIn] Welcome notification failed", e);
      }

      const newUser = await ctx.runQuery(internal.auth.internal.getUserById, {
        userId: finalUserId,
      });
      const userRole = newUser?.role || "user";
      const token = await ctx.runAction(internal.auth.helpers.signJWT, {
        payload: { userId: finalUserId, email: googleEmail, role: userRole, sessionId, deviceId },
        expiresIn: "30d",
      });

      return {
        success: true,
        status: "NEW_ACCOUNT",
        data: {
          token,
          userId: finalUserId,
          name: newUser?.name || name,
          email: newUser?.email || googleEmail,
          username: newUser?.username,
          displayName: newUser?.displayName || name,
          sessionId,
          deviceId,
          isNewDevice: true,
        },
      };
    }

    // CASE C — existing email account, no Google identity → LINK REQUIRED
    if (existingUser.isLocked) {
      return {
        success: false,
        status: "ACCOUNT_DISABLED",
        error: "account_locked",
        message: `Account is locked. Reason: ${existingUser.lockReason || "suspicious activity"}.`,
      };
    }

    const linkRateKey = `google_link_${deviceId}`;
    const linkRate = await ctx.runQuery(internal.auth.internal.getRateLimit, {
      key: linkRateKey,
      endpoint: "google_link",
    });
    if (linkRate && linkRate.count >= 5 && linkRate.resetAt > now) {
      return {
        success: false,
        status: "RATE_LIMITED",
        error: "rate_limit_exceeded",
        message: "Too many linking attempts. Please wait a minute.",
      };
    }
    await ctx.runMutation(internal.auth.internal.incrementRateLimit, {
      key: linkRateKey,
      endpoint: "google_link",
      resetAt: now + 60 * 1000,
    });

    const linkToken = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: {
        purpose: "google_link",
        googleSub: googleSubject,
        googleEmail,
        googlePicture: picture || null,
        existingUserId: existingUser._id,
      },
      expiresIn: "10m",
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: existingUser._id,
      action: "google_link_required",
      targetId: existingUser._id,
      details: { googleEmail, via: "sign_in" },
    });

    return {
      success: false,
      status: "EXISTING_ACCOUNT_REQUIRES_LINK",
      error: "link_required",
      message:
        "An account already exists with this email. Please sign in to link Google Sign-In.",
      data: { linkToken, email: googleEmail },
    };
  },
});

// ============================================================
// LINK GOOGLE ACCOUNT
// ============================================================
export const linkGoogleAccount = action({
  args: {
    linkToken: v.string(),
    password: v.string(),
    deviceId: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
    deviceInfo: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    let device;
    try {
      device = normalizeDevice({
        deviceId: args.deviceId,
        deviceFingerprint: args.deviceFingerprint,
        deviceInfo: args.deviceInfo,
      });
    } catch {
      return {
        success: false,
        status: "SERVER_ERROR",
        error: "device_id_required",
        message: "A device identifier is required.",
      };
    }
    const { deviceId, deviceFingerprint, deviceInfo } = device;

    let payload;
    try {
      payload = await ctx.runAction(internal.auth.helpers.verifyJWT, {
        token: args.linkToken,
      });
    } catch (err) {
      return {
        success: false,
        status: "INVALID_GOOGLE_TOKEN",
        error: "invalid_link_token",
        message: "Link session expired. Please try Google sign-in again.",
      };
    }

    if (payload.purpose !== "google_link") {
      return {
        success: false,
        status: "INVALID_GOOGLE_TOKEN",
        error: "invalid_token_purpose",
        message: "Invalid link token.",
      };
    }

    const { googleSub, googleEmail, googlePicture, existingUserId } = payload;
    const now = Date.now();

    const rateKey = `google_link_${deviceId}`;
    const rateRecord = await ctx.runQuery(internal.auth.internal.getRateLimit, {
      key: rateKey,
      endpoint: "google_link",
    });
    if (rateRecord && rateRecord.count >= 5 && rateRecord.resetAt > now) {
      return {
        success: false,
        status: "RATE_LIMITED",
        error: "rate_limit_exceeded",
        message: "Too many attempts. Please wait a minute.",
      };
    }
    await ctx.runMutation(internal.auth.internal.incrementRateLimit, {
      key: rateKey,
      endpoint: "google_link",
      resetAt: now + 60 * 1000,
    });

    const user = await ctx.runQuery(internal.auth.internal.getUserById, {
      userId: existingUserId,
    });
    if (!user) {
      return {
        success: false,
        status: "SERVER_ERROR",
        error: "user_not_found",
        message: "Account no longer exists.",
      };
    }
    if (user.isLocked) {
      return {
        success: false,
        status: "ACCOUNT_DISABLED",
        error: "account_locked",
        message: `Account is locked.`,
      };
    }

    const passwordValid = await ctx.runAction(internal.auth.helpers.comparePassword, {
      password: args.password,
      hash: user.passwordHash,
    });

    if (!passwordValid) {
      await ctx.runMutation(internal.auth.internal.logSecurityEvent, {
        userId: user._id,
        eventType: "failed_google_link_attempt",
        metadata: { googleEmail },
      });
      return {
        success: false,
        status: "INVALID_PASSWORD",
        error: "invalid_password",
        message: "Incorrect password.",
      };
    }

    const existingIdentity = await ctx.runQuery(
      internal.auth.internal.getAuthIdentity,
      { provider: "google", providerSubject: googleSub }
    );
    if (existingIdentity && existingIdentity.userId !== user._id) {
      return {
        success: false,
        status: "GOOGLE_IDENTITY_CONFLICT",
        error: "google_conflict",
        message: "This Google account is already linked to another MedVix account.",
      };
    }

    if (!existingIdentity) {
      try {
        await ctx.runMutation(internal.auth.internal.createAuthIdentity, {
          userId: user._id,
          provider: "google",
          providerSubject: googleSub,
        });
      } catch (err) {
        return {
          success: false,
          status: "GOOGLE_IDENTITY_CONFLICT",
          error: "link_failed",
          message: "Could not link Google account. Please try again.",
        };
      }
    } else {
      await ctx.runMutation(internal.auth.internal.touchAuthIdentity, {
        identityId: existingIdentity._id,
      });
    }

    await ctx.runMutation(internal.auth.internal.linkGoogleAccount, {
      userId: user._id,
      googleSubject: googleSub,
      googleEmail,
      googlePicture: googlePicture || undefined,
    });

    const sessionId = await ctx.runMutation(internal.auth.internal.createSession, {
      userId: user._id,
      deviceId,
      deviceFingerprint,
      platform: deviceInfo?.platform || "web",
      expiresAt: now + 365 * 24 * 60 * 60 * 1000,
    });
    await ctx.runMutation(internal.auth.internal.updateUser, {
      userId: user._id,
      updates: { lastLogin: now, lastSeen: now },
    });
    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId: user._id,
      fingerprint: deviceFingerprint,
      deviceId,
      lastUsed: now,
      platform: deviceInfo?.platform,
      deviceInfo,
    });

    await ctx.runMutation(internal.devices.internal.upsertDeviceInfo, {
      deviceId,
      userId: user._id,
      info: deviceInfo,
      platform: deviceInfo?.platform,
      userAgent: deviceInfo?.userAgent,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "google_account_linked",
      targetId: user._id,
      details: { googleEmail, via: "sign_in" },
    });

    const userRole = user.role || "user";
    const token = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: { userId: user._id, email: user.email, role: userRole, sessionId, deviceId },
      expiresIn: "30d",
    });

    return {
      success: true,
      status: "ACCOUNT_LINKED",
      data: {
        token,
        userId: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        sessionId,
        deviceId,
      },
    };
  },
});

// ============================================================
// LINK GOOGLE AFTER LOGIN (settings page)
// ============================================================
export const linkGoogleAfterLogin = action({
  args: {
    token: v.string(),
    idToken: v.string(),
  },
  handler: async (ctx, args) => {
    const medvixResult = await ctx.runAction(internal.auth.actions.verifyToken, {
      token: args.token,
    });
    if (!medvixResult.success) {
      return {
        success: false,
        status: "INVALID_GOOGLE_TOKEN",
        error: "invalid_token",
        message: medvixResult.message,
      };
    }
    const userId = medvixResult.data.userId;

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      return {
        success: false,
        status: "SERVER_ERROR",
        error: "google_not_configured",
        message: "Google is not configured.",
      };
    }

    let googlePayload;
    try {
      googlePayload = await ctx.runAction(
        internal.auth.googleHelpers.verifyGoogleIdToken,
        { idToken: args.idToken, clientId: googleClientId }
      );
    } catch (err) {
      return {
        success: false,
        status: "INVALID_GOOGLE_TOKEN",
        error: "invalid_google_token",
        message: "Google verification failed.",
      };
    }

    const { sub, email, emailVerified, picture } = googlePayload;
    if (!emailVerified) {
      return {
        success: false,
        status: "INVALID_GOOGLE_TOKEN",
        error: "email_not_verified",
        message: "Your Google email is not verified.",
      };
    }

    const existingIdentity = await ctx.runQuery(
      internal.auth.internal.getAuthIdentity,
      { provider: "google", providerSubject: sub }
    );

    if (existingIdentity) {
      if (existingIdentity.userId === userId) {
        return {
          success: true,
          status: "ACCOUNT_LINKED",
          data: { alreadyLinked: true, email },
        };
      }
      return {
        success: false,
        status: "GOOGLE_IDENTITY_CONFLICT",
        error: "google_conflict",
        message: "This Google account is already linked to another MedVix account.",
      };
    }

    try {
      await ctx.runMutation(internal.auth.internal.createAuthIdentity, {
        userId,
        provider: "google",
        providerSubject: sub,
      });
    } catch (err) {
      return {
        success: false,
        status: "GOOGLE_IDENTITY_CONFLICT",
        error: "link_failed",
        message: "Could not link Google account.",
      };
    }

    await ctx.runMutation(internal.auth.internal.linkGoogleAccount, {
      userId,
      googleSubject: sub,
      googleEmail: email,
      googlePicture: picture,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "google_account_linked",
      targetId: userId,
      details: { googleEmail: email, via: "settings" },
    });

    return {
      success: true,
      status: "ACCOUNT_LINKED",
      data: { email },
    };
  },
});

// ============================================================
// UNLINK GOOGLE ACCOUNT
// ============================================================
export const unlinkGoogleAccount = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const medvixResult = await ctx.runAction(internal.auth.actions.verifyToken, {
      token: args.token,
    });
    if (!medvixResult.success) {
      return { success: false, error: "invalid_token", message: medvixResult.message };
    }
    const userId = medvixResult.data.userId;

    const identities = await ctx.runQuery(
      internal.auth.internal.getAuthIdentitiesForUser,
      { userId }
    );
    const googleIdentity = identities.find((i) => i.provider === "google");
    if (!googleIdentity) {
      return { success: false, error: "not_linked", message: "Google is not linked to this account." };
    }
    const hasPassword = identities.some((i) => i.provider === "password");
    if (!hasPassword) {
      return {
        success: false,
        error: "only_auth_method",
        message: "Cannot unlink Google because it is your only sign-in method. Set a password first.",
      };
    }

    await ctx.runMutation(internal.auth.internal.deleteAuthIdentityById, {
      identityId: googleIdentity._id,
    });

    await ctx.runMutation(internal.auth.internal.updateUser, {
      userId,
      updates: { googleSubject: undefined, googleEmail: undefined, googlePicture: undefined },
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "google_account_unlinked",
      targetId: userId,
      details: {},
    });

    return { success: true, data: { message: "Google account unlinked." } };
  },
});