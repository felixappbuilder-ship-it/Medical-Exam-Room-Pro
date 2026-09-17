// convex/users/queries.ts
import { query, action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import * as perf from "../shared/performance";

// ============================================================
// 1. GET PROFILE (existing)
// ============================================================
export const getProfile = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
    } catch (err) {
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    const userId = payload.userId;
    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });

    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User account no longer exists.",
      };
    }

    const { passwordHash, securityQuestions, ...safeUser } = user;
    return {
      success: true,
      data: { user: safeUser },
    };
  },
});

// ============================================================
// 2. GET DEVICES (for profile page)
// ============================================================
export const getDevices = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    let payload;
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      payload = result.data;
    } catch (err) {
      return {
        success: false,
        error: "token_verification_failed",
        message: "Failed to verify authentication token.",
      };
    }

    const userId = payload.userId;

    const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!user) {
      return {
        success: false,
        error: "user_not_found",
        message: "User not found.",
      };
    }

    const sessions = await ctx.runQuery(internal.auth.internal.getSessionsForUser, { userId });
    const currentSessionId = payload.sessionId || null;

    const userDevices = user.devices || [];

    const deviceList = userDevices.map((dev) => {
      const session = sessions.find(
        (s) => s.deviceId === dev.fingerprint && !s.revoked && s.expiresAt > Date.now()
      );
      const isCurrent = currentSessionId && session && session.sessionId === currentSessionId;
      return {
        fingerprint: dev.fingerprint,
        platform: dev.platform || "Unknown",
        lastUsed: dev.lastUsed,
        isCurrent: !!isCurrent,
        sessionId: session ? session.sessionId : null,
        isActive: !!session,
      };
    });

    deviceList.sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return b.lastUsed - a.lastUsed;
    });

    return {
      success: true,
      data: {
        devices: deviceList,
        currentSessionId,
      },
    };
  },
});

// ============================================================
// 3. GET USER PERFORMANCE (rating, rank, history, points)
// ============================================================
export const getUserPerformance = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      const userId = result.data.userId;
      const user = await ctx.runQuery(internal.users.internal.getUserById, { userId });
      if (!user) {
        return {
          success: false,
          error: "user_not_found",
          message: "User not found.",
        };
      }

      // Compute rank
      const rating = user.rating || 100;
      const rankInfo = perf.getRank(rating);

      // Get challenge stats (optional)
      const challenges = await ctx.runQuery(
        internal.challenges.internal.getChallengesByUser,
        { userId }
      );
      const completedChallenges = challenges.filter(c => c.status === "completed").length;

      return {
        success: true,
        data: {
          rating,
          historyEWMA: user.historyEWMA || 0.5,
          completedExams: user.completedExams || 0,
          startedExams: user.startedExams || 0,
          leaderboardPoints: user.leaderboardPoints || 0,
          rank: rankInfo,
          completedChallenges,
          integrityScore: user.integrityScore || 1,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: "performance_fetch_failed",
        message: err.message || "Failed to fetch performance data",
      };
    }
  },
});

// ============================================================
// 4. GET LEADERBOARD (top users by leaderboardPoints)
// ============================================================
export const getLeaderboard = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }

      const limit = args.limit || 50;
      const users = await ctx.db
        .query("users")
        .order("desc")
        .take(limit);

      const safeUsers = users.map(u => ({
        _id: u._id,
        displayName: u.displayName,
        username: u.username,
        rating: u.rating || 100,
        leaderboardPoints: u.leaderboardPoints || 0,
        completedExams: u.completedExams || 0,
      }));

      return { success: true, data: safeUsers };
    } catch (err: any) {
      return {
        success: false,
        error: "leaderboard_fetch_failed",
        message: err.message || "Failed to fetch leaderboard",
      };
    }
  },
});

// ============================================================
// 5. GET PERFORMANCE HISTORY (previous PRs)
// ============================================================
export const getPerformanceHistory = action({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runAction(internal.auth.actions.verifyToken, { token: args.token });
      if (!result.success) {
        return {
          success: false,
          error: "invalid_token",
          message: result.message,
        };
      }
      const userId = result.data.userId;

      // Fetch user's challenge results with PR
      const results = await ctx.db
        .query("results")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .take(args.limit || 20);

      const history = results.map(r => ({
        challengeId: r.challengeId,
        pr: r.pr || 0,
        percentage: r.percentage,
        score: r.score,
        timeSpent: r.timeSpent,
        submittedAt: r.submittedAt,
      }));

      return { success: true, data: history };
    } catch (err: any) {
      return {
        success: false,
        error: "history_fetch_failed",
        message: err.message || "Failed to fetch performance history",
      };
    }
  },
});