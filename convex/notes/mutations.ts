import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { z } from "zod";
import crypto from "crypto"; // Note: crypto is used for token generation, but that's okay in default runtime? Actually crypto is a Node module, but in default runtime it's not available. However, token generation can use simple random string without crypto. We'll use Math.random().toString(36).substring(2) for tokens. That's safe in default runtime. If we need crypto, we'd need an action. But blueprint doesn't specify Node for token generation. So we'll use simple random.

// Validation schemas
const createNoteSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string(), // HTML content
  plainText: z.string().max(10000), // plain text for search
  subject: z.string().optional(),
  topic: z.string().optional(),
  tags: z.array(z.string()).optional(),
  attachments: z.array(
    z.object({
      type: z.string(),
      storageId: v.id("_storage"),
      name: z.string(),
    })
  ).optional(),
  isProtected: z.boolean().optional(),
  password: z.string().optional(),
});

const updateNoteSchema = z.object({
  noteId: v.id("notes"),
  title: z.string().min(1).max(500).optional(),
  content: z.string().optional(),
  plainText: z.string().max(10000).optional(),
  subject: z.string().optional(),
  topic: z.string().optional(),
  tags: z.array(z.string()).optional(),
  attachments: z.array(
    z.object({
      type: z.string(),
      storageId: v.id("_storage"),
      name: z.string(),
    })
  ).optional(),
  isProtected: z.boolean().optional(),
  password: z.string().optional(),
});

const deleteNoteSchema = z.object({
  noteId: v.id("notes"),
});

const shareNoteSchema = z.object({
  noteId: v.id("notes"),
  expiresInDays: z.number().min(1).max(365).optional(), // optional expiration
});

// -----------------------------------------------------------------------------
// Create Note
// -----------------------------------------------------------------------------
export const createNote = mutation({
  args: {
    title: v.string(),
    content: v.string(),
    plainText: v.string(),
    subject: v.optional(v.string()),
    topic: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    attachments: v.optional(
      v.array(
        v.object({
          type: v.string(),
          storageId: v.id("_storage"),
          name: v.string(),
        })
      )
    ),
    isProtected: v.optional(v.boolean()),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const validated = createNoteSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    // If note is protected, hash the password using auth action
    let passwordHash: string | undefined;
    if (validated.isProtected && validated.password) {
      passwordHash = await ctx.runAction(internal.auth.actions.hashPassword, {
        password: validated.password,
      });
    } else if (validated.isProtected && !validated.password) {
      throw new ConvexError("Password required for protected note");
    }

    const now = Date.now();
    const noteId = await ctx.db.insert("notes", {
      userId,
      title: validated.title,
      content: validated.content,
      plainText: validated.plainText,
      subject: validated.subject,
      topic: validated.topic,
      tags: validated.tags || [],
      attachments: validated.attachments || [],
      flashcards: [], // initially empty
      createdAt: now,
      updatedAt: now,
      reviewCount: 0,
      shareWith: [],
      sharedPublic: false,
      isProtected: validated.isProtected || false,
      passwordHash,
    });

    // Return the created note (fetch it)
    const note = await ctx.db.get(noteId);
    return note;
  },
});

// -----------------------------------------------------------------------------
// Update Note
// -----------------------------------------------------------------------------
export const updateNote = mutation({
  args: {
    noteId: v.id("notes"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    plainText: v.optional(v.string()),
    subject: v.optional(v.string()),
    topic: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    attachments: v.optional(
      v.array(
        v.object({
          type: v.string(),
          storageId: v.id("_storage"),
          name: v.string(),
        })
      )
    ),
    isProtected: v.optional(v.boolean()),
    password: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const validated = updateNoteSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const note = await ctx.db.get(validated.noteId);
    if (!note) throw new ConvexError("Note not found");
    if (note.userId !== userId) throw new ConvexError("Unauthorized");

    // If password protection is being toggled or updated
    let passwordHash = note.passwordHash;
    if (validated.isProtected !== undefined) {
      if (validated.isProtected && validated.password) {
        // Setting/updating password
        passwordHash = await ctx.runAction(internal.auth.actions.hashPassword, {
          password: validated.password,
        });
      } else if (!validated.isProtected) {
        // Removing protection
        passwordHash = undefined;
      }
    }

    const updates: any = {
      updatedAt: Date.now(),
    };
    if (validated.title !== undefined) updates.title = validated.title;
    if (validated.content !== undefined) updates.content = validated.content;
    if (validated.plainText !== undefined) updates.plainText = validated.plainText;
    if (validated.subject !== undefined) updates.subject = validated.subject;
    if (validated.topic !== undefined) updates.topic = validated.topic;
    if (validated.tags !== undefined) updates.tags = validated.tags;
    if (validated.attachments !== undefined) updates.attachments = validated.attachments;
    if (validated.isProtected !== undefined) updates.isProtected = validated.isProtected;
    if (passwordHash !== note.passwordHash) updates.passwordHash = passwordHash;

    await ctx.db.patch(validated.noteId, updates);

    // Return updated note
    const updatedNote = await ctx.db.get(validated.noteId);
    return updatedNote;
  },
});

// -----------------------------------------------------------------------------
// Delete Note
// -----------------------------------------------------------------------------
export const deleteNote = mutation({
  args: {
    noteId: v.id("notes"),
  },
  handler: async (ctx, args) => {
    const validated = deleteNoteSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const note = await ctx.db.get(validated.noteId);
    if (!note) throw new ConvexError("Note not found");
    if (note.userId !== userId) throw new ConvexError("Unauthorized");

    // Delete any associated shared links
    const sharedLinks = await ctx.db
      .query("sharedLinks")
      .withIndex("by_target", (q: any) =>
        q.eq("type", "note").eq("targetId", validated.noteId)
      )
      .collect();
    for (const link of sharedLinks) {
      await ctx.db.delete(link._id);
    }

    // Delete the note
    await ctx.db.delete(validated.noteId);

    return { success: true };
  },
});

// -----------------------------------------------------------------------------
// Share Note (generate public link)
// -----------------------------------------------------------------------------
export const shareNote = mutation({
  args: {
    noteId: v.id("notes"),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const validated = shareNoteSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const note = await ctx.db.get(validated.noteId);
    if (!note) throw new ConvexError("Note not found");
    if (note.userId !== userId) throw new ConvexError("Unauthorized");

    // Generate unique token
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const now = Date.now();
    const expiresInMs = (validated.expiresInDays || 7) * 24 * 60 * 60 * 1000; // default 7 days
    const expiresAt = now + expiresInMs;

    // Create shared link entry
    await ctx.db.insert("sharedLinks", {
      token,
      type: "note",
      targetId: validated.noteId,
      createdAt: now,
      expiresAt,
      createdBy: userId,
    });

    // Update note with sharedToken
    await ctx.db.patch(validated.noteId, { sharedToken: token, sharedPublic: true });

    return {
      shareToken: token,
      url: `/shared/note/${token}`, // frontend route
    };
  },
});