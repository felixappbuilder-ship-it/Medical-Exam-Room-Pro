// convex/users/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const updateProfile = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify JWT
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

    if (user.isLocked) {
      return {
        success: false,
        error: "account_locked",
        message: `Account is locked. Reason: ${user.lockReason || "suspicious activity"}.`,
      };
    }

    // Prepare updates
    const updates: any = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.phone !== undefined) updates.phone = args.phone;

    if (Object.keys(updates).length === 0) {
      return {
        success: false,
        error: "no_updates",
        message: "No valid fields to update.",
      };
    }

    // Update user
    await ctx.runMutation(internal.users.internal.updateUserById, {
      userId,
      updates,
    });

    // Audit log (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "update_profile",
      targetId: userId,
      details: updates,
    });

    // Return updated safe profile
    const updatedUser = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    const { passwordHash, securityQuestions, ...safeUser } = updatedUser!;
    return {
      success: true,
      data: { user: safeUser },
    };
  },
});

export const deleteAccount = mutation({
  args: { token: v.string() },
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
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User account no longer exists.",
      };
    }

    // Audit log before deletion
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "delete_account",
      targetId: userId,
      details: { email: user.email, phone: user.phone },
    });

    // Delete user
    await ctx.runMutation(internal.users.internal.deleteUserById, { userId });

    // Also delete related data? (optional, but blueprint doesn't specify cascade – we'll keep simple)
    return {
      success: true,
      data: { message: "Account permanently deleted." },
    };
  },
});