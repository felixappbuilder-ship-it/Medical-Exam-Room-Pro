// convex/notes/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getNoteByShareToken = query({
  args: { shareToken: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.runQuery(internal.notes.internal.getSharedLinkByToken, { token: args.shareToken });
    if (!link || link.targetType !== "note" || link.expiry < Date.now()) {
      return { success: false, message: "Invalid or expired share link" };
    }
    const note = await ctx.runQuery(internal.notes.internal.getNoteById, { noteId: link.targetId as any });
    if (!note) return { success: false, message: "Note not found" };
    const { userId, passwordHash, ...safeNote } = note;
    return { success: true, data: safeNote };
  },
});