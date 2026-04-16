// convex/auth/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

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
  },
  handler: async (ctx, args) => {
    // Rate limiting check (R15)
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

    // Check existing user by email or phone (R2 manual uniqueness)
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

    // Hash password and security answers
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

    // Create user
    const userId = await ctx.runMutation(internal.auth.internal.insertUser, {
      name: args.name,
      email: args.email,
      phone: args.phone,
      passwordHash,
      securityQuestions: hashedQuestions,
    });

    // Add device (R22)
    await ctx.runMutation(internal.auth.internal.addDevice, {
      userId,
      fingerprint: args.deviceFingerprint,
      lastUsed: now,
    });

    // Log registration (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "user_register",
      targetId: userId,
      details: { email: args.email, phone: args.phone },
    });

    // Generate JWT
    const token = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: { userId, email: args.email, role: "user" },
      expiresIn: "30d",
    });

    return {
      success: true,
      data: { token, userId, name: args.name, email: args.email },
    };
  },
});

export const login = action({
  args: {
    identifier: v.string(), // email or phone
    password: v.string(),
    deviceFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Rate limiting (R15)
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

    // Find user by email or phone
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

    // Check if account is locked (R21)
    if (user.isLocked) {
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}. Contact support.`,
      };
    }

    // Verify password
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

    // Device change event (R22)
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

    // Log successful login (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "user_login",
      targetId: user._id,
      details: { deviceFingerprint: args.deviceFingerprint },
    });

    // Generate JWT
    const token = await ctx.runAction(internal.auth.helpers.signJWT, {
      payload: { userId: user._id, email: user.email, role: "user" },
      expiresIn: "30d",
    });

    return {
      success: true,
      data: { token, userId: user._id, name: user.name, email: user.email },
    };
  },
});

export const verifyToken = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const payload = await ctx.runAction(internal.auth.helpers.verifyJWT, { token: args.token });
      return { success: true, data: payload };
    } catch (err) {
      return { success: false, error: "invalid_token", message: "Token is invalid or expired." };
    }
  },
});

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

    // Verify security answers
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

    // Generate a temporary reset token (short-lived)
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
      return {
        success: false,
        error: "invalid_token",
        message: "Reset token is invalid or expired.",
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