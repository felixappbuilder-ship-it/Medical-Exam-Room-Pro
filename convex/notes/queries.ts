import { v } from "convex/values";
import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { z } from "zod";

const getNoteSchema = z.object({
  noteId: v.id("notes"),
});

const getUserNotesSchema = z.object({
  subject: v.optional(v.string()),
  topic: v.optional(v.string()),
  tag: v.optional(v.string()),
});

const getNoteByShareTokenSchema = z.object({
  token: v.string(),
});

// -----------------------------------------------------------------------------
// Get Note by ID (authenticated, user must own the note)
// -----------------------------------------------------------------------------
export const getNote = query({
  args: {
    noteId: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const validated = getNoteSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const note = await ctx.db.get(validated.noteId);
    if (!note) return null;

    // User must own the note to view it (unless public sharing, but that's separate endpoint)
    if (note.userId !== userId) throw new ConvexError("Unauthorized");

    return note;
  },
});

// -----------------------------------------------------------------------------
// List User's Notes with optional filters
// -----------------------------------------------------------------------------
export const getUserNotes = query({
  args: {
    subject: v.optional(v.string()),
    topic: v.optional(v.string()),
    tag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const validated = getUserNotesSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    let query = ctx.db
      .query("notes")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .order("desc");

    const notes = await query.collect();

    // Apply optional filters in memory
    let filtered = notes;
    if (validated.subject) {
      filtered = filtered.filter((n) => n.subject === validated.subject);
    }
    if (validated.topic) {
      filtered = filtered.filter((n) => n.topic === validated.topic);
    }
    if (validated.tag) {
      filtered = filtered.filter((n) => n.tags.includes(validated.tag!));
    }

    return filtered;
  },
});

// -----------------------------------------------------------------------------
// Get Note by Share Token (public access)
// -----------------------------------------------------------------------------
export const getNoteByShareToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = getNoteByShareTokenSchema.parse(args);

    // First find the shared link
    const sharedLink = await ctx.db
      .query("sharedLinks")
      .withIndex("by_token", (q: any) => q.eq("token", validated.token))
      .first();

    if (!sharedLink) throw new ConvexError("Invalid or expired share link");

    // Check expiration
    if (sharedLink.expiresAt < Date.now()) {
      throw new ConvexError("Share link has expired");
    }

    // Get the note
    const note = await ctx.db.get(sharedLink.targetId as Id<"notes">);
    if (!note) throw new ConvexError("Note not found");

    // If note is password protected, we cannot return content here;
    // frontend should prompt for password and then fetch content with password.
    // For now, return note without content if protected.
    if (note.isProtected) {
      // Return limited info: title, subject, topic, etc., but not content
      const { content, ...rest } = note;
      return {
        ...rest,
        content: null, // indicate that password is required
        requiresPassword: true,
      };
    }

    return note;
  },
});

// -----------------------------------------------------------------------------
// Export Note as HTML (returns the content as plain HTML string)
// -----------------------------------------------------------------------------
export const exportNoteHTML = query({
  args: {
    noteId: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const validated = getNoteSchema.parse(args); // reuse schema

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const note = await ctx.db.get(validated.noteId);
    if (!note) throw new ConvexError("Note not found");
    if (note.userId !== userId) throw new ConvexError("Unauthorized");

    // Return the HTML content as string
    return note.content;
  },
});