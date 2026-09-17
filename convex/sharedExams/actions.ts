// convex/sharedExams/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import crypto from "crypto";
import * as notificationTriggers from "../notifications/triggers";

async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error(result.message);
  const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId: result.data.userId });
  if (!user) throw new Error("User not found");
  return user;
}

// ============================================================
// SHARE EXAM – creates a public share link and notifies the creator
// ============================================================
export const shareExam = action({
  args: {
    token: v.string(),
    examData: v.any(),
    expiryHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const expiryHours = args.expiryHours || 168; // default 7 days
    const expiry = Date.now() + expiryHours * 60 * 60 * 1000;
    const shareToken = crypto.randomBytes(16).toString("hex");

    // Store the shared exam
    await ctx.runMutation(internal.sharedExams.internal.createSharedExam, {
      userId: user._id,
      token: shareToken,
      examData: args.examData,
      expiry,
    });

    // 🔔 Send notification to the creator with the share link
    await notificationTriggers.notifyExamShared(
      ctx,
      user._id,
      shareToken,
      expiry,
      user.displayName || user.name
    );

    // Audit log
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "share_exam",
      details: { shareToken, expiry, examId: args.examData?.examId },
    });

    return {
      success: true,
      data: {
        shareToken,
        shareUrl: `/shared-exam/?token=${shareToken}`,
        expiry,
      },
    };
  },
});

// ============================================================
// CLEANUP EXPIRED SHARED EXAMS (cron)
// ============================================================
export const cleanupExpiredSharedExams = action({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.runQuery(internal.sharedExams.internal.getExpiredSharedExams, {});
    for (const exam of expired) {
      await ctx.runMutation(internal.sharedExams.internal.deleteSharedExam, { id: exam._id });
    }
    return { deletedCount: expired.length };
  },
});