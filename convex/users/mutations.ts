import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { z } from "zod";

// Validation schemas
const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().regex(/^254\d{9}$/).optional(),
  institution: z.string().optional(),
  yearOfStudy: z.number().min(1).max(6).optional(),
});

const updatePreferencesSchema = z.object({
  preferences: z.object({
    theme: z.enum(["auto", "light", "dark"]).optional(),
    notifications: z.boolean().optional(),
  }),
});

const deleteAccountSchema = z.object({
  password: z.string().min(1),
});

// -----------------------------------------------------------------------------
// Update Profile
// -----------------------------------------------------------------------------
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    institution: v.optional(v.string()),
    yearOfStudy: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const validated = updateProfileSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db.get(identity.subject);
    if (!user) throw new ConvexError("User not found");

    // If phone is being updated, check it's not already taken
    if (validated.phone && validated.phone !== user.phone) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_phone", (q: any) => q.eq("phone", validated.phone))
        .first();
      if (existing) throw new ConvexError("Phone number already in use");
    }

    // Build update object
    const updates: any = {};
    if (validated.name !== undefined) updates.name = validated.name;
    if (validated.phone !== undefined) updates.phone = validated.phone;
    if (validated.institution !== undefined) updates.institution = validated.institution;
    if (validated.yearOfStudy !== undefined) updates.yearOfStudy = validated.yearOfStudy;

    await ctx.db.patch(user._id, updates);

    // Return updated user (non‑sensitive fields)
    const updatedUser = await ctx.db.get(user._id);
    return {
      _id: updatedUser!._id,
      name: updatedUser!.name,
      email: updatedUser!.email,
      phone: updatedUser!.phone,
      devices: updatedUser!.devices,
      preferences: updatedUser!.preferences,
      createdAt: updatedUser!.createdAt,
      lastLogin: updatedUser!.lastLogin,
      isLocked: updatedUser!.isLocked,
      lockReason: updatedUser!.lockReason,
      role: updatedUser!.role,
      trialUsed: updatedUser!.trialUsed,
      institution: updatedUser!.institution,
      yearOfStudy: updatedUser!.yearOfStudy,
    };
  },
});

// -----------------------------------------------------------------------------
// Update Preferences
// -----------------------------------------------------------------------------
export const updatePreferences = mutation({
  args: {
    preferences: v.object({
      theme: v.optional(v.union(v.literal("auto"), v.literal("light"), v.literal("dark"))),
      notifications: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const validated = updatePreferencesSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db.get(identity.subject);
    if (!user) throw new ConvexError("User not found");

    // Merge preferences
    const newPreferences = {
      ...user.preferences,
      ...validated.preferences,
    };

    await ctx.db.patch(user._id, { preferences: newPreferences });

    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      devices: user.devices,
      preferences: newPreferences,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      isLocked: user.isLocked,
      lockReason: user.lockReason,
      role: user.role,
      trialUsed: user.trialUsed,
    };
  },
});

// -----------------------------------------------------------------------------
// Delete Account
// -----------------------------------------------------------------------------
export const deleteAccount = mutation({
  args: {
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const validated = deleteAccountSchema.parse(args);

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db.get(identity.subject);
    if (!user) throw new ConvexError("User not found");

    // Verify password via action
    const isValid = await ctx.runAction(internal.auth.actions.verifyPassword, {
      password: validated.password,
      hash: user.passwordHash,
    });
    if (!isValid) throw new ConvexError("Invalid password");

    // Log security event before deletion
    await ctx.db.insert("securityEvents", {
      userId: user._id,
      type: "account_deletion",
      details: {},
      timestamp: Date.now(),
      resolved: true,
    });

    // Delete the user document
    await ctx.db.delete(user._id);

    // Note: related data (subscriptions, payments, notes, etc.) remains orphaned.
    // A cron job can clean them up later if needed.

    return { success: true };
  },
});