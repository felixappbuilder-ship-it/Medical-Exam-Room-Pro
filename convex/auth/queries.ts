// convex/auth/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getSecurityQuestions = query({
  args: { identifier: v.string() },
  handler: async (ctx, args) => {
    let user = await ctx.runQuery(internal.auth.internal.getUserByEmail, { email: args.identifier });
    if (!user) {
      user = await ctx.runQuery(internal.auth.internal.getUserByPhone, { phone: args.identifier });
    }
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "No account found with that email or phone.",
      };
    }
    const questions = (user.securityQuestions || []).map((sq) => sq.question);
    return {
      success: true,
      data: { questions },
    };
  },
});