// convex/sharedExams/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const createShare = mutation({
  args: {
    examData: v.any(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    console.log("[createShare] Creating share for user:", args.userId);
    const token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const createdAt = Date.now();
    const expiry = createdAt + 48 * 60 * 60 * 1000;

    // Validate examData structure (optional, but helpful)
    if (!args.examData || typeof args.examData !== 'object') {
      throw new Error("Invalid examData");
    }

    await ctx.db.insert("sharedExams", {
      token,
      examData: args.examData,
      userId: args.userId,
      createdAt,
      expiry,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: args.userId,
      action: "create_shared_exam",
      targetId: undefined,
      details: { token, expiry },
    });

    const baseUrl = process.env.PUBLIC_URL || "https://medvix.edgeone.app";
    const url = `${baseUrl}/shared-exam/?token=${token}`;
    console.log("[createShare] Share created, URL:", url);
    return { success: true, url, token, expiry };
  },
});