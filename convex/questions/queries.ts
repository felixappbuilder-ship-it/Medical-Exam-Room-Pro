// convex/questions/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getQuestions = query({
  args: {
    subject: v.optional(v.string()),
    topic: v.optional(v.string()),
    difficulty: v.optional(v.number()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("questions")),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    let queryBuilder = ctx.db.query("questions");
    if (args.subject && args.topic) {
      // Use compound index? Actually schema has by_category_difficulty, but subject/topic not indexed.
      // Fallback to filter
      queryBuilder = queryBuilder.filter((q) =>
        q.and(
          q.eq(q.field("category"), args.subject),
          q.eq(q.field("difficulty"), args.difficulty ?? 1)
        )
      );
    }
    if (args.cursor) {
      queryBuilder = queryBuilder.filter((q) => q.lt(q.field("_id"), args.cursor));
    }
    const questions = await queryBuilder.take(limit + 1);
    const hasMore = questions.length > limit;
    const results = questions.slice(0, limit);
    const nextCursor = hasMore ? results[results.length - 1]._id : null;
    return {
      success: true,
      data: {
        questions: results,
        nextCursor,
        hasMore,
      },
    };
  },
});

export const getQuestionsByIds = query({
  args: { questionIds: v.array(v.string()), token: v.string() },
  handler: async (ctx, args) => {
    // Verify JWT – even though questions are semi-public, we still require auth
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
    const questions = await ctx.runQuery(internal.questions.internal.getQuestionsByIds, {
      questionIds: args.questionIds,
    });
    return {
      success: true,
      data: { questions },
    };
  },
});

export const getUnseenQuestions = query({
  args: {
    token: v.string(),
    subject: v.string(),
    topic: v.string(),
    limit: v.optional(v.number()),
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
    const seenIds = await ctx.runQuery(internal.questions.internal.getSeenQuestions, {
      userId,
      subject: args.subject,
      topic: args.topic,
    });
    // Get all questions for subject/topic (simplified – in production you'd paginate)
    const allQuestions = await ctx.db
      .query("questions")
      .filter((q) => q.eq(q.field("category"), args.subject))
      .collect();
    const unseen = allQuestions.filter((q) => !seenIds.includes(q._id));
    const limit = args.limit || 10;
    const results = unseen.slice(0, limit);
    return {
      success: true,
      data: {
        questions: results,
        totalUnseen: unseen.length,
      },
    };
  },
});