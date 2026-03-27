import { v } from "convex/values";
import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { z } from "zod";

const getSecurityQuestionsSchema = z.object({
  identifier: z.string(),
});

async function findUserByIdentifier(ctx: any, identifier: string) {
  if (identifier.includes("@")) {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q: any) => q.eq("email", identifier.toLowerCase()))
      .first();
  } else {
    return await ctx.db
      .query("users")
      .withIndex("by_phone", (q: any) => q.eq("phone", identifier))
      .first();
  }
}

export const getSecurityQuestions = query({
  args: {
    identifier: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = getSecurityQuestionsSchema.parse(args);

    const user = await findUserByIdentifier(ctx, validated.identifier);
    if (!user) throw new ConvexError("User not found");

    // Return only the questions (not answers)
    return user.securityQuestions.map((q: any) => q.question);
  },
});