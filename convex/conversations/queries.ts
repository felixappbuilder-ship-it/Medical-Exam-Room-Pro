// convex/conversations/queries.ts
import { query, action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ============================================================
// 1. GET SHARED CONVERSATION (requires password if protected)
// ============================================================
export const getSharedConversation = action({
  args: {
    shareToken: v.string(),
    password: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("messages")),
  },
  handler: async (ctx, args) => {
    try {
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
      let messages = [];
      let nextCursor = null;
      let hasMore = false;

      // Try to get messages from chunks first, else fallback to legacy messages
      const chunks = await ctx.runQuery(internal.conversations.internal.getAllChunks, {
        conversationId: conversation._id,
      });
      if (chunks.length > 0) {
        // Flatten all messages from chunks in order
        const allMessages = chunks
          .sort((a, b) => a.chunkNumber - b.chunkNumber)
          .flatMap(c => c.messages);
        // Paginate
        const start = args.cursor ? allMessages.findIndex(m => m._id === args.cursor) + 1 : 0;
        const paginated = allMessages.slice(start, start + limit);
        hasMore = start + limit < allMessages.length;
        nextCursor = hasMore ? paginated[paginated.length - 1]._id : null;
        messages = paginated;
      } else {
        // Fallback to legacy messages table
        const result = await ctx.runQuery(internal.conversations.internal.getMessages, {
          conversationId: conversation._id,
          limit,
          cursor: args.cursor,
        });
        messages = result.items;
        nextCursor = result.nextCursor;
        hasMore = result.hasMore;
      }

      // Strip user ID from conversation
      const { userId, ...safeConversation } = conversation;
      return {
        success: true,
        data: {
          conversation: safeConversation,
          messages,
          nextCursor,
          hasMore,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "get_shared_conversation_failed",
        message: errorMessage,
      };
    }
  },
});

// ============================================================
// 2. GET CONVERSATION CHUNKS (for internal debugging / frontend)
// ============================================================
export const getConversationChunks = query({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      const userId = result.data.userId;
      const conversation = await ctx.runQuery(internal.conversations.internal.getConversationById, {
        conversationId: args.conversationId,
      });
      if (!conversation || conversation.userId !== userId) {
        return { success: false, error: "unauthorized", message: "Unauthorized" };
      }
      const chunks = await ctx.runQuery(internal.conversations.internal.getAllChunks, {
        conversationId: args.conversationId,
      });
      return {
        success: true,
        data: chunks.sort((a, b) => a.chunkNumber - b.chunkNumber),
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "get_conversation_chunks_failed",
        message: errorMessage,
      };
    }
  },
});

// ============================================================
// 3. GET CONVERSATION SUMMARIES
// ============================================================
export const getConversationSummaries = query({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return { success: false, error: "invalid_token", message: result.message };
      }
      const userId = result.data.userId;
      const conversation = await ctx.runQuery(internal.conversations.internal.getConversationById, {
        conversationId: args.conversationId,
      });
      if (!conversation || conversation.userId !== userId) {
        return { success: false, error: "unauthorized", message: "Unauthorized" };
      }
      const summaries = await ctx.runQuery(internal.conversations.internal.getLatestSummaries, {
        conversationId: args.conversationId,
        limit: 10,
      });
      return {
        success: true,
        data: summaries.sort((a, b) => a.createdAt - b.createdAt),
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: "get_conversation_summaries_failed",
        message: errorMessage,
      };
    }
  },
});