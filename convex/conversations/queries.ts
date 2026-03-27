import { v } from "convex/values";
import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { z } from "zod";

const getConversationsSchema = z.object({
  limit: v.optional(v.number()),
});

const getConversationSchema = z.object({
  convId: v.id("conversations"),
});

const getSharedConversationSchema = z.object({
  token: v.string(),
});

// -----------------------------------------------------------------------------
// List user's conversations (most recent first)
// -----------------------------------------------------------------------------
export const getConversations = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const validated = getConversationsSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const limit = validated.limit ?? 50;

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    return conversations;
  },
});

// -----------------------------------------------------------------------------
// Get a specific conversation by ID
// -----------------------------------------------------------------------------
export const getConversation = query({
  args: {
    convId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const validated = getConversationSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const conversation = await ctx.db.get(validated.convId);
    if (!conversation) throw new ConvexError("Conversation not found");
    if (conversation.userId !== userId) throw new ConvexError("Unauthorized");

    return conversation;
  },
});

// -----------------------------------------------------------------------------
// Get shared conversation by token (public)
// -----------------------------------------------------------------------------
export const getSharedConversation = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = getSharedConversationSchema.parse(args);

    // Find the shared link
    const sharedLink = await ctx.db
      .query("sharedLinks")
      .withIndex("by_token", (q: any) => q.eq("token", validated.token))
      .first();

    if (!sharedLink) throw new ConvexError("Invalid share link");
    if (sharedLink.type !== "conversation") throw new ConvexError("Invalid share link type");

    // Check expiration
    if (sharedLink.expiresAt < Date.now()) {
      throw new ConvexError("Share link has expired");
    }

    // Get the conversation
    const conversation = await ctx.db.get(sharedLink.targetId as Id<"conversations">);
    if (!conversation) throw new ConvexError("Conversation not found");

    return conversation;
  },
});