// convex/migrations/createAdminAccount.ts
"use node";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

export const createAdminAccount = action({
  args: {},
  handler: async (ctx) => {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in environment variables");
    }

    // Check if admin already exists
    const existing = await ctx.runQuery(internal.auth.internal.getUserByEmail, { email });
    if (existing) {
      if (existing.role !== "admin") {
        await ctx.runMutation(internal.auth.internal.updateUser, {
          userId: existing._id,
          updates: { role: "admin" },
        });
        return { created: false, updated: true, userId: existing._id };
      }
      return { created: false, updated: false, userId: existing._id };
    }

    // Hash password
    const passwordHash = await ctx.runAction(internal.auth.helpers.hashPassword, { password });

    // Insert user with admin role directly
    const userId = await ctx.runMutation(internal.auth.internal.insertUser, {
      name: "Administrator",
      email,
      phone: "0000000000",
      passwordHash,
      securityQuestions: [],
      role: "admin",
    });

    return { created: true, userId };
  },
});