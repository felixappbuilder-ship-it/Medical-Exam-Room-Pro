// convex/sharedExams/queries.ts
import { query } from "../_generated/server";
import { v } from "convex/values";

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      console.log("[getByToken] Looking for token:", args.token);
      const sharedExam = await ctx.db
        .query("sharedExams")
        .withIndex("by_token", (q) => q.eq("token", args.token))
        .first();

      if (!sharedExam) {
        console.log("[getByToken] No exam found for token");
        return null;
      }
      if (sharedExam.expiry < Date.now()) {
        console.log("[getByToken] Exam expired, deleting");
        await ctx.db.delete(sharedExam._id);
        return null;
      }
      console.log("[getByToken] Exam found, returning data");
      return sharedExam.examData;
    } catch (err) {
      console.error("[getByToken] Error:", err);
      throw new Error("Failed to retrieve shared exam");
    }
  },
});