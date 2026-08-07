import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const upsertPublicAsset = mutation({
  args: {
    key: v.string(),
    r2Key: v.string(),
    fileHash: v.string(),
    fileSize: v.number(),
    fileType: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get current version
    const existing = await ctx.db
      .query("publicAssets")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    const nextVersion = existing ? existing.version + 1 : 1;
    const id = await ctx.runMutation(internal.publicAssets.internal.upsertAsset, {
      key: args.key,
      r2Key: args.r2Key,
      version: nextVersion,
      fileHash: args.fileHash,
      fileSize: args.fileSize,
      fileType: args.fileType,
      description: args.description,
    });
    return { id, version: nextVersion };
  },
});