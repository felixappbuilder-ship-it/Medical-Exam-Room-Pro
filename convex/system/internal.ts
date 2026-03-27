import { v } from "convex/values";
import { internalQuery, internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// -----------------------------------------------------------------------------
// Internal: Get expired shared links
// -----------------------------------------------------------------------------
export const getExpiredSharedLinks = internalQuery({
  args: {
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("sharedLinks")
      .withIndex("by_expiresAt", (q: any) => q.lt(q.field("expiresAt"), args.now))
      .collect();
    return links;
  },
});

// -----------------------------------------------------------------------------
// Internal: Delete a shared link
// -----------------------------------------------------------------------------
export const deleteSharedLink = internalMutation({
  args: {
    linkId: v.id("sharedLinks"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.linkId);
  },
});

// -----------------------------------------------------------------------------
// Internal: Clear shared token from a note
// -----------------------------------------------------------------------------
export const clearNoteSharedToken = internalMutation({
  args: {
    noteId: v.id("notes"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.noteId, { sharedToken: undefined, sharedPublic: false });
  },
});