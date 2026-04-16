// convex/conversations/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const saveConversation = mutation({
  args: {
    token: v.string(),
    conversationId: v.optional(v.id("conversations")),
    title: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      })
    ),
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
    const now = Date.now();
    let conversationId = args.conversationId;
    if (!conversationId) {
      // Create new conversation
      conversationId = await ctx.runMutation(internal.conversations.internal.createConversation, {
        userId,
        title: args.title,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      // Verify ownership
      const existing = await ctx.runQuery(internal.conversations.internal.getConversationById, {
        conversationId,
      });
      if (!existing || existing.userId !== userId) {
        return { success: false, error: "unauthorized", message: "Conversation not found or access denied" };
      }
      await ctx.runMutation(internal.conversations.internal.updateConversation, {
        conversationId,
        title: args.title,
        updatedAt: now,
      });
    }
    // Save messages (normalized)
    for (const msg of args.messages) {
      await ctx.runMutation(internal.conversations.internal.addMessage, {
        conversationId: conversationId!,
        role: msg.role,
        content: msg.content,
        timestamp: now,
      });
    }
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "save_conversation",
      targetId: conversationId,
      details: { messageCount: args.messages.length },
    });
    return { success: true, data: { conversationId } };
  },
});

export const deleteConversation = mutation({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
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
    await ctx.runMutation(internal.conversations.internal.deleteConversation, {
      conversationId: args.conversationId,
    });
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "delete_conversation",
      targetId: args.conversationId,
      details: {},
    });
    return { success: true, data: { message: "Conversation deleted" } };
  },
});

export const shareConversation = mutation({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    expiryHours: v.optional(v.number()),
    password: v.optional(v.string()),
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
      return { success: false, error: "unauthorized", message: "Cannot share this conversation" };
    }
    const expiryHours = args.expiryHours || 168;
    const expiry = Date.now() + expiryHours * 60 * 60 * 1000;
    const shareToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    let passwordHash: string | undefined = undefined;
    if (args.password) {
      passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, { password: args.password });
    }
    const linkId = await ctx.runMutation(internal.conversations.internal.createSharedLink, {
      targetType: "conversation",
      targetId: args.conversationId,
      token: shareToken,
      expiry,
      passwordHash,
    });
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "share_conversation",
      targetId: args.conversationId,
      details: { shareToken, expiryHours, hasPassword: !!args.password },
    });
    return {
      success: true,
      data: { shareToken, shareUrl: `/shared/conversation/${shareToken}`, expiry },
    };
  },
});