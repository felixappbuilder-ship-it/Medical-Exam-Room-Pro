// convex/questions/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const recordSeenQuestions = mutation({
  args: {
    token: v.string(),
    subject: v.string(),
    topic: v.string(),
    questionIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
    } catch (err) {
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }
    const userId = payload.userId;
    // Validate user exists and not locked
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User not found.",
      };
    }
    if (user.isLocked) {
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}.`,
      };
    }
    await ctx.runMutation(internal.questions.internal.upsertSeenQuestions, {
      userId,
      subject: args.subject,
      topic: args.topic,
      questionIds: args.questionIds,
    });
    // Audit log (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "record_seen_questions",
      targetId: userId,
      details: { subject: args.subject, topic: args.topic, count: args.questionIds.length },
    });
    return {
      success: true,
      data: { message: "Seen questions recorded." },
    };
  },
});

export const resetSeenQuestions = mutation({
  args: {
    token: v.string(),
    subject: v.string(),
    topic: v.string(),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
    } catch (err) {
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }
    const userId = payload.userId;
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user || user.isLocked) {
      return {
        success: false,
        error: "unauthorized",
        message: "Cannot reset seen questions.",
      };
    }
    await ctx.runMutation(internal.questions.internal.resetSeenQuestions, {
      userId,
      subject: args.subject,
      topic: args.topic,
    });
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "reset_seen_questions",
      targetId: userId,
      details: { subject: args.subject, topic: args.topic },
    });
    return {
      success: true,
      data: { message: "Seen questions reset." },
    };
  },
});