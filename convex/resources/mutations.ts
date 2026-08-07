// convex/resources/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ============================================================
// NOTE: generateUploadUrl is REMOVED – we now use R2 directly.
// Files are uploaded via the sync script using AWS SDK.
// Convex only stores R2 object keys (r2Key, r2ThumbnailKey).
// ============================================================

export const createResource = mutation({
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
    tags: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    isPremium: v.optional(v.boolean()),
    author: v.optional(v.string()),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const resourceId = await ctx.runMutation(internal.resources.internal.insertResource, {
      ...args,
      version: 1,
      isActive: true,
    });
    return { success: true, resourceId };
  },
});

export const updateResource = mutation({
  args: {
    resourceId: v.id("resources"),
    title: v.optional(v.string()),
    subject: v.optional(v.string()),
    category: v.optional(v.string()),
    r2Key: v.optional(v.string()),
    r2ThumbnailKey: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    fileHash: v.optional(v.string()),
    originalPath: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    isPremium: v.optional(v.boolean()),
    author: v.optional(v.string()),
    year: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.runQuery(internal.resources.internal.getResourceById, {
      resourceId: args.resourceId,
    });
    if (!existing) throw new Error("Resource not found");
    const newVersion = existing.version + 1;
    const updates: any = { ...args, version: newVersion };
    delete updates.resourceId;
    await ctx.runMutation(internal.resources.internal.updateResourceInternal, {
      resourceId: args.resourceId,
      updates,
    });
    return { success: true, newVersion };
  },
});

export const disableResource = mutation({
  args: { resourceId: v.id("resources") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.resources.internal.setResourceActive, {
      resourceId: args.resourceId,
      isActive: false,
    });
    return { success: true };
  },
});

// ============================================================
// DELETION MUTATIONS (R2 files are NOT deleted here)
// The sync script should handle R2 deletion separately.
// These mutations only remove the database records.
// ============================================================

export const deleteResource = mutation({
  args: { resourceId: v.id("resources") },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) throw new Error("Resource not found");
    // ⚠️ R2 files are NOT deleted here – delete them separately via the sync script.
    await ctx.db.delete(args.resourceId);
    return { success: true };
  },
});

export const deleteAllResources = mutation({
  args: {},
  handler: async (ctx) => {
    const resources = await ctx.db
      .query("resources")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();

    let deletedCount = 0;
    for (const resource of resources) {
      // ⚠️ R2 files are NOT deleted here – delete them separately via the sync script.
      await ctx.db.delete(resource._id);
      deletedCount++;
    }
    return { deleted: deletedCount };
  },
});