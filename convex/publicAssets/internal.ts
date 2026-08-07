import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getAssetByKey = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("publicAssets")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
  },
});

export const upsertAsset = internalMutation({
  args: {
    key: v.string(),
    r2Key: v.string(),
    version: v.number(),
    fileHash: v.string(),
    fileSize: v.number(),
    fileType: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("publicAssets")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        r2Key: args.r2Key,
        version: args.version,
        fileHash: args.fileHash,
        fileSize: args.fileSize,
        fileType: args.fileType,
        updatedAt: now,
        isActive: true,
        description: args.description,
      });
      return existing._id;
    } else {
      const id = await ctx.db.insert("publicAssets", {
        key: args.key,
        r2Key: args.r2Key,
        version: args.version,
        fileHash: args.fileHash,
        fileSize: args.fileSize,
        fileType: args.fileType,
        uploadedAt: now,
        updatedAt: now,
        isActive: true,
        description: args.description,
      });
      return id;
    }
  },
});