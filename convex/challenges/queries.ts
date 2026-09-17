// convex/challenges/queries.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) {
    throw new Error(result.message || "Invalid token");
  }
  const user = await ctx.runQuery(internal.auth.internal.getUserById, {
    userId: result.data.userId,
  });
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

// ============================================================
// 1. GET CHALLENGE STATUS
// ============================================================
export const getChallengeStatus = action({
  args: {
    token: v.string(),
    challengeCode: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
        code: args.challengeCode,
      });
      if (!challenge) {
        return {
          success: false,
          error: "not_found",
          message: "Challenge not found.",
        };
      }

      const isCreator = challenge.creatorId === user._id;
      const isParticipant = isCreator || (await ctx.runQuery(
        internal.challenges.internal.getParticipantByChallengeAndUser,
        { challengeId: challenge._id, userId: user._id }
      ));

      if (!isParticipant) {
        return {
          success: false,
          error: "unauthorized",
          message: "You are not a participant.",
        };
      }

      const submitted = await ctx.runQuery(
        internal.challenges.internal.getResultByChallengeAndUser,
        { challengeId: challenge._id, userId: user._id }
      );

      return {
        success: true,
        data: {
          status: challenge.status,
          creator: isCreator,
          blob: challenge.blob,
          expiresAt: challenge.expiresAt,
          participantCount: challenge.participantCount,
          maxParticipants: challenge.maxParticipants,
          hasSubmitted: !!submitted,
          winnerId: challenge.winnerId,
        },
      };
    } catch (error) {
      console.error("[getChallengeStatus] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to get challenge status",
      };
    }
  },
});

// ============================================================
// 2. GET USER CHALLENGE HISTORY
// ============================================================
export const getUserChallengeHistory = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challenges = await ctx.runQuery(
        internal.challenges.internal.getChallengesByUser,
        { userId: user._id }
      );

      challenges.sort((a, b) => b.createdAt - a.createdAt);

      const limit = args.limit || 50;
      const paginated = challenges.slice(0, limit);

      const history = [];
      for (const challenge of paginated) {
        const result = await ctx.runQuery(
          internal.challenges.internal.getResultByChallengeAndUser,
          { challengeId: challenge._id, userId: user._id }
        );
        history.push({
          challengeCode: challenge.challengeCode,
          status: challenge.status,
          createdAt: challenge.createdAt,
          expiresAt: challenge.expiresAt,
          participantCount: challenge.participantCount,
          maxParticipants: challenge.maxParticipants,
          winnerId: challenge.winnerId,
          result: result || null,
        });
      }

      return {
        success: true,
        data: {
          history,
          total: challenges.length,
        },
      };
    } catch (error) {
      console.error("[getUserChallengeHistory] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to fetch challenge history",
      };
    }
  },
});

// ============================================================
// 3. GET CHALLENGE PARTICIPANTS (with results and ratings)
// ============================================================
export const getChallengeParticipants = action({
  args: {
    token: v.string(),
    challengeCode: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
        code: args.challengeCode,
      });
      if (!challenge) {
        return {
          success: false,
          error: "not_found",
          message: "Challenge not found.",
        };
      }

      const isCreator = challenge.creatorId === user._id;
      const isParticipant = isCreator || (await ctx.runQuery(
        internal.challenges.internal.getParticipantByChallengeAndUser,
        { challengeId: challenge._id, userId: user._id }
      ));
      if (!isParticipant) {
        return {
          success: false,
          error: "unauthorized",
          message: "You are not a participant.",
        };
      }

      // Use the new getParticipantsWithDetails helper
      const participantList = await ctx.runQuery(
        internal.challenges.internal.getParticipantsWithDetails,
        { challengeId: challenge._id }
      );

      // Sort: winners first, then by percentage descending
      participantList.sort((a, b) => {
        if (a.isWinner && !b.isWinner) return -1;
        if (!a.isWinner && b.isWinner) return 1;
        if (a.submitted && !b.submitted) return -1;
        if (!a.submitted && b.submitted) return 1;
        return (b.percentage || 0) - (a.percentage || 0);
      });

      return {
        success: true,
        data: {
          participants: participantList,
          challengeCode: challenge.challengeCode,
          status: challenge.status,
          winnerId: challenge.winnerId,
        },
      };
    } catch (error) {
      console.error("[getChallengeParticipants] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to fetch participants",
      };
    }
  },
});

// ============================================================
// 4. GET CHALLENGE LEADERBOARD (global leaderboard)
// ============================================================
export const getChallengeLeaderboard = action({
  args: {
    token: v.string(),
    challengeCode: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
        code: args.challengeCode,
      });
      if (!challenge) {
        return {
          success: false,
          error: "not_found",
          message: "Challenge not found.",
        };
      }

      // Allow any authenticated user to view leaderboard
      const results = await ctx.runQuery(
        internal.challenges.internal.getResultsByChallengeId,
        { challengeId: challenge._id }
      );

      // Sort by percentage descending, then time ascending
      const sorted = results.sort((a: any, b: any) => {
        if (a.percentage !== b.percentage) return b.percentage - a.percentage;
        if (a.score !== b.score) return b.score - a.score;
        return a.timeSpent - b.timeSpent;
      });

      // Fetch user details for each result using Promise.all
      const leaderboard = await Promise.all(
        sorted.map(async (r: any) => {
          const userData = await ctx.runQuery(internal.auth.internal.getUserById, {
            userId: r.userId,
          });
          return {
            userId: r.userId,
            displayName: userData?.displayName || userData?.username || "Unknown",
            score: r.score,
            percentage: r.percentage,
            timeSpent: r.timeSpent,
            submittedAt: r.submittedAt,
            pr: r.pr || null,
            ratingBefore: r.ratingBefore || null,
            ratingAfter: r.ratingAfter || null,
          };
        })
      );

      return {
        success: true,
        data: {
          leaderboard,
          challengeCode: challenge.challengeCode,
        },
      };
    } catch (error) {
      console.error("[getChallengeLeaderboard] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to fetch leaderboard",
      };
    }
  },
});

// ============================================================
// 5. GET MY CHALLENGE RESULTS (for profile)
// ============================================================
export const getMyChallengeResults = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const results = await ctx.db
        .query("results")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .order("desc")
        .take(args.limit || 20);

      // Enrich with challenge details
      const enriched = await Promise.all(
        results.map(async (r: any) => {
          const challenge = await ctx.runQuery(
            internal.challenges.internal.getChallengeById,
            { id: r.challengeId }
          );
          return {
            challengeCode: challenge?.challengeCode || "Unknown",
            status: challenge?.status || "archived",
            score: r.score,
            percentage: r.percentage,
            timeSpent: r.timeSpent,
            submittedAt: r.submittedAt,
            pr: r.pr || null,
            ratingBefore: r.ratingBefore || null,
            ratingAfter: r.ratingAfter || null,
            isWinner: challenge?.winnerId === user._id,
          };
        })
      );

      return {
        success: true,
        data: enriched,
      };
    } catch (error) {
      console.error("[getMyChallengeResults] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to fetch results",
      };
    }
  },
});