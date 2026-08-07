// convex/auth/helpers.ts
"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 10;

export const hashPassword = internalAction({
  args: { password: v.string() },
  handler: async (_, args) => {
    return await bcrypt.hash(args.password, SALT_ROUNDS);
  },
});

export const comparePassword = internalAction({
  args: { password: v.string(), hash: v.string() },
  handler: async (_, args) => {
    return await bcrypt.compare(args.password, args.hash);
  },
});

export const hashSecurityAnswer = internalAction({
  args: { answer: v.string() },
  handler: async (_, args) => {
    return await bcrypt.hash(args.answer.toLowerCase().trim(), SALT_ROUNDS);
  },
});

export const compareSecurityAnswer = internalAction({
  args: { answer: v.string(), hash: v.string() },
  handler: async (_, args) => {
    return await bcrypt.compare(args.answer.toLowerCase().trim(), args.hash);
  },
});

export const signJWT = internalAction({
  args: { payload: v.any(), expiresIn: v.optional(v.string()) },
  handler: async (_, args) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET not set");
    return jwt.sign(args.payload, secret, { expiresIn: args.expiresIn || "30d" });
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
    try {
      const decoded = jwt.verify(args.token, secret);
      return decoded;
    } catch (err) {
      console.error("[verifyJWT] Verification failed:", err.message);
      // Re-throw with a clear message
      throw new Error(`JWT verification error: ${err.message}`);
    }
  },
});