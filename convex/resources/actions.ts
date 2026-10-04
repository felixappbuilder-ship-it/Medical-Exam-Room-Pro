// convex/resources/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ------------------------------------------------------------------
// Cloudflare R2 client (S3-compatible)
// ------------------------------------------------------------------
const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

// ------------------------------------------------------------------
// Helper: Verify JWT and get user ID
// ------------------------------------------------------------------
async function verifyToken(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) {
    throw new Error("Invalid or expired token: " + (result.message || ""));
  }
  return result.data;
}

// ------------------------------------------------------------------
// Helper: Check if user has active subscription or trial
// ------------------------------------------------------------------
async function hasActiveAccess(ctx: any, userId: string) {
  const subscription = await ctx.runQuery(
    internal.subscriptions.internal.getActiveSubscriptionByUserId,
    { userId }
  );
  return subscription !== null && subscription.expiryDate > Date.now();
}

// ------------------------------------------------------------------
// Generate presigned download URLs for the main file AND its thumbnail.
//
// Access policy (deliberately different for free vs premium):
//
//   • FREE resources      — any authenticated user may download.
//                           No subscription required.
//   • PREMIUM resources   — active subscription or free trial required.
//                           Verified via hasActiveAccess().
//
// The order of checks matters:
//   1. Verify the JWT first  — identifies the caller (attribution, audit).
//   2. Fetch the resource    — tells us whether it is premium.
//   3. Gate on subscription  — ONLY when the resource is premium.
//   4. Generate signed URLs.
//
// Checking the subscription before step 2 would (and previously did) block
// free downloads for users with no active subscription — the exact bug this
// action was rewritten to fix.
// ------------------------------------------------------------------
export const getDownloadUrl = action({
  args: {
    token: v.string(),
    resourceId: v.id("resources"),
  },
  handler: async (ctx, args) => {
    // ── 1. Verify JWT — always required, even for free resources --------
    //
    // Every download is attributed to a user so we can log it, bump the
    // download counter accurately, and audit against abusive traffic.
    let payload;
    try {
      payload = await verifyToken(ctx, args.token);
    } catch (err: any) {
      return {
        success: false,
        error: "invalid_token",
        message: err.message || "Authentication required. Please log in again.",
      };
    }

    const userId = payload.userId;

    // ── 2. Fetch the resource FIRST, so we know if it is premium ---------
    let resource;
    try {
      resource = await ctx.runQuery(internal.resources.internal.getResourceById, {
        resourceId: args.resourceId,
      });
    } catch (err: any) {
      console.error("[getDownloadUrl] Resource fetch error:", err);
      return {
        success: false,
        error: "resource_not_found",
        message: "Resource not found.",
      };
    }

    if (!resource || !resource.isActive) {
      return {
        success: false,
        error: "resource_unavailable",
        message: "This resource is no longer available.",
      };
    }

    if (!resource.r2Key) {
      return {
        success: false,
        error: "file_missing",
        message: "The file for this resource is missing.",
      };
    }

    // ── 3. Subscription gate — ONLY for premium resources ---------------
    //
    // `isPremium` is coerced with `=== true` so anything other than a
    // strict boolean true (undefined, null, false) is treated as free.
    // This is deliberate: existing records inserted before the sync script
    // started writing the field must not accidentally become gated.
    const isPremium = resource.isPremium === true;

    if (isPremium) {
      try {
        const hasAccess = await hasActiveAccess(ctx, userId);
        if (!hasAccess) {
          console.log(
            `[getDownloadUrl] Premium resource blocked for user ${userId}: ${resource.title}`
          );
          return {
            success: false,
            error: "subscription_required",
            message:
              "An active subscription or free trial is required to download this premium resource.",
          };
        }
      } catch (err: any) {
        console.error("[getDownloadUrl] Subscription check error:", err);
        return {
          success: false,
          error: "subscription_check_failed",
          message: "Failed to verify subscription status. Please try again.",
        };
      }
    } else {
      // Free resource: no subscription required. Log the access for
      // auditability but do not gate on it.
      console.log(
        `[getDownloadUrl] Free resource download by user ${userId}: ${resource.title}`
      );
    }

    // ── 4. Generate signed URLs for BOTH the main file and thumbnail ----
    try {
      // Main file
      const fileCommand = new GetObjectCommand({
        Bucket: BUCKET,
        Key: resource.r2Key,
      });
      const downloadUrl = await getSignedUrl(r2Client, fileCommand, { expiresIn: 3600 });

      // Thumbnail (if present)
      let thumbnailUrl: string | null = null;
      if (resource.r2ThumbnailKey) {
        try {
          const thumbnailCommand = new GetObjectCommand({
            Bucket: BUCKET,
            Key: resource.r2ThumbnailKey,
          });
          thumbnailUrl = await getSignedUrl(r2Client, thumbnailCommand, { expiresIn: 3600 });
        } catch (thumbErr) {
          console.warn("[getDownloadUrl] Failed to generate thumbnail URL:", thumbErr);
          // thumbnailUrl remains null – the frontend will handle it gracefully
        }
      }

      // ── 5. Increment download count (fire and forget) -----------------
      //
      // Failing to bump the counter must not fail the download itself. The
      // user got their URL; the metric is secondary.
      try {
        await ctx.runMutation(internal.resources.internal.updateResourceInternal, {
          resourceId: args.resourceId,
          updates: { downloadCount: (resource.downloadCount || 0) + 1 },
        });
      } catch (updateErr) {
        console.warn("[getDownloadUrl] Failed to increment download count:", updateErr);
      }

      return {
        success: true,
        data: {
          downloadUrl,
          thumbnailUrl, // may be null
          // Pass the premium flag back so the frontend can log/telemetry
          // without a second round-trip if it ever needs it.
          isPremium,
        },
      };
    } catch (err: any) {
      console.error("[getDownloadUrl] R2 presigned URL generation error:", err);
      return {
        success: false,
        error: "url_generation_failed",
        message: "Failed to generate download URLs. Please try again later.",
      };
    }
  },
});

// ------------------------------------------------------------------
// Delete a file from R2 – can be used by admin or sync script
// ------------------------------------------------------------------
export const deleteFromR2 = action({
  args: { r2Key: v.string() },
  handler: async (_, args) => {
    try {
      const command = new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: args.r2Key,
      });
      await r2Client.send(command);
      return { success: true };
    } catch (err: any) {
      console.error("[deleteFromR2] Error:", err);
      return {
        success: false,
        error: "delete_failed",
        message: err.message || "Failed to delete file from storage.",
      };
    }
  },
});

// ------------------------------------------------------------------
// Generate a public thumbnail URL from R2 (legacy, kept for compatibility)
// Used for listing resources – no authentication required.
// ------------------------------------------------------------------
export const getThumbnailUrl = action({
  args: { r2Key: v.string() },
  handler: async (_, args) => {
    try {
      // If bucket is public, construct URL directly
      const publicBase = process.env.R2_PUBLIC_URL;
      if (publicBase) {
        return { success: true, data: { url: `${publicBase.replace(/\/$/, '')}/${args.r2Key}` } };
      }
      // Otherwise generate presigned URL (shorter expiry for thumbnails)
      const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: args.r2Key,
      });
      const url = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
      return { success: true, data: { url } };
    } catch (err: any) {
      console.error("[getThumbnailUrl] Error:", err);
      return {
        success: false,
        error: "thumbnail_failed",
        message: "Failed to generate thumbnail URL.",
      };
    }
  },
});

// ================================================================
// NOTE: The previous uploadResource action has been removed because
// files are now uploaded directly to R2 by the sync script using
// the AWS SDK. Convex no longer stores file bytes.
// ================================================================