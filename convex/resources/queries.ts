// convex/resources/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ============================================================
// Shared shape — the SINGLE source of truth for what a public
// resource document looks like on the wire.
//
// Every public query (getResources, getResource, searchResources)
// funnels through this helper, so the frontend can rely on a
// consistent field set no matter which endpoint fetched the doc.
// If you add a field to the schema, add it here once and every
// query exposes it automatically.
//
// DELIBERATELY EXCLUDED from the public shape:
//   • r2Key          — internal R2 object key. Exposing it would
//                      let anyone with the query URL download the
//                      file for free, bypassing the subscription
//                      gate in actions.ts → getDownloadUrl.
//   • fileHash       — internal content-identity fingerprint.
//                      Useful only for dedup during sync.
//   • originalPath   — internal filesystem path from the sync
//                      machine. Leaks folder structure.
//
// These three live only on the raw DB document and are returned
// by the sync-script queries (getResourceByHash etc.), which are
// intended for authenticated admin use.
// ============================================================

/**
 * Construct the public thumbnail URL from an R2 key.
 * Returns null when the key is absent or the public URL base is unset.
 */
function getPublicThumbnailUrl(r2ThumbnailKey: string | undefined): string | null {
  if (!r2ThumbnailKey) return null;
  const baseUrl = process.env.R2_PUBLIC_URL;
  if (!baseUrl) {
    console.warn("R2_PUBLIC_URL not set, thumbnails will be unavailable");
    return null;
  }
  return `${baseUrl.replace(/\/$/, '')}/${r2ThumbnailKey}`;
}

/**
 * The canonical public shape of a resource document.
 *
 * Every field the frontend renders, filters, or acts upon is present:
 *   • Identity         — _id, title, subject, category
 *   • Attribution      — author, year
 *   • Entitlement      — isPremium
 *   • Content metadata — fileType, fileSize, description, tags
 *   • Media            — thumbnailUrl (derived), r2ThumbnailKey (raw)
 *   • Counters         — downloadCount, viewCount, version
 *   • Timestamps       — uploadedAt, updatedAt
 *
 * `isPremium` is coerced to a strict boolean (`?? false`) so the
 * frontend never has to guard against `undefined` when deciding
 * whether a document should open in preview mode.
 */
function toPublicDocument(r: any) {
  return {
    _id: r._id,
    title: r.title,
    subject: r.subject,
    category: r.category,
    author: r.author,
    year: r.year,
    isPremium: r.isPremium ?? false,
    fileType: r.fileType,
    fileSize: r.fileSize,
    description: r.description,
    tags: r.tags,
    thumbnailUrl: getPublicThumbnailUrl(r.r2ThumbnailKey),
    r2ThumbnailKey: r.r2ThumbnailKey,
    downloadCount: r.downloadCount ?? 0,
    viewCount: r.viewCount ?? 0,
    version: r.version,
    uploadedAt: r.uploadedAt,
    updatedAt: r.updatedAt,
  };
}

// ------------------------------------------------------------------
// 1. Get resources list (public – no auth required)
//
// Returns the canonical public shape for every active resource
// matching the subject + category, paginated by cursor.
//
// The `manifestVersion` field is the latest `updatedAt` in the
// result set, used by the frontend to detect stale caches.
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

    let q = ctx.db
      .query("resources")
      .withIndex("by_subject_category", (q) =>
        q.eq("subject", args.subject).eq("category", args.category)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc");

    if (args.cursor) {
      q = q.filter((q) => q.lt(q.field("_id"), args.cursor));
    }

    const items = await q.take(limit + 1);
    const hasMore = items.length > limit;
    const results = items.slice(0, limit);

    const documents = results.map(toPublicDocument);

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
//
// Returns only the latest updatedAt timestamp. Used by the frontend
// to decide whether to re-fetch the full catalogue without paying
// the cost of loading all documents.
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
//
// Returns the canonical public shape for one resource. Returns
// null when the resource is missing or inactive.
// ------------------------------------------------------------------
export const getResource = query({
  args: { resourceId: v.id("resources") },
  handler: async (ctx, args) => {
    const resource = await ctx.runQuery(
      internal.resources.internal.getResourceById,
      { resourceId: args.resourceId }
    );
    if (!resource || !resource.isActive) return null;

    return toPublicDocument(resource);
  },
});

// ------------------------------------------------------------------
// 4. Search resources (public)
//
// Returns the canonical public shape for every active resource
// whose title, subject, or tags match the search term.
//
// The frontend can feed the results directly into `docMap` and
// `createResourceCard` without any shape adaptation — every field
// the card renders is present.
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
    return limited.map(toPublicDocument);
  },
});

// ------------------------------------------------------------------
// 5. Get available filters (institutions/authors and years)
//
// Returns the distinct authors and years present in a category,
// so the UI can populate filter dropdowns. Does not return
// documents — just the aggregate values.
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
// Sync-script queries — return raw DB documents with ALL fields.
//
// These are used by the external sync script, which runs with
// admin credentials and needs fields like r2Key, fileHash, and
// originalPath that are deliberately hidden from public queries.
//
// The returned documents include the entire row from the
// `resources` table, unfiltered. Do not expose them to unauth-
// enticated clients.
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