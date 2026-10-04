// convex/auth/helpers.ts
"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// ============================================================
// CONSTANTS
// ============================================================
const SALT_ROUNDS = 10;
const GOOGLE_ONLY_PASSWORD_PREFIX = "GOOGLE_OAUTH_ONLY_NO_PASSWORD_";

// ============================================================
// PASSWORD HASHING (bcrypt)
// ============================================================

export const hashPassword = internalAction({
  args: { password: v.string() },
  handler: async (_, args) => {
    if (!args.password || args.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    return await bcrypt.hash(args.password, SALT_ROUNDS);
  },
});

export const comparePassword = internalAction({
  args: { password: v.string(), hash: v.string() },
  handler: async (_, args) => {
    if (!args.password || !args.hash) return false;

    // Google-only accounts have a placeholder hash that cannot be compared
    // against a real password. Always fail password login for them.
    if (args.hash.startsWith(GOOGLE_ONLY_PASSWORD_PREFIX)) {
      console.warn("[comparePassword] Attempted password login on Google-only account");
      return false;
    }

    try {
      return await bcrypt.compare(args.password, args.hash);
    } catch (err) {
      console.error("[comparePassword] bcrypt error:", err);
      return false;
    }
  },
});

// ============================================================
// SECURITY ANSWER HASHING (bcrypt, case-insensitive)
// ============================================================

export const hashSecurityAnswer = internalAction({
  args: { answer: v.string() },
  handler: async (_, args) => {
    if (!args.answer) {
      throw new Error("Security answer is required");
    }
    return await bcrypt.hash(args.answer.toLowerCase().trim(), SALT_ROUNDS);
  },
});

export const compareSecurityAnswer = internalAction({
  args: { answer: v.string(), hash: v.string() },
  handler: async (_, args) => {
    if (!args.answer || !args.hash) return false;
    try {
      return await bcrypt.compare(args.answer.toLowerCase().trim(), args.hash);
    } catch (err) {
      console.error("[compareSecurityAnswer] bcrypt error:", err);
      return false;
    }
  },
});

// ============================================================
// JWT SIGNING / VERIFICATION
// ============================================================

export const signJWT = internalAction({
  args: {
    payload: v.any(),
    expiresIn: v.optional(v.string()),
  },
  handler: async (_, args) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("[signJWT] JWT_SECRET not set");
      throw new Error("JWT_SECRET not set");
    }
    try {
      return jwt.sign(args.payload, secret, {
        expiresIn: args.expiresIn || "30d",
      } as jwt.SignOptions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error("[signJWT] Signing failed:", msg);
      throw new Error(`JWT signing error: ${msg}`);
    }
  },
});

export const verifyJWT = internalAction({
  args: { token: v.string() },
  handler: async (_, args) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("[verifyJWT] JWT_SECRET is NOT set in environment variables");
      throw new Error("JWT_SECRET not set");
    }
    if (!args.token) {
      throw new Error("JWT verification error: token is empty");
    }
    try {
      const decoded = jwt.verify(args.token, secret);
      return decoded;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error("[verifyJWT] Verification failed:", msg);
      throw new Error(`JWT verification error: ${msg}`);
    }
  },
});

// ============================================================
// GOOGLE-ONLY ACCOUNT HELPERS
// ============================================================

/**
 * Returns true if the given password hash belongs to a Google-only account.
 * Used by profile/settings flows to detect users who cannot use password login.
 */
export const isGoogleOnlyAccount = internalAction({
  args: { passwordHash: v.string() },
  handler: async (_, args) => {
    return !!args.passwordHash && args.passwordHash.startsWith(GOOGLE_ONLY_PASSWORD_PREFIX);
  },
});

/**
 * Generate a placeholder password hash for Google-only accounts.
 * Called from insertGoogleUser. Kept deterministic-ish so it cannot be
 * accidentally treated as a real bcrypt hash.
 */
export const generateGoogleOnlyPasswordHash = internalAction({
  args: { userId: v.string() },
  handler: async (_, args) => {
    return `${GOOGLE_ONLY_PASSWORD_PREFIX}${args.userId}_${Date.now().toString(36)}`;
  },
});