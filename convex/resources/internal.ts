// convex/resources/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getResourceById = internalQuery({
  args: { resourceId: v.id("resources") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.resourceId);
  },
});

export const insertResource = internalMutation({
  args: {
    title: v.string(),
    subject: v.string(),
    category: v.string(),
    r2Key: v.string(),                     // R2 object key for original file
    r2ThumbnailKey: v.optional(v.string()), // R2 object key for thumbnail
    fileType: v.string(),
    fileSize: v.number(),
    fileHash: v.string(),
    originalPath: v.string(),
    version: v.number(),
    isActive: v.boolean(),
    tags: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    isPremium: v.optional(v.boolean()),
    author: v.optional(v.string()),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("resources", {
      ...args,
      uploadedAt: now,
      updatedAt: now,
      downloadCount: 0,
      viewCount: 0,
    });
    return id;
  },
});

export const updateResourceInternal = internalMutation({
  args: {
    resourceId: v.id("resources"),
    updates: v.object({
      title: v.optional(v.string()),
      subject: v.optional(v.string()),
      category: v.optional(v.string()),
      r2Key: v.optional(v.string()),
      r2ThumbnailKey: v.optional(v.string()),
      fileType: v.optional(v.string()),
      fileSize: v.optional(v.number()),
      fileHash: v.optional(v.string()),
      originalPath: v.optional(v.string()),
      version: v.optional(v.number()),
      isActive: v.optional(v.boolean()),
      tags: v.optional(v.array(v.string())),
      description: v.optional(v.string()),
      isPremium: v.optional(v.boolean()),
      author: v.optional(v.string()),
      year: v.optional(v.number()),
      downloadCount: v.optional(v.number()),
      viewCount: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const patch: any = { ...args.updates, updatedAt: Date.now() };
    await ctx.db.patch(args.resourceId, patch);
  },
});

export const setResourceActive = internalMutation({
  args: { resourceId: v.id("resources"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.resourceId, { isActive: args.isActive, updatedAt: Date.now() });
  },
});