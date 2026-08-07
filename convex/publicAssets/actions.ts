"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

export const getDownloadUrl = action({
  args: { r2Key: v.string() },
  handler: async (_, args) => {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: args.r2Key,
    });
    const url = await getSignedUrl(r2Client, command, { expiresIn: 3600 }); // 1 hour
    return url;
  },
});