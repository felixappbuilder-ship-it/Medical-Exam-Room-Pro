// convex/resources/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ------------------------------------------------------------------
// Helper: Construct public thumbnail URL from R2 key
// ------------------------------------------------------------------
function getPublicThumbnailUrl(r2ThumbnailKey: string | undefined): string | null {
  if (!r2ThumbnailKey) return null;
  const baseUrl = process.env.R2_PUBLIC_URL;
  if (!baseUrl) {
    console.warn("R2_PUBLIC_URL not set, thumbnails will be unavailable");
    return null;
  }
  return `${baseUrl.replace(/\/$/, '')}/${r2ThumbnailKey}`;
}

// ------------------------------------------------------------------
// 1. Get resources list (public – no auth required)
// Returns thumbnails, metadata, and manifest version for caching
// ------------------------------------------------------------------
export const getResources = query({
  args: {
    subject: v.string(),
    category: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("resources")),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    let query = ctx.db
      .query("resources")
      .withIndex("by_subject_category", (q) =>
        q.eq("subject", args.subject).eq("category", args.category)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc");

    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("_id"), args.cursor));
    }

    const items = await query.take(limit + 1);
    const hasMore = items.length > limit;
    const results = items.slice(0, limit);

    const documents = results.map((r) => ({
      _id: r._id,
      title: r.title,
      thumbnailUrl: getPublicThumbnailUrl(r.r2ThumbnailKey),
      r2ThumbnailKey: r.r2ThumbnailKey,
      fileType: r.fileType,
      fileSize: r.fileSize,
      updatedAt: r.updatedAt,
    }));

    const nextCursor = hasMore ? documents[documents.length - 1]._id : null;

    // Get the latest updatedAt as manifest version (for cache invalidation)
    const latest = await ctx.db
      .query("resources")
      .withIndex("by_subject_category", (q) =>
        q.eq("subject", args.subject).eq("category", args.category)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc")
      .first();

    const manifestVersion = latest?.updatedAt || null;

    return {
      documents,
      cursor: nextCursor,
      hasMore,
      manifestVersion,
    };
  },
});

// ------------------------------------------------------------------
// 2. Get manifest version (lightweight check for updates)
// ------------------------------------------------------------------
export const getManifest = query({
  args: {
    subject: v.string(),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query("resources")
      .withIndex("by_subject_category", (q) =>
        q.eq("subject", args.subject).eq("category", args.category)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc")
      .first();

    return { version: latest?.updatedAt || null };
  },
});

// ------------------------------------------------------------------
// 3. Get single resource metadata (public – no download URL)
// ------------------------------------------------------------------
export const getResource = query({
  args: { resourceId: v.id("resources") },
  handler: async (ctx, args) => {
    const resource = await ctx.runQuery(internal.resources.internal.getResourceById, {
      resourceId: args.resourceId,
    });
    if (!resource || !resource.isActive) return null;

    return {
      _id: resource._id,
      title: resource.title,
      subject: resource.subject,
      category: resource.category,
      fileType: resource.fileType,
      fileSize: resource.fileSize,
      description: resource.description,
      author: resource.author,
      year: resource.year,
      isPremium: resource.isPremium,
      thumbnailUrl: getPublicThumbnailUrl(resource.r2ThumbnailKey),
    };
  },
});

// ------------------------------------------------------------------
// 4. Search resources (public – thumbnails only)
// ------------------------------------------------------------------
export const searchResources = query({
  args: {
    searchTerm: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("resources")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();

    const term = args.searchTerm.toLowerCase();
    const matches = all.filter(
      (r) =>
        r.title.toLowerCase().includes(term) ||
        r.subject.toLowerCase().includes(term) ||
        (r.tags && r.tags.some((t) => t.toLowerCase().includes(term)))
    );

    const limited = matches.slice(0, args.limit || 50);
    return limited.map((r) => ({
      _id: r._id,
      title: r.title,
      subject: r.subject,
      category: r.category,
      thumbnailUrl: getPublicThumbnailUrl(r.r2ThumbnailKey),
      fileType: r.fileType,
      fileSize: r.fileSize,
    }));
  },
});

// ------------------------------------------------------------------
// 5. Get available filters (institutions/authors and years)
// ------------------------------------------------------------------
export const getFilters = query({
  args: {
    subject: v.string(),
    category: v.string(),
  },
  handler: async (ctx, args) => {
    const resources = await ctx.db
      .query("resources")
      .withIndex("by_subject_category", (q) =>
        q.eq("subject", args.subject).eq("category", args.category)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    const institutions = new Set<string>();
    const years = new Set<number>();
    for (const r of resources) {
      if (r.author) institutions.add(r.author);
      if (r.year) years.add(r.year);
    }

    return {
      institutions: Array.from(institutions).sort(),
      years: Array.from(years).sort((a, b) => b - a),
    };
  },
});

// ================================================================
// Queries used by the sync script – return full documents
// ================================================================

export const getResourceByHash = query({
  args: { fileHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("resources")
      .withIndex("by_fileHash", (q) => q.eq("fileHash", args.fileHash))
      .first();
  },
});

export const getResourceByOriginalPath = query({
  args: { originalPath: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("resources")
      .filter((q) => q.eq(q.field("originalPath"), args.originalPath))
      .first();
  },
});

export const getAllActiveResources = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("resources")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
  },
});