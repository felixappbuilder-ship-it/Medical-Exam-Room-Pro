import { v } from "convex/values";
import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Doc } from "../_generated/dataModel";
import { z } from "zod";

const getQuestionsSchema = z.object({
  subject: z.string().optional(),
  topic: z.string().optional(),
  difficulty: z.number().min(1).max(5).optional(),
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
});

// -----------------------------------------------------------------------------
// Get questions with optional filters and pagination
// -----------------------------------------------------------------------------
export const getQuestions = query({
  args: {
    subject: v.optional(v.string()),
    topic: v.optional(v.string()),
    difficulty: v.optional(v.number()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const validated = getQuestionsSchema.parse(args);

    let query = ctx.db.query("questions");

    // Apply filters if provided
    if (validated.subject) {
      query = query.withIndex("by_subject", (q: any) => q.eq("subject", validated.subject));
    }
    if (validated.topic) {
      // Note: we need a compound index for (subject, topic) or separate index on topic.
      // Assuming there is an index on "topic" as per schema (subject, topic are indexed individually)
      query = query.withIndex("by_topic", (q: any) => q.eq("topic", validated.topic));
    }
    if (validated.difficulty) {
      // No index on difficulty, but we can still filter after fetching (small set)
      // Better to fetch with other filters first, then filter in memory.
    }

    const allQuestions = await query.collect();
    
    // Apply difficulty filter in memory if needed
    let filtered = allQuestions;
    if (validated.difficulty) {
      filtered = filtered.filter(q => q.difficulty === validated.difficulty);
    }

    // Paginate
    const start = validated.offset;
    const end = start + validated.limit;
    const paginated = filtered.slice(start, end);

    return paginated;
  },
});

// -----------------------------------------------------------------------------
// Get questions by their original string IDs (for resuming exams)
// -----------------------------------------------------------------------------
export const getQuestionsByIds = query({
  args: {
    ids: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    if (args.ids.length === 0) return [];

    // Fetch all questions that match any of the given IDs
    // Since we have an index on "id", we can query one by one or use a workaround.
    // Convex doesn't have an "in" operator, so we fetch sequentially.
    const results: Doc<"questions">[] = [];
    for (const id of args.ids) {
      const question = await ctx.db
        .query("questions")
        .withIndex("by_id", (q: any) => q.eq("id", id))
        .first();
      if (question) results.push(question);
    }

    return results;
  },
});