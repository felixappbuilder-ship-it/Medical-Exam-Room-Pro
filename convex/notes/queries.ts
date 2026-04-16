// convex/notes/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getNote = query({
  args: {
    token: v.string(),
    noteId: v.id("notes"),
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
    const note = await ctx.runQuery(internal.notes.internal.getNoteById, { noteId: args.noteId });
    if (!note || note.userId !== userId) {
      return {
        success: false,
        error: "unauthorized",
        message: "Note not found or you do not own it.",
      };
    }

    // Remove password hash from response
    const { passwordHash, ...safeNote } = note;
    return {
      success: true,
      data: { note: safeNote },
    };
  },
});

export const getUserNotes = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("notes")),
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
    const limit = args.limit || 20;
    const { items, nextCursor, hasMore } = await ctx.runQuery(
      internal.notes.internal.getUserNotes,
      {
        userId,
        limit,
        cursor: args.cursor,
      }
    );

    // Strip passwordHash from each note
    const safeNotes = items.map((note) => {
      const { passwordHash, ...rest } = note;
      return rest;
    });

    return {
      success: true,
      data: {
        notes: safeNotes,
        nextCursor,
        hasMore,
      },
    };
  },
});

export const getNoteByShareToken = query({
  args: {
    shareToken: v.string(),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.runQuery(internal.notes.internal.getSharedLinkByToken, {
      token: args.shareToken,
    });
    if (!link) {
      return {
        success: false,
        error: "not_found",
        message: "Shared link not found or expired.",
      };
    }
    if (link.expiry < Date.now()) {
      await ctx.runMutation(internal.notes.internal.deleteSharedLink, { linkId: link._id });
      return {
        success: false,
        error: "expired",
        message: "This shared link has expired.",
      };
    }
    if (link.passwordHash) {
      if (!args.password) {
        return {
          success: false,
          error: "password_required",
          message: "This shared note is password protected.",
        };
      }
      const isValid = await ctx.runAction(internal.auth.helpers.comparePassword, {
        password: args.password,
        hash: link.passwordHash,
      });
      if (!isValid) {
        return {
          success: false,
          error: "invalid_password",
          message: "Incorrect password.",
        };
      }
    }

    const note = await ctx.runQuery(internal.notes.internal.getNoteById, {
      noteId: link.targetId as any,
    });
    if (!note) {
      return {
        success: false,
        error: "not_found",
        message: "The note no longer exists.",
      };
    }

    // Return note without user ID or password hash
    const { userId, passwordHash, ...safeNote } = note;
    return {
      success: true,
      data: { note: safeNote },
    };
  },
});