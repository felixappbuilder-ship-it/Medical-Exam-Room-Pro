"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";

// -----------------------------------------------------------------------------
// Export User Data (GDPR)
// -----------------------------------------------------------------------------
export const exportData = action({
  args: {},
  handler: async (ctx) => {
    // Authentication is handled by the identity passed from the client
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const userId = identity.subject;

    // Fetch all user data using internal queries
    const [user, subscriptions, payments, examResults, notes, conversations] = await Promise.all([
      ctx.runQuery(internal.users.getProfile), // reuse existing query (must be internal)
      ctx.runQuery(internal.subscriptions.getUserSubscriptions, { userId }),
      ctx.runQuery(internal.payments.getUserPayments, { userId }),
      ctx.runQuery(internal.examResults.getUserExamResults, { userId }),
      ctx.runQuery(internal.notes.getUserNotes, { userId }),
      ctx.runQuery(internal.conversations.getUserConversations, { userId }),
    ]);

    // Build export object
    const exportData = {
      profile: user,
      subscriptions,
      payments,
      examResults,
      notes,
      conversations,
      exportedAt: Date.now(),
    };

    // Log the export (security event)
    await ctx.runMutation(internal.security.logSecurityEvent, {
      userId,
      type: "data_export",
      details: { timestamp: Date.now() },
    });

    return exportData;
  },
});