"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";

// -----------------------------------------------------------------------------
// Upload Note Attachment
// -----------------------------------------------------------------------------
export const uploadNoteAttachment = action({
  args: {
    file: v.any(), // In practice, this is a File object from the client
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    // args.file is expected to be a Blob/File from the client
    // Convex storage expects a Blob-like object
    const storageId = await ctx.storage.store(args.file);

    return {
      storageId,
      name: args.name,
    };
  },
});