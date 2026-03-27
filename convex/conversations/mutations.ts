import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { z } from "zod";

const saveConversationSchema = z.object({
  id: v.optional(v.id("conversations")), // if provided, update existing
  title: v.string(),
  messages: v.array(
    v.object({
      role: v.union(v.literal("user"), v.literal("ai")),
      content: v.string(),
      timestamp: v.number(),
      references: v.optional(
        v.array(
          v.object({
            book: v.string(),
            page: v.optional(v.number()),
          })
        )
      ),
      rating: v.optional(v.string()), // could be "good", "bad", or empty
    })
  ),
});

const deleteConversationSchema = z.object({
  convId: v.id("conversations"),
});

const shareConversationSchema = z.object({
  convId: v.id("conversations"),
  expiresInDays: v.optional(v.number()),
});

// -----------------------------------------------------------------------------
// Save or update a conversation (upsert)
// -----------------------------------------------------------------------------
export const saveConversation = mutation({
  args: {
    id: v.optional(v.id("conversations")),
    title: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("ai")),
        content: v.string(),
        timestamp: v.number(),
        references: v.optional(
          v.array(
            v.object({
              book: v.string(),
              page: v.optional(v.number()),
            })
          )
        ),
        rating: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const validated = saveConversationSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const now = Date.now();

    if (validated.id) {
      // Update existing conversation
      const existing = await ctx.db.get(validated.id);
      if (!existing) throw new ConvexError("Conversation not found");
      if (existing.userId !== userId) throw new ConvexError("Unauthorized");

      await ctx.db.patch(validated.id, {
        title: validated.title,
        messages: validated.messages,
        updatedAt: now,
      });

      return { id: validated.id };
    } else {
      // Create new conversation
      const convId = await ctx.db.insert("conversations", {
        userId,
        title: validated.title,
        messages: validated.messages,
        createdAt: now,
        updatedAt: now,
      });
      return { id: convId };
    }
  },
});

// -----------------------------------------------------------------------------
// Delete a conversation
// -----------------------------------------------------------------------------
export const deleteConversation = mutation({
  args: {
    convId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const validated = deleteConversationSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const conversation = await ctx.db.get(validated.convId);
    if (!conversation) throw new ConvexError("Conversation not found");
    if (conversation.userId !== userId) throw new ConvexError("Unauthorized");

    // Delete any associated shared links
    const sharedLinks = await ctx.db
      .query("sharedLinks")
      .withIndex("by_target", (q: any) =>
        q.eq("type", "conversation").eq("targetId", validated.convId)
      )
      .collect();
    for (const link of sharedLinks) {
      await ctx.db.delete(link._id);
    }

    await ctx.db.delete(validated.convId);

    return { success: true };
  },
});

// -----------------------------------------------------------------------------
// Share a conversation (generate public link)
// -----------------------------------------------------------------------------
export const shareConversation = mutation({
  args: {
    convId: v.id("conversations"),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const validated = shareConversationSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const conversation = await ctx.db.get(validated.convId);
    if (!conversation) throw new ConvexError("Conversation not found");
    if (conversation.userId !== userId) throw new ConvexError("Unauthorized");

    // Generate unique token
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const now = Date.now();
    const expiresInMs = (validated.expiresInDays || 7) * 24 * 60 * 60 * 1000; // default 7 days
    const expiresAt = now + expiresInMs;

    // Create shared link entry
    await ctx.db.insert("sharedLinks", {
      token,
      type: "conversation",
      targetId: validated.convId,
      createdAt: now,
      expiresAt,
      createdBy: userId,
    });

    return {
      shareToken: token,
      url: `/shared/conversation/${token}`, // frontend route
    };
  },
});