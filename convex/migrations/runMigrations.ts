// convex/migrations/runMigrations.ts
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

export const runAllMigrations = mutation({
  args: {},
  handler: async (ctx) => {
    const results: string[] = [];

    // Migration 001: Seed appConfig if missing
    const existingConfig = await ctx.db.query("appConfig").first();
    if (!existingConfig) {
      await ctx.db.insert("appConfig", {
        _id: "config",
        trialDurationHours: 3,
        maintenanceMode: false,
        subscriptionPlans: [
          { name: "1 Month", price: 500, days: 30 },
          { name: "3 Months", price: 1200, days: 90 },
          { name: "1 Year", price: 4000, days: 365 },
        ],
        paymentsFrozen: false,
        maxRequestsPerMinute: 60,
      });
      results.push("Migration 001: appConfig seeded.");
    } else {
      results.push("Migration 001: appConfig already exists, skipping.");
    }

    // Migration 002: Ensure admin user from ADMIN_EMAIL env var (manual uniqueness)
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const existingAdmin = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", adminEmail))
        .first();
      if (!existingAdmin) {
        // Admin user must be created via registration flow; this migration only logs.
        // In production, you would run a separate action to create admin with a default password.
        // We'll skip automatic creation for security. Instead, we log a reminder.
        results.push(`Migration 002: ADMIN_EMAIL set but no admin user found. Please register user with email ${adminEmail} and assign role "admin" manually via admin mutation.`);
      } else {
        results.push("Migration 002: Admin user already exists.");
      }
    } else {
      results.push("Migration 002: ADMIN_EMAIL not set, skipping admin check.");
    }

    // Migration 003: Verify vector index is usable (no data migration needed, schema already defines)
    // We could populate embeddings for existing questions, but this is a fresh schema.
    results.push("Migration 003: Vector index 'by_embedding' is defined in schema. Ensure embeddings are generated for existing questions.");

    // Migration 004: Normalize devices – if users.devices array has data, move to devices table
    // This is for backward compatibility if migrating from an older schema.
    const users = await ctx.db.query("users").collect();
    let deviceMigrationCount = 0;
    for (const user of users) {
      const devicesArray = (user as any).devices;
      if (devicesArray && Array.isArray(devicesArray) && devicesArray.length > 0) {
        for (const device of devicesArray) {
          const existing = await ctx.db
            .query("devices")
            .withIndex("by_fingerprint", (q) => q.eq("fingerprint", device.fingerprint))
            .first();
          if (!existing) {
            await ctx.db.insert("devices", {
              userId: user._id,
              fingerprint: device.fingerprint,
              lastUsed: device.lastUsed || Date.now(),
            });
            deviceMigrationCount++;
          }
        }
        // Optionally clear the array to save space
        await ctx.db.patch(user._id, { devices: [] });
      }
    }
    results.push(`Migration 004: Normalized ${deviceMigrationCount} device records to devices table.`);

    // Audit log for migration (R16)
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: "system",
      action: "run_migrations",
      details: { results },
    });

    return { success: true, data: { results } };
  },
});