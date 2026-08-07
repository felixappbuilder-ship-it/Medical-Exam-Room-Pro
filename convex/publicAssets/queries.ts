import { query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const getAsset = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const asset = await ctx.runQuery(internal.publicAssets.internal.getAssetByKey, {
      key: args.key,
    });
    if (!asset || !asset.isActive) {
      return null;
    }
    // Return only public fields (no internal details)
    return {
      key: asset.key,
      version: asset.version,
      fileHash: asset.fileHash,
      fileSize: asset.fileSize,
      fileType: asset.fileType,
      updatedAt: asset.updatedAt,
      description: asset.description,
    };
  },
});