import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { z } from "zod";

// Validation schemas (Zod)
const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().regex(/^254\d{9}$/), // Kenyan format
  password: z.string().min(8),
  securityQuestions: z.array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
    })
  ).length(3),
  deviceFingerprint: z.string().min(1),
  deviceInfo: z.object({
    platform: z.string(),
    lastIp: z.string().ip().optional(),
  }),
});

const loginSchema = z.object({
  identifier: z.string(), // email or phone
  password: z.string(),
  deviceFingerprint: z.string().min(1),
  deviceInfo: z.object({
    platform: z.string(),
    lastIp: z.string().ip().optional(),
  }),
});

const verifySecurityAnswersSchema = z.object({
  identifier: z.string(),
  answers: z.array(z.string()).length(3),
});

const resetPasswordSchema = z.object({
  identifier: z.string(),
  newPassword: z.string().min(8),
  resetToken: z.string(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

const logoutSchema = z.object({
  deviceFingerprint: z.string().min(1),
});

const logoutOtherDevicesSchema = z.object({
  deviceFingerprint: z.string().min(1),
});

// Helper to find user by email or phone
async function findUserByIdentifier(ctx: any, identifier: string) {
  // Check if identifier is email (contains @)
  if (identifier.includes("@")) {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q: any) => q.eq("email", identifier.toLowerCase()))
      .first();
  } else {
    // Assume phone
    return await ctx.db
      .query("users")
      .withIndex("by_phone", (q: any) => q.eq("phone", identifier))
      .first();
  }
}

// -----------------------------------------------------------------------------
// Register
// -----------------------------------------------------------------------------
export const register = mutation({
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
    deviceInfo: v.object({
      platform: v.string(),
      lastIp: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    // Validate input
    const validated = registerSchema.parse(args);

    // Check if email or phone already exists
    const existingEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q: any) => q.eq("email", validated.email.toLowerCase()))
      .first();
    if (existingEmail) throw new ConvexError("Email already registered");

    const existingPhone = await ctx.db
      .query("users")
      .withIndex("by_phone", (q: any) => q.eq("phone", validated.phone))
      .first();
    if (existingPhone) throw new ConvexError("Phone number already registered");

    // Hash password via action
    const passwordHash = await ctx.runAction(internal.auth.actions.hashPassword, {
      password: validated.password,
    });

    // Hash security answers via action
    const hashedQuestions = await Promise.all(
      validated.securityQuestions.map(async (q) => ({
        question: q.question,
        answerHash: await ctx.runAction(internal.auth.actions.hashSecurityAnswer, {
          answer: q.answer,
        }),
      }))
    );

    // Create user document
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: validated.name,
      email: validated.email.toLowerCase(),
      phone: validated.phone,
      passwordHash,
      securityQuestions: hashedQuestions,
      devices: [
        {
          fingerprint: validated.deviceFingerprint,
          lastUsed: now,
          platform: validated.deviceInfo.platform,
          lastIp: validated.deviceInfo.lastIp,
        },
      ],
      preferences: { theme: "auto", notifications: true }, // default
      createdAt: now,
      lastLogin: now,
      isLocked: false,
      role: "user",
      trialUsed: false,
    });

    // Generate JWT token via action
    const token = await ctx.runAction(internal.auth.actions.createToken, {
      payload: { userId, role: "user" },
    });

    return { userId, token };
  },
});

// -----------------------------------------------------------------------------
// Login
// -----------------------------------------------------------------------------
export const login = mutation({
  args: {
    identifier: v.string(),
    password: v.string(),
    deviceFingerprint: v.string(),
    deviceInfo: v.object({
      platform: v.string(),
      lastIp: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const validated = loginSchema.parse(args);

    // Find user
    const user = await findUserByIdentifier(ctx, validated.identifier);
    if (!user) throw new ConvexError("Invalid credentials");

    // Check if account is locked
    if (user.isLocked) throw new ConvexError("Account is locked. Contact support.");

    // Verify password via action
    const isValid = await ctx.runAction(internal.auth.actions.verifyPassword, {
      password: validated.password,
      hash: user.passwordHash,
    });
    if (!isValid) {
      // Log failed login attempt (security event)
      await ctx.db.insert("securityEvents", {
        userId: user._id,
        type: "failed_login",
        details: { deviceFingerprint: validated.deviceFingerprint },
        timestamp: Date.now(),
        resolved: false,
      });
      throw new ConvexError("Invalid credentials");
    }

    // Update device list
    const now = Date.now();
    const existingDeviceIndex = user.devices.findIndex(
      (d: any) => d.fingerprint === validated.deviceFingerprint
    );
    let isNewDevice = false;
    if (existingDeviceIndex >= 0) {
      // Update existing device
      user.devices[existingDeviceIndex].lastUsed = now;
      user.devices[existingDeviceIndex].lastIp = validated.deviceInfo.lastIp;
    } else {
      // Add new device
      user.devices.push({
        fingerprint: validated.deviceFingerprint,
        lastUsed: now,
        platform: validated.deviceInfo.platform,
        lastIp: validated.deviceInfo.lastIp,
      });
      isNewDevice = true;

      // Log security event for new device
      await ctx.db.insert("securityEvents", {
        userId: user._id,
        type: "device_change",
        details: { deviceFingerprint: validated.deviceFingerprint },
        timestamp: now,
        resolved: false,
      });
    }

    // Update user's lastLogin and devices
    await ctx.db.patch(user._id, {
      lastLogin: now,
      devices: user.devices,
    });

    // Generate token
    const token = await ctx.runAction(internal.auth.actions.createToken, {
      payload: { userId: user._id, role: user.role },
    });

    return {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
      isNewDevice,
    };
  },
});

// -----------------------------------------------------------------------------
// Verify Security Answers and Issue Reset Token
// -----------------------------------------------------------------------------
export const verifySecurityAnswers = mutation({
  args: {
    identifier: v.string(),
    answers: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const validated = verifySecurityAnswersSchema.parse(args);

    const user = await findUserByIdentifier(ctx, validated.identifier);
    if (!user) throw new ConvexError("User not found");

    // Check each answer (order matters)
    for (let i = 0; i < 3; i++) {
      const stored = user.securityQuestions[i];
      if (!stored) throw new ConvexError("Security questions not set up correctly");
      const match = await ctx.runAction(internal.auth.actions.compareSecurityAnswer, {
        answer: validated.answers[i],
        hash: stored.answerHash,
      });
      if (!match) throw new ConvexError("Incorrect answers");
    }

    // Generate reset token via action
    const resetToken = await ctx.runAction(internal.auth.actions.createResetToken, {
      userId: user._id,
    });

    return { resetToken };
  },
});

// -----------------------------------------------------------------------------
// Reset Password
// -----------------------------------------------------------------------------
export const resetPassword = mutation({
  args: {
    identifier: v.string(),
    newPassword: v.string(),
    resetToken: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = resetPasswordSchema.parse(args);

    // Verify reset token via action
    let payload;
    try {
      payload = await ctx.runAction(internal.auth.actions.verifyResetToken, {
        token: validated.resetToken,
      });
    } catch (error) {
      throw new ConvexError("Invalid or expired reset token");
    }

    // Find user by identifier (to double-check)
    const user = await findUserByIdentifier(ctx, validated.identifier);
    if (!user || user._id !== payload.userId) {
      throw new ConvexError("User mismatch");
    }

    // Hash new password
    const newPasswordHash = await ctx.runAction(internal.auth.actions.hashPassword, {
      password: validated.newPassword,
    });

    // Update user's password
    await ctx.db.patch(user._id, { passwordHash: newPasswordHash });

    // Log security event
    await ctx.db.insert("securityEvents", {
      userId: user._id,
      type: "password_reset",
      details: {},
      timestamp: Date.now(),
      resolved: true,
    });

    return { success: true };
  },
});

// -----------------------------------------------------------------------------
// Change Password (authenticated)
// -----------------------------------------------------------------------------
export const changePassword = mutation({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = changePasswordSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db.get(identity.subject);
    if (!user) throw new ConvexError("User not found");

    // Verify current password
    const isValid = await ctx.runAction(internal.auth.actions.verifyPassword, {
      password: validated.currentPassword,
      hash: user.passwordHash,
    });
    if (!isValid) throw new ConvexError("Current password is incorrect");

    // Hash new password
    const newPasswordHash = await ctx.runAction(internal.auth.actions.hashPassword, {
      password: validated.newPassword,
    });

    // Update
    await ctx.db.patch(user._id, { passwordHash: newPasswordHash });

    // Log security event
    await ctx.db.insert("securityEvents", {
      userId: user._id,
      type: "password_change",
      details: {},
      timestamp: Date.now(),
      resolved: true,
    });

    return { success: true };
  },
});

// -----------------------------------------------------------------------------
// Logout (remove current device)
// -----------------------------------------------------------------------------
export const logout = mutation({
  args: {
    deviceFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = logoutSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db.get(identity.subject);
    if (!user) throw new ConvexError("User not found");

    // Remove the device with matching fingerprint
    const updatedDevices = user.devices.filter(
      (d: any) => d.fingerprint !== validated.deviceFingerprint
    );

    await ctx.db.patch(user._id, { devices: updatedDevices });

    return { success: true };
  },
});

// -----------------------------------------------------------------------------
// Logout Other Devices (keep current)
// -----------------------------------------------------------------------------
export const logoutOtherDevices = mutation({
  args: {
    deviceFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = logoutOtherDevicesSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db.get(identity.subject);
    if (!user) throw new ConvexError("User not found");

    // Keep only the current device
    const currentDevice = user.devices.find(
      (d: any) => d.fingerprint === validated.deviceFingerprint
    );
    const updatedDevices = currentDevice ? [currentDevice] : [];

    await ctx.db.patch(user._id, { devices: updatedDevices });

    return { success: true };
  },
});