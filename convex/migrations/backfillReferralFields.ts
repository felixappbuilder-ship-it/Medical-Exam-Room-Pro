// convex/migrations/backfillReferralFields.ts
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";

export const backfillReferralFields = mutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    let updated = 0;
    for (const user of users) {
      const updates: any = {};
      let needsUpdate = false;

      // Generate a referral code if missing
      if (!user.referralCode) {
        // Generate a unique code using the same logic as in internal
        let code = generateRandomCode();
        let attempts = 0;
        while (attempts < 100) {
          const existing = await ctx.db
            .query("users")
            .withIndex("by_referralCode", (q) => q.eq("referralCode", code))
            .first();
          if (!existing) break;
          code = generateRandomCode();
          attempts++;
        }
        updates.referralCode = code;
        needsUpdate = true;
      }

      // Set default values for other referral fields if missing
      if (user.isAgent === undefined) {
        updates.isAgent = false;
        needsUpdate = true;
      }
      if (user.agentVerified === undefined) {
        updates.agentVerified = false;
        needsUpdate = true;
      }
      if (user.referralBalance === undefined) {
        updates.referralBalance = 0;
        needsUpdate = true;
      }
      if (user.totalEarned === undefined) {
        updates.totalEarned = 0;
        needsUpdate = true;
      }
      if (user.pendingBalance === undefined) {
        updates.pendingBalance = 0;
        needsUpdate = true;
      }
      if (user.referralRewarded === undefined) {
        updates.referralRewarded = false;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await ctx.db.patch(user._id, updates);
        updated++;
      }
    }
    return { updated };
  },
});

// Helper (copy from users/internal.ts)
function generateRandomCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}