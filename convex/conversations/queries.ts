// convex/conversations/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getConversations = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("conversations")),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch {
      return { success: false, error: "token_verification_failed", message: "Authentication failed" };
    }
    const userId = payload.userId;
    const limit = args.limit || 20;
    const { items, nextCursor, hasMore } = await ctx.runQuery(
      internal.conversations.internal.getUserConversations,
      { userId, limit, cursor: args.cursor }
    );
    return {
      success: true,
      data: { conversations: items, nextCursor, hasMore },
    };
  },
});

export const getConversation = query({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      payload = result.data;
    } catch {
      return { success: false, error: "token_verification_failed", message: "Authentication failed" };
    }
    const userId = payload.userId;
    const conversation = await ctx.runQuery(internal.conversations.internal.getConversationById, {
      conversationId: args.conversationId,
    });
    if (!conversation || conversation.userId !== userId) {
      return { success: false, error: "unauthorized", message: "Conversation not found" };
    }
    const limit = args.limit || 50;
    const { items: messages, nextCursor, hasMore } = await ctx.runQuery(
      internal.conversations.internal.getMessages,
      { conversationId: args.conversationId, limit, cursor: args.cursor }
    );
    return {
      success: true,
      data: { conversation: { title: conversation.title, createdAt: conversation.createdAt }, messages, nextCursor, hasMore },
    };
  },
});

export const getSharedConversation = query({
  args: {
    shareToken: v.string(),
    password: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    const link = await ctx.runQuery(internal.conversations.internal.getSharedLinkByToken, {
      token: args.shareToken,
    });
    if (!link) {
      return { success: false, error: "not_found", message: "Shared link not found or expired." };
    }
    if (link.expiry < Date.now()) {
      await ctx.runMutation(internal.conversations.internal.deleteSharedLink, { linkId: link._id });
      return { success: false, error: "expired", message: "This shared link has expired." };
    }
    if (link.passwordHash) {
      if (!args.password) {
        return { success: false, error: "password_required", message: "Password required." };
      }
      const isValid = await ctx.runAction(internal.auth.helpers.comparePassword, {
        password: args.password,
        hash: link.passwordHash,
      });
      if (!isValid) {
        return { success: false, error: "invalid_password", message: "Incorrect password." };
      }
    }
    const conversation = await ctx.runQuery(internal.conversations.internal.getConversationById, {
      conversationId: link.targetId as any,
    });
    if (!conversation) {
      return { success: false, error: "not_found", message: "Conversation no longer exists." };
    }
    const limit = args.limit || 50;
    const { items: messages, nextCursor, hasMore } = await ctx.runQuery(
      internal.conversations.internal.getMessages,
      { conversationId: conversation._id, limit, cursor: args.cursor }
    );
    // Strip user ID
    const { userId, ...safeConversation } = conversation;
    return {
      success: true,
      data: { conversation: safeConversation, messages, nextCursor, hasMore },
    };
  },
});