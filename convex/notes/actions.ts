// convex/notes/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import crypto from "crypto";

async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error(result.message);
  const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId: result.data.userId });
  if (!user) throw new Error("User not found");
  return user;
}

// ==================== GET NOTES ====================
export const getUserNotes = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("notes")),
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const limit = args.limit || 50;
    const result = await ctx.runQuery(internal.notes.internal.getUserNotesInternal, {
      userId: user._id,
      limit,
      cursor: args.cursor,
    });
    const filtered = args.since
      ? result.notes.filter((n: any) => (n.updatedAt || n.createdAt) > args.since)
      : result.notes;
    const safeNotes = filtered.map((n: any) => {
      const { passwordHash, ...rest } = n;
      return rest;
    });
    return {
      success: true,
      data: {
        notes: safeNotes,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      },
    };
  },
});

export const getNote = action({
  args: { token: v.string(), noteId: v.string() },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const note = await ctx.runQuery(internal.notes.internal.resolveNote, {
      noteId: args.noteId,
      userId: user._id,
    });
    if (!note) throw new Error("Note not found or you don't own it");
    const { passwordHash, ...safeNote } = note;
    return { success: true, data: safeNote };
  },
});

export const getSharedNotes = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("sharedLinks")),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const limit = args.limit || 20;
    const result = await ctx.runQuery(internal.notes.internal.getSharedLinksByUserAndType, {
      userId: user._id,
      targetType: "note",
      limit,
      cursor: args.cursor,
    });
    const notes = await Promise.all(
      result.links.map(async (link: any) => {
        const note = await ctx.runQuery(internal.notes.internal.getNoteById, { noteId: link.targetId as any });
        if (note) {
          return {
            _id: note._id,
            title: note.title,
            owner: user.name || user.email,
            createdAt: note.createdAt,
            shareToken: link.token,
          };
        }
        return null;
      })
    );
    const filtered = notes.filter(Boolean);
    return {
      success: true,
      data: {
        notes: filtered,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      },
    };
  },
});

// ==================== CREATE NOTE ====================
export const createNote = action({
  args: {
    token: v.string(),
    title: v.string(),
    content: v.string(),
    plainText: v.string(),
    isProtected: v.boolean(),
    password: v.optional(v.string()),
    subject: v.optional(v.union(v.string(), v.null())),
    topic: v.optional(v.union(v.string(), v.null())),
    questionId: v.optional(v.union(v.string(), v.null())),
    tags: v.optional(v.array(v.string())),
    attachments: v.optional(v.array(v.object({ type: v.string(), url: v.string(), name: v.string() }))),
    flashcards: v.optional(v.array(v.object({ front: v.string(), back: v.string() }))),
    shareWith: v.optional(v.array(v.id("users"))),
    sharedPublic: v.optional(v.boolean()),
    sharedToken: v.optional(v.union(v.string(), v.null())),
    lastReviewed: v.optional(v.number()),
    reviewCount: v.optional(v.number()),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    let passwordHash: string | undefined;
    if (args.isProtected && args.password) {
      passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, { password: args.password });
    }
    const noteId = await ctx.runMutation(internal.notes.internal.insertNote, {
      userId: user._id,
      title: args.title,
      content: args.content,
      plainText: args.plainText,
      isProtected: args.isProtected,
      passwordHash,
      subject: args.subject === null ? undefined : args.subject,
      topic: args.topic === null ? undefined : args.topic,
      questionId: args.questionId === null ? undefined : args.questionId,
      tags: args.tags || [],
      attachments: args.attachments || [],
      flashcards: args.flashcards || [],
      shareWith: args.shareWith || [],
      sharedPublic: args.sharedPublic || false,
      sharedToken: args.sharedToken === null ? undefined : args.sharedToken,
      lastReviewed: args.lastReviewed,
      reviewCount: args.reviewCount || 0,
      clientId: args.clientId,
    });
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "create_note",
      targetId: noteId,
      details: { title: args.title },
    });
    return { success: true, data: { noteId } };
  },
});

// ==================== UPDATE NOTE ====================
export const updateNote = action({
  args: {
    token: v.string(),
    noteId: v.string(),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    plainText: v.optional(v.string()),
    isProtected: v.optional(v.boolean()),
    password: v.optional(v.string()),
    subject: v.optional(v.union(v.string(), v.null())),
    topic: v.optional(v.union(v.string(), v.null())),
    questionId: v.optional(v.union(v.string(), v.null())),
    tags: v.optional(v.array(v.string())),
    attachments: v.optional(v.array(v.object({ type: v.string(), url: v.string(), name: v.string() }))),
    flashcards: v.optional(v.array(v.object({ front: v.string(), back: v.string() }))),
    shareWith: v.optional(v.array(v.id("users"))),
    sharedPublic: v.optional(v.boolean()),
    sharedToken: v.optional(v.union(v.string(), v.null())),
    lastReviewed: v.optional(v.number()),
    reviewCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const note = await ctx.runQuery(internal.notes.internal.resolveNote, {
      noteId: args.noteId,
      userId: user._id,
    });
    if (!note) {
      return { success: false, error: "unauthorized", message: "Note not found or you don't own it" };
    }
    const updates: any = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) updates.content = args.content;
    if (args.plainText !== undefined) updates.plainText = args.plainText;
    if (args.isProtected !== undefined) updates.isProtected = args.isProtected;
    if (args.isProtected && args.password) {
      updates.passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, { password: args.password });
    } else if (args.isProtected === false) {
      updates.passwordHash = undefined;
    }
    if (args.subject !== undefined) updates.subject = args.subject === null ? undefined : args.subject;
    if (args.topic !== undefined) updates.topic = args.topic === null ? undefined : args.topic;
    if (args.questionId !== undefined) updates.questionId = args.questionId === null ? undefined : args.questionId;
    if (args.sharedToken !== undefined) updates.sharedToken = args.sharedToken === null ? undefined : args.sharedToken;
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.attachments !== undefined) updates.attachments = args.attachments;
    if (args.flashcards !== undefined) updates.flashcards = args.flashcards;
    if (args.shareWith !== undefined) updates.shareWith = args.shareWith;
    if (args.sharedPublic !== undefined) updates.sharedPublic = args.sharedPublic;
    if (args.lastReviewed !== undefined) updates.lastReviewed = args.lastReviewed;
    if (args.reviewCount !== undefined) updates.reviewCount = args.reviewCount;
    await ctx.runMutation(internal.notes.internal.updateNoteInternal, { noteId: note._id, updates });
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "update_note",
      targetId: note._id,
      details: { updatedFields: Object.keys(updates) },
    });
    return { success: true };
  },
});

// ==================== DELETE NOTE ====================
export const deleteNote = action({
  args: { token: v.string(), noteId: v.string() },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const note = await ctx.runQuery(internal.notes.internal.resolveNote, {
      noteId: args.noteId,
      userId: user._id,
    });
    if (!note) {
      return { success: false, error: "unauthorized", message: "Note not found or you don't own it" };
    }
    await ctx.runMutation(internal.notes.internal.deleteNoteInternal, { noteId: note._id });
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: user._id,
      action: "delete_note",
      targetId: note._id,
      details: { title: note.title },
    });
    return { success: true };
  },
});

// ==================== SHARE NOTE ====================
export const shareNote = action({
  args: {
    token: v.string(),
    noteId: v.string(),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      console.log("[shareNote] Starting for noteId:", args.noteId);
      const user = await verifyTokenAndGetUser(ctx, args.token);
      console.log("[shareNote] User verified:", user._id);

      const note = await ctx.runQuery(internal.notes.internal.resolveNote, {
        noteId: args.noteId,
        userId: user._id,
      });
      if (!note) {
        console.error("[shareNote] Note not found:", args.noteId);
        return { success: false, error: "not_found", message: "Note not found" };
      }
      if (note.userId !== user._id) {
        console.error("[shareNote] Unauthorized user:", user._id, "note owner:", note.userId);
        return { success: false, error: "unauthorized", message: "You don't own this note" };
      }

      const existingLink = await ctx.runQuery(
        internal.notes.internal.getExistingSharedLink,
        { noteId: note._id }
      );

      let shareToken: string;
      if (existingLink) {
        shareToken = existingLink.token;
      } else {
        shareToken = crypto.randomUUID();
        const expiry = Date.now() + 48 * 60 * 60 * 1000;
        let passwordHash: string | undefined;
        if (args.password) {
          passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, { password: args.password });
        }
        await ctx.runMutation(internal.notes.internal.createSharedLink, {
          userId: user._id,
          targetType: "note",
          targetId: note._id,
          token: shareToken,
          expiry,
          passwordHash,
        });
      }

      if (!note.sharedToken || note.sharedToken !== shareToken) {
        await ctx.runMutation(internal.notes.internal.markNoteShared, {
          noteId: note._id,
          sharedToken: shareToken,
        });
      }

      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: user._id,
        action: "share_note",
        targetId: note._id,
        details: { shareToken },
      });

      const baseUrl = process.env.PUBLIC_URL || "https://medhub.edgeone.app";
      const shareUrl = `${baseUrl}/pages/shared-note.html?token=${shareToken}`;

      console.log("[shareNote] Success, shareUrl:", shareUrl);
      return { success: true, data: { shareToken, shareUrl } };
    } catch (err) {
      console.error("[shareNote] Error:", err);
      return { success: false, error: "server_error", message: err.message || "Internal error" };
    }
  },
});