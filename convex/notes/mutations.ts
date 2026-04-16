// convex/notes/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const createNote = mutation({
  args: {
    token: v.string(),
    title: v.string(),
    content: v.string(),
    plainText: v.string(),
    isProtected: v.boolean(),
    password: v.optional(v.string()),
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

    let passwordHash: string | undefined = undefined;
    if (args.isProtected && args.password) {
      passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, {
        password: args.password,
      });
    }

    const now = Date.now();
    const noteId = await ctx.runMutation(internal.notes.internal.createNoteInternal, {
      userId,
      title: args.title,
      content: args.content,
      plainText: args.plainText,
      isProtected: args.isProtected,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "create_note",
      targetId: noteId,
      details: { title: args.title, isProtected: args.isProtected },
    });

    return {
      success: true,
      data: { noteId, title: args.title, createdAt: now },
    };
  },
});

export const updateNote = mutation({
  args: {
    token: v.string(),
    noteId: v.id("notes"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    plainText: v.optional(v.string()),
    isProtected: v.optional(v.boolean()),
    password: v.optional(v.string()),
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

    const updates: any = { updatedAt: Date.now() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) updates.content = args.content;
    if (args.plainText !== undefined) updates.plainText = args.plainText;
    if (args.isProtected !== undefined) updates.isProtected = args.isProtected;
    if (args.isProtected && args.password) {
      updates.passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, {
        password: args.password,
      });
    } else if (args.isProtected === false) {
      updates.passwordHash = undefined;
    }

    await ctx.runMutation(internal.notes.internal.updateNoteInternal, {
      noteId: args.noteId,
      updates,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "update_note",
      targetId: args.noteId,
      details: { updatedFields: Object.keys(updates) },
    });

    return {
      success: true,
      data: { message: "Note updated." },
    };
  },
});

export const deleteNote = mutation({
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

    await ctx.runMutation(internal.notes.internal.deleteNoteInternal, { noteId: args.noteId });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "delete_note",
      targetId: args.noteId,
      details: { title: note.title },
    });

    return {
      success: true,
      data: { message: "Note deleted." },
    };
  },
});

export const shareNote = mutation({
  args: {
    token: v.string(),
    noteId: v.id("notes"),
    expiryHours: v.optional(v.number()),
    password: v.optional(v.string()),
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

    const expiryHours = args.expiryHours || 168;
    const expiry = Date.now() + expiryHours * 60 * 60 * 1000;
    const shareToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    let passwordHash: string | undefined = undefined;
    if (args.password) {
      passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, {
        password: args.password,
      });
    }

    const linkId = await ctx.runMutation(internal.notes.internal.createSharedLinkForNote, {
      targetType: "note",
      targetId: args.noteId,
      token: shareToken,
      expiry,
      passwordHash,
    });

    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "share_note",
      targetId: args.noteId,
      details: { shareToken, expiryHours, hasPassword: !!args.password },
    });

    return {
      success: true,
      data: {
        shareToken,
        shareUrl: `/shared/note/${shareToken}`,
        expiry,
      },
    };
  },
});