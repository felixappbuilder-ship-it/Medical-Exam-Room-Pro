"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// Environment variables (set in Convex dashboard)
const JWT_SECRET = process.env.JWT_SECRET!;
const RESET_TOKEN_EXPIRY = "15m"; // 15 minutes

// -----------------------------------------------------------------------------
// Password helpers
// -----------------------------------------------------------------------------

export const hashPassword = action({
  args: { password: v.string() },
  handler: async (_, args) => {
    const saltRounds = 10;
    return await bcrypt.hash(args.password, saltRounds);
  },
});

export const verifyPassword = action({
  args: { password: v.string(), hash: v.string() },
  handler: async (_, args) => {
    return await bcrypt.compare(args.password, args.hash);
  },
});

// -----------------------------------------------------------------------------
// JWT helpers
// -----------------------------------------------------------------------------

export const createToken = action({
  args: {
    payload: v.any(),
    expiresIn: v.optional(v.string()),
  },
  handler: async (_, args) => {
    const expiresIn = args.expiresIn || "7d"; // default 7 days
    return jwt.sign(args.payload, JWT_SECRET, { expiresIn });
  },
});

export const verifyToken = action({
  args: { token: v.string() },
  handler: async (_, args) => {
    try {
      return jwt.verify(args.token, JWT_SECRET);
    } catch (error) {
      throw new Error("Invalid or expired token");
    }
  },
});

// -----------------------------------------------------------------------------
// Security questions helpers
// -----------------------------------------------------------------------------

export const hashSecurityAnswer = action({
  args: { answer: v.string() },
  handler: async (_, args) => {
    // Use a fast hash for security answers (not for passwords)
    const hash = crypto.createHash("sha256").update(args.answer.toLowerCase().trim()).digest("hex");
    return hash;
  },
});

export const compareSecurityAnswer = action({
  args: { answer: v.string(), hash: v.string() },
  handler: async (_, args) => {
    const hashedInput = crypto
      .createHash("sha256")
      .update(args.answer.toLowerCase().trim())
      .digest("hex");
    return hashedInput === args.hash;
  },
});

// -----------------------------------------------------------------------------
// Reset token helpers (JWT-based)
// -----------------------------------------------------------------------------

export const createResetToken = action({
  args: { userId: v.id("users") },
  handler: async (_, args) => {
    return jwt.sign({ userId: args.userId, type: "reset" }, JWT_SECRET, {
      expiresIn: RESET_TOKEN_EXPIRY,
    });
  },
});

export const verifyResetToken = action({
  args: { token: v.string() },
  handler: async (_, args) => {
    try {
      const payload = jwt.verify(args.token, JWT_SECRET) as any;
      if (payload.type !== "reset") throw new Error("Invalid token type");
      return { userId: payload.userId };
    } catch (error) {
      throw new Error("Invalid or expired reset token");
    }
  },
});