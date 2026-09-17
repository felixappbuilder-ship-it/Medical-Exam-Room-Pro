// convex/challenges/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import * as notificationTriggers from "../notifications/triggers";
import * as perf from "../shared/performance";

// ============================================================
// CONSTANTS
// ============================================================
const BASE_RATING = 100;
const K_FACTOR = 32;

// ============================================================
// HELPERS
// ============================================================
async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error(result.message);
  const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId: result.data.userId });
  if (!user) throw new Error("User not found");
  return user;
}

// ============================================================
// 1. JOIN CHALLENGE – allows rejoining if not submitted yet
// ============================================================
export const joinChallenge = mutation({
  args: {
    token: v.string(),
    challengeCode: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
      code: args.challengeCode,
    });

    if (!challenge) {
      return { success: false, error: "not_found", message: "Challenge not found." };
    }

    const challengeId = challenge._id;

    // Check if already a participant
    const existing = await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challengeId_userId", (q) =>
        q.eq("challengeId", challengeId).eq("userId", user._id)
      )
      .first();

    if (existing) {
      // ✅ Allow rejoining if not yet submitted
      const submitted = await ctx.db
        .query("results")
        .withIndex("by_challenge", (q) => q.eq("challengeId", challengeId))
        .filter((q) => q.eq(q.field("userId"), user._id))
        .first();
      if (submitted) {
        return {
          success: false,
          error: "already_submitted",
          message: "You have already submitted results for this challenge.",
        };
      }
      // Rejoin: return the blob so user can continue
      return {
        success: true,
        data: {
          blob: challenge.blob,
          challengeId,
          alreadyJoined: true,
          status: challenge.status,
        },
      };
    }

    // New participant
    if (challenge.creatorId === user._id) {
      return {
        success: false,
        error: "self_join",
        message: "You are the creator – you are already a participant.",
      };
    }

    if (challenge.status !== "waiting" && challenge.status !== "created") {
      return {
        success: false,
        error: "invalid_status",
        message: "Challenge already started or expired.",
      };
    }

    if (challenge.expiresAt < Date.now()) {
      await ctx.runMutation(internal.challenges.internal.updateChallengeStatus, {
        id: challengeId,
        status: "archived",
      });
      return { success: false, error: "expired", message: "Challenge has expired." };
    }

    if (challenge.participantCount >= challenge.maxParticipants) {
      return {
        success: false,
        error: "full",
        message: `Challenge is full (${challenge.maxParticipants} max).`,
      };
    }

    await ctx.runMutation(internal.challenges.internal.addParticipant, {
      challengeId,
      userId: user._id,
    });

    if (challenge.status !== "ready") {
      await ctx.runMutation(internal.challenges.internal.updateChallengeStatus, {
        id: challengeId,
        status: "ready",
      });
    }

    return {
      success: true,
      data: {
        blob: challenge.blob,
        challengeId,
        status: "ready",
        alreadyJoined: false,
      },
    };
  },
});

// ============================================================
// 2. SUBMIT CHALLENGE RESULT – with performance engine
// ============================================================
export const submitResult = mutation({
  args: {
    token: v.string(),
    challengeId: v.id("challenges"),
    score: v.number(),
    totalQuestions: v.number(),
    percentage: v.number(),
    timeSpent: v.number(), // seconds
    difficultyFactor: v.number(), // weighted average difficulty (1–5)
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeById, {
      id: args.challengeId,
    });
    if (!challenge) {
      return { success: false, error: "not_found", message: "Challenge not found." };
    }

    // Verify user is a participant
    const isCreator = challenge.creatorId === user._id;
    const isParticipant = isCreator || (await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challengeId_userId", (q) =>
        q.eq("challengeId", args.challengeId).eq("userId", user._id)
      )
      .first());

    if (!isParticipant) {
      return { success: false, error: "unauthorized", message: "You are not a participant." };
    }

    // Prevent duplicate submission
    const existing = await ctx.db
      .query("results")
      .withIndex("by_challenge", (q) => q.eq("challengeId", args.challengeId))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .first();
    if (existing) {
      return { success: false, error: "duplicate", message: "Result already submitted." };
    }

    // Insert the result with aggregated data
    await ctx.runMutation(internal.challenges.internal.createResult, {
      challengeId: args.challengeId,
      userId: user._id,
      score: args.score,
      percentage: args.percentage,
      timeSpent: args.timeSpent,
      submittedAt: Date.now(),
      difficultyFactor: args.difficultyFactor,
      totalQuestions: args.totalQuestions,
    });

    // Check if all participants have submitted
    const participants = await ctx.runQuery(
      internal.challenges.internal.getChallengeParticipants,
      { challengeId: args.challengeId }
    );
    const allParticipantIds = participants.map(p => p.userId);
    const allSubmitted = await Promise.all(
      allParticipantIds.map(async (pid: any) => {
        const res = await ctx.runQuery(
          internal.challenges.internal.getResultByChallengeAndUser,
          { challengeId: args.challengeId, userId: pid }
        );
        return !!res;
      })
    );
    const allDone = allSubmitted.every(s => s === true);

    if (allDone) {
      // ========== Finalize challenge using the shared helper ==========
      // Get participants with full user data and results
      const participantList = await ctx.runQuery(
        internal.challenges.internal.getParticipantsWithDetails,
        { challengeId: args.challengeId }
      );

      const submitted = participantList.filter(p => p.submitted && p.difficultyFactor !== null && p.totalQuestions !== null);
      let lobbyAvgPR = 0.5;

      // Compute PR for each submitted participant
      const prResults = [];
      for (const p of submitted) {
        if (!p.difficultyFactor || !p.totalQuestions) continue;
        const prData = {
          correct: p.score,
          total: p.totalQuestions,
          timeUsed: p.timeSpent,
          timeLimit: p.totalQuestions * 30,
          difficultyFactor: p.difficultyFactor,
          historyEWMA: p.historyEWMA ?? 0.5,
          rating: p.rating ?? BASE_RATING,
          completedExams: p.completedExams ?? 0,
          previousPRs: [],
        };
        const prResult = perf.computePerformanceRatio(prData);
        prResults.push({
          userId: p.userId,
          pr: prResult.pr,
          factors: prResult.factors,
        });
      }

      if (prResults.length > 0) {
        lobbyAvgPR = prResults.reduce((sum, r) => sum + r.pr, 0) / prResults.length;
      }

      // Compute rating updates
      const updates = [];
      for (const p of submitted) {
        const prEntry = prResults.find(r => r.userId === p.userId);
        if (!prEntry) continue;
        const newRating = perf.updateRatingRelative(
          p.rating ?? BASE_RATING,
          prEntry.pr,
          lobbyAvgPR,
          lobbyAvgPR * 100,
          K_FACTOR
        );
        const newHistory = perf.updateHistoryEWMA(p.historyEWMA ?? 0.5, prEntry.pr);
        updates.push({
          userId: p.userId,
          pr: prEntry.pr,
          factors: prEntry.factors,
          newRating,
          newHistory,
        });
      }

      // Determine winner: highest PR, tie by percentage, then time
      let winner = null;
      if (updates.length > 0) {
        winner = updates.reduce((best, current) => {
          if (current.pr > best.pr) return current;
          if (current.pr === best.pr) {
            const pData = submitted.find(p => p.userId === current.userId);
            const bestData = submitted.find(p => p.userId === best.userId);
            if (pData && bestData) {
              if (pData.percentage > bestData.percentage) return current;
              if (pData.percentage === bestData.percentage && pData.timeSpent < bestData.timeSpent) return current;
            }
          }
          return best;
        });
      }

      // Award points
      const config = await ctx.runQuery(internal.system.internal.getAppConfig, {});
      const points = config?.challengeWinnerPoints ?? 50;
      if (winner) {
        await ctx.runMutation(internal.challenges.internal.setChallengeWinner, {
          challengeId: args.challengeId,
          winnerId: winner.userId,
          pointsAwarded: points,
        });
      }

      // Update user ratings and leaderboard points for all participants
      for (const p of participantList) {
        const update = updates.find(u => u.userId === p.userId);
        const newRating = update ? update.newRating : (p.rating ?? BASE_RATING);
        const newHistory = update ? update.newHistory : (p.historyEWMA ?? 0.5);
        const completed = p.submitted ? (p.completedExams ?? 0) + 1 : (p.completedExams ?? 0);
        const started = (p.startedExams ?? 0) + 1;
        const lbPoints = (winner && winner.userId === p.userId)
          ? (p.leaderboardPoints ?? 0) + points
          : (p.leaderboardPoints ?? 0);
        await ctx.runMutation(internal.challenges.internal.updateUserPerformance, {
          userId: p.userId,
          rating: newRating,
          historyEWMA: newHistory,
          completedExams: completed,
          startedExams: started,
          leaderboardPoints: lbPoints,
        });

        // Update the result document with PR and rating info
        if (p.submitted && p.result) {
          const prUpdate = updates.find(u => u.userId === p.userId);
          if (prUpdate) {
            await ctx.db.patch(p.result._id, {
              pr: prUpdate.pr,
              ratingBefore: p.rating ?? BASE_RATING,
              ratingAfter: prUpdate.newRating,
            });
          }
        }
      }

      // Build summary for notification
      const summary = participantList.map(p => {
        const update = updates.find(u => u.userId === p.userId);
        const isWinner = winner ? p.userId === winner.userId : false;
        return {
          displayName: p.displayName,
          score: p.score ?? 0,
          percentage: p.percentage ?? 0,
          timeSpent: p.timeSpent ?? 0,
          submitted: p.submitted,
          isWinner,
          pr: update?.pr ?? 0,
          ratingBefore: p.rating ?? BASE_RATING,
          ratingAfter: update?.newRating ?? p.rating ?? BASE_RATING,
        };
      });

      const participantIds = participantList.map(p => p.userId);
      await notificationTriggers.notifyChallengeResults(
        ctx,
        participantIds,
        challenge.challengeCode,
        summary,
        winner?.userId ?? null,
        points
      );

      // Mark challenge as completed
      await ctx.runMutation(internal.challenges.internal.updateChallengeStatus, {
        id: args.challengeId,
        status: "completed",
        winnerId: winner?.userId ?? null,
      });
    }

    return { success: true, data: { message: "Result submitted." } };
  },
});

// ============================================================
// 3. UPDATE USERNAME
// ============================================================
export const updateUsername = mutation({
  args: {
    token: v.string(),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    const base = args.displayName.replace(/\s+/g, "");
    const username = await ctx.runMutation(internal.challenges.internal.generateUniqueUsername, {
      baseName: base,
    });
    await ctx.db.patch(user._id, { displayName: args.displayName, username });
    return { success: true, data: { username, displayName: args.displayName } };
  },
});

// ============================================================
// 4. PING (online presence)
// ============================================================
export const ping = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    await ctx.runMutation(internal.challenges.internal.updateUserLastSeen, { userId: user._id });
    return { success: true };
  },
});