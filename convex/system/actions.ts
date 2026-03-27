"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

// -----------------------------------------------------------------------------
// Cleanup Expired Shared Links (cron job)
// -----------------------------------------------------------------------------
export const cleanupExpiredShares = action({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find all expired shared links
    const expiredLinks = await ctx.runQuery(internal.system.getExpiredSharedLinks, {
      now,
    });

    let deletedCount = 0;
    for (const link of expiredLinks) {
      // Delete the link
      await ctx.runMutation(internal.system.deleteSharedLink, {
        linkId: link._id,
      });

      // Optionally, also remove sharedToken from the associated note/conversation/exam
      if (link.type === "note") {
        await ctx.runMutation(internal.system.clearNoteSharedToken, {
          noteId: link.targetId,
        });
      } else if (link.type === "conversation") {
        // Clear shared token from conversation if needed
        // (We might not have a sharedToken field on conversations, but blueprint doesn't specify)
        // For now, we'll skip.
      }

      deletedCount++;
    }

    return { deletedCount };
  },
});