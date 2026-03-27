import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { z } from "zod";

const recordSeenQuestionsSchema = z.object({
  subject: z.string().min(1),
  topic: z.string().min(1),
  questionIds: z.array(z.string()).min(1),
});

const resetSeenQuestionsSchema = z.object({
  subject: z.string().min(1),
  topic: z.string().min(1),
});

// -----------------------------------------------------------------------------
// Record that a user has seen specific questions in a subject/topic
// -----------------------------------------------------------------------------
export const recordSeenQuestions = mutation({
  args: {
    subject: v.string(),
    topic: v.string(),
    questionIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const validated = recordSeenQuestionsSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    // Find existing seenQuestions document for this user/subject/topic
    const existing = await ctx.db
      .query("seenQuestions")
      .withIndex("by_user_subject_topic", (q: any) =>
        q.eq("userId", userId).eq("subject", validated.subject).eq("topic", validated.topic)
      )
      .first();

    if (existing) {
      // Merge existing questionIds with new ones (avoid duplicates)
      const currentSet = new Set(existing.questionIds);
      for (const qid of validated.questionIds) {
        currentSet.add(qid);
      }
      const mergedIds = Array.from(currentSet);
      await ctx.db.patch(existing._id, { questionIds: mergedIds });
    } else {
      // Create new document
      await ctx.db.insert("seenQuestions", {
        userId,
        subject: validated.subject,
        topic: validated.topic,
        questionIds: validated.questionIds,
      });
    }

    return { success: true };
  },
});

// -----------------------------------------------------------------------------
// Reset seen questions for a user in a specific subject/topic
// -----------------------------------------------------------------------------
export const resetSeenQuestions = mutation({
  args: {
    subject: v.string(),
    topic: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = resetSeenQuestionsSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const existing = await ctx.db
      .query("seenQuestions")
      .withIndex("by_user_subject_topic", (q: any) =>
        q.eq("userId", userId).eq("subject", validated.subject).eq("topic", validated.topic)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { success: true };
  },
});