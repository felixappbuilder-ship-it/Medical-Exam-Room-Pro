// convex/notes/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

export const uploadNoteAttachment = action({
  args: {
    file: v.bytes(),
    name: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify token
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        throw new ConvexError("Invalid token");
      }
      payload = result.data;
    } catch (err) {
      throw new ConvexError("Authentication failed");
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user || user.isLocked) {
      throw new ConvexError("Account locked or not found");
    }

    // Optional: enforce file size limit (e.g., 5MB = 5 * 1024 * 1024)
    if (args.file.length > 5 * 1024 * 1024) {
      throw new ConvexError("File too large. Max 5MB.");
    }

    const storageId = await ctx.storage.store(args.file);
    // Audit log
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: userId,
      action: "upload_note_attachment",
      targetId: userId,
      details: { fileName: args.name, storageId },
    });
    return { success: true, data: { storageId, name: args.name } };
  },
});