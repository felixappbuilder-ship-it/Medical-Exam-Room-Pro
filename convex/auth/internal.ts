// convex/auth/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const insertUser = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    passwordHash: v.string(),
    securityQuestions: v.array(
      v.object({
        question: v.string(),
        answerHash: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      phone: args.phone,
      passwordHash: args.passwordHash,
      securityQuestions: args.securityQuestions,
      isLocked: false,
      trialUsed: false,
      devices: [],
    });
    return userId;
  },
});

export const getUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    return user;
  },
});

export const getUserByPhone = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();
    return user;
  },
});

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const updateUser = internalMutation({
  args: {
    userId: v.id("users"),
    updates: v.object({
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
      passwordHash: v.optional(v.string()),
      isLocked: v.optional(v.boolean()),
      lockReason: v.optional(v.string()),
      trialUsed: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, args.updates);
  },
});

export const addDevice = internalMutation({
  args: {
    userId: v.id("users"),
    fingerprint: v.string(),
    lastUsed: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const devices = user.devices || [];
    const existingIndex = devices.findIndex((d) => d.fingerprint === args.fingerprint);
    if (existingIndex >= 0) {
      devices[existingIndex].lastUsed = args.lastUsed;
    } else {
      devices.push({ fingerprint: args.fingerprint, lastUsed: args.lastUsed });
    }
    await ctx.db.patch(args.userId, { devices });
  },
});

export const logSecurityEvent = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    eventType: v.string(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("securityEvents", {
      userId: args.userId,
      eventType: args.eventType,
      timestamp: Date.now(),
      metadata: args.metadata,
    });
  },
});

export const logAuditEvent = internalMutation({
  args: {
    actorId: v.string(),
    action: v.string(),
    targetId: v.optional(v.string()),
    details: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      actorId: args.actorId,
      action: args.action,
      targetId: args.targetId,
      timestamp: Date.now(),
      details: args.details,
    });
  },
});

export const incrementRateLimit = internalMutation({
  args: {
    key: v.string(),
    endpoint: v.string(),
    resetAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rateLimit")
      .withIndex("by_key_endpoint", (q) => q.eq("key", args.key).eq("endpoint", args.endpoint))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        count: existing.count + 1,
        resetAt: args.resetAt,
      });
    } else {
      await ctx.db.insert("rateLimit", {
        key: args.key,
        endpoint: args.endpoint,
        count: 1,
        resetAt: args.resetAt,
      });
    }
  },
});

export const getRateLimit = internalQuery({
  args: {
    key: v.string(),
    endpoint: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("rateLimit")
      .withIndex("by_key_endpoint", (q) => q.eq("key", args.key).eq("endpoint", args.endpoint))
      .first();
  },
});

export const lockUser = internalMutation({
  args: {
    userId: v.id("users"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      isLocked: true,
      lockReason: args.reason,
    });
    await ctx.db.insert("securityEvents", {
      userId: args.userId,
      eventType: "account_locked",
      timestamp: Date.now(),
      metadata: { reason: args.reason },
    });
  },
});