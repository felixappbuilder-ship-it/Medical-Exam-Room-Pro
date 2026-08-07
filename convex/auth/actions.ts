// convex/auth/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ============================================================
// REGISTER (with referral, isAgent, agentVerified)
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
    deviceFingerprint: v.string(),
    deviceInfo: v.optional(v.any()),
    referralCode: v.optional(v.string()),
    isAgent: v.optional(v.boolean()),
    agentVerified: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const resetAt = now + 60 * 1000;
    const rateKey = `register_${args.deviceFingerprint}`;
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
    // Ensure username uniqueness – this mutation is defined in challenges/internal.ts
    const username = await ctx.runMutation(internal.challenges.internal.generateUniqueUsername, {
      baseName,
    });
    const displayName = args.name;

    // ============================================================
    // REFERRAL HANDLING
    // ============================================================
    // Generate a new referral code for the user (always, even if no referrer)
    const referralCode = await ctx.runMutation(internal.users.internal.generateUniqueReferralCode, {});

    let referredBy: string | undefined = undefined;
    if (args.referralCode) {
      const referrer = await ctx.runQuery(internal.users.internal.getUserByReferralCode, {
        referralCode: args.referralCode,
      });
      if (referrer) {
        referredBy = referrer._id;
      }
    }

    const isAgent = args.isAgent || false;
    const agentVerified = args.agentVerified || false;

    // Insert user with all fields
    const userId = await ctx.runMutation(internal.auth.internal.insertUser, {
      name: args.name,
      email: args.email,
      phone: args.phone,
      passwordHash,
      securityQuestions: hashedQuestions,
      username,
      displayName,
      referralCode,               // always a string (generated)
      referredBy,
      isAgent,
      agentVerified,
      referralBalance: 0,
      totalEarned: 0,
      pendingBalance: 0,
    });

    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId,
      fingerprint: args.deviceFingerprint,
      lastUsed: now,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "user_register",
      targetId: userId,
      details: {
        email: args.email,
        phone: args.phone,
        deviceInfo: args.deviceInfo,
        referralCode: args.referralCode,
        isAgent: args.isAgent,
        agentVerified: args.agentVerified,
      },
    });

    const token = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: { userId, email: args.email, role: "user" },
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
      },
    };
  },
});

// ============================================================
// LOGIN – with session management & single-device enforcement
// ============================================================
export const login = action({
  args: {
    identifier: v.string(),
    password: v.string(),
    deviceFingerprint: v.string(),
    deviceInfo: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
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

    // ---- SESSION MANAGEMENT ----
    const existingSession = await ctx.runQuery(internal.auth.internal.getSessionByDeviceId, {
      deviceId: args.deviceFingerprint,
    });
    if (existingSession && existingSession.userId !== user._id) {
      await ctx.runMutation(internal.auth.internal.revokeAllSessions, { userId: existingSession.userId });
    }
    const activeSession = await ctx.runQuery(internal.auth.internal.getActiveSession, { userId: user._id });
    if (activeSession && activeSession.deviceId !== args.deviceFingerprint) {
      await ctx.runMutation(internal.auth.internal.revokeSession, { sessionId: activeSession.sessionId });
    }

    const sessionId = await ctx.runMutation(internal.auth.internal.createSession, {
      userId: user._id,
      deviceId: args.deviceFingerprint,
      deviceFingerprint: args.deviceFingerprint,
      platform: args.deviceInfo?.platform || "web",
      expiresAt: now + 30 * 24 * 60 * 60 * 1000,
    });

    const existingDevices = user.devices || [];
    const deviceExists = existingDevices.some((d) => d.fingerprint === args.deviceFingerprint);
    if (!deviceExists) {
      await ctx.runMutation(internal.auth.internal.logSecurityEvent, {
        userId: user._id,
        eventType: "device_change",
        metadata: { fingerprint: args.deviceFingerprint, timestamp: now },
      });
    }
    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId: user._id,
      fingerprint: args.deviceFingerprint,
      lastUsed: now,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "user_login",
      targetId: user._id,
      details: { deviceFingerprint: args.deviceFingerprint, sessionId },
    });

    const userRole = user.role || "user";
    const token = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: { userId: user._id, email: user.email, role: userRole, sessionId },
      expiresIn: "30d",
    });

    return {
      success: true,
      data: {
        token,
        userId: user._id,
        name: user.name,
        email: user.email,
        role: userRole,
        username: user.username,
        displayName: user.displayName,
        sessionId,
        isNewDevice: !deviceExists,
      },
    };
  },
});

// ============================================================
// VERIFY TOKEN
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

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "change_password",
      targetId: userId,
      details: {},
    });

    await ctx.runMutation(internal.auth.internal.revokeAllSessions, { userId });

    return { success: true, data: { message: "Password changed successfully. You have been logged out from other devices." } };
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
      return {
        success: false,
        error: "user_not_found",
        message: "No account found with that email or phone.",
      };
    }

    const storedQuestions = user.securityQuestions || [];
    if (storedQuestions.length !== args.securityAnswers.length) {
      return {
        success: false,
        error: "invalid_answers",
        message: "Security answer verification failed.",
      };
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
        return {
          success: false,
          error: "invalid_answers",
          message: "Security answer verification failed.",
        };
      }
    }

    const resetToken = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: { userId: user._id, purpose: "password_reset" },
      expiresIn: "15m",
    });

    return {
      success: true,
      data: { resetToken },
    };
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
      return {
        success: false,
        error: "invalid_token",
        message: errorMessage,
      };
    }
    if (payload.purpose !== "password_reset") {
      return {
        success: false,
        error: "invalid_token",
        message: "Invalid token purpose.",
      };
    }

    const userId = payload.userId;
    const newHash = await ctx.runAction(internal.auth.helpers.hashPassword, {
      password: args.newPassword,
    });
    await ctx.runMutation(internal.auth.internal.updateUser, {
      userId,
      updates: { passwordHash: newHash },
    });
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "password_reset",
      targetId: userId,
      details: {},
    });

    return {
      success: true,
      data: { message: "Password has been reset successfully." },
    };
  },
});

export const verifySecurityAnswers = action({
  args: {
    identifier: v.string(),
    answers: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await resetPasswordRequest(ctx, {
      identifier: args.identifier,
      securityAnswers: args.answers,
    });
    if (!result.success) return result;
    return {
      success: true,
      data: { resetToken: result.data.resetToken },
    };
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