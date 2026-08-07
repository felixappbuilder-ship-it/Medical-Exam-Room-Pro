// convex/migrations/populateUsernameDisplayName.ts
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";

export const populateUsernameDisplayName = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let updated = 0;
    let errors = 0;

    try {
      const users = await ctx.db.query("users").collect();

      for (const user of users) {
        // Skip if already has both fields
        if (user.username && user.displayName) continue;

        const baseName = user.name.replace(/\s+/g, "");
        let candidate = baseName;
        let attempts = 0;
        // Generate unique username (R2: enforce uniqueness manually)
        while (attempts < 20) {
          const existing = await ctx.db
            .query("users")
            .withIndex("by_username", (q) => q.eq("username", candidate))
            .first();
          if (!existing) break;
          const digits = Math.floor(100 + Math.random() * 900).toString().slice(0, 3);
          candidate = baseName + digits;
          attempts++;
        }
        if (attempts >= 20) {
          candidate = baseName + now.toString().slice(-4);
        }

        const displayName = user.displayName || user.name;

        await ctx.db.patch(user._id, {
          username: candidate,
          displayName,
          status: "online",
          lastSeen: now,
        });
        updated++;
      }

      // Audit log (R16) – log the migration action
      await ctx.runMutation(internal.auth.internal.logAuditEvent, {
        actorId: "system",
        action: "populate_username_displayname",
        targetId: undefined,
        details: { updated, timestamp: now },
      });

      return {
        success: true,
        data: { updated },
        message: `Successfully populated ${updated} users.`,
      };
    } catch (err) {
      // Structured error response (R13)
      console.error("[Migration] populateUsernameDisplayName failed:", err);
      return {
        success: false,
        error: err.message || "Migration failed",
        message: "Failed to populate username and displayName fields.",
      };
    }
  },
});