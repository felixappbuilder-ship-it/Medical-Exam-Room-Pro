// convex/migrations/001_initial_schema.ts
// Migration script for initial schema setup.
// This file is a placeholder for running one-time data migrations.
// In production, run via `npx convex run migrations:runInitialMigration`

import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

export const runInitialMigration = mutation({
  args: {},
  handler: async (ctx) => {
    // Check if appConfig already exists
    const existingConfig = await ctx.db.query("appConfig").first();
    if (!existingConfig) {
      // Seed default app configuration
      await ctx.db.insert("appConfig", {
        _id: "config",
        trialDurationHours: 3,
        maintenanceMode: false,
        subscriptionPlans: [
          { name: "1 Month", price: 350, days: 30 },
          { name: "3 Months", price: 850, days: 90 },
          { name: "1 Year", price: 2100, days: 365 },
        ],
        paymentsFrozen: false,
        maxRequestsPerMinute: 60,
      });
    }

    // Seed admin user if ADMIN_EMAIL environment variable is set (during deployment)
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const existingAdmin = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", adminEmail))
        .first();
      if (!existingAdmin) {
        // Admin user will be created via auth/actions.ts register with role flag.
        // This migration only ensures config exists. Admin creation is handled elsewhere.
        // We'll just log that admin seeding is pending.
        console.log("Migration: Admin email set but user not created. Use register with admin flag.");
      }
    }

    // Ensure vector index is ready (no action needed, schema already defines it)
    return { success: true, message: "Initial migration completed" };
  },
});