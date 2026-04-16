// convex/users/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getProfile = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    // Verify JWT (R8)
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

    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User account no longer exists.",
      };
    }

    // Return safe profile (exclude passwordHash and securityQuestions)
    const { passwordHash, securityQuestions, ...safeUser } = user;
    return {
      success: true,
      data: { user: safeUser },
    };
  },
});