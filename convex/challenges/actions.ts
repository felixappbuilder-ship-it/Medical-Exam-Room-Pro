// convex/challenges/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import crypto from "crypto";
import * as notificationTriggers from "../notifications/triggers";
import * as perf from "../shared/performance";

// ============================================================
// CONSTANTS
// ============================================================
const BASE_RATING = 100;
const K_FACTOR = 32;
const DEFAULT_TIME_LIMIT = 300; // 5 minutes fallback

// ============================================================
// HELPERS
// ============================================================
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

function generateChallengeCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function generateInviteToken(): string {
  return crypto.randomBytes(20).toString("hex");
}

async function hasUserSubmitted(ctx: any, challengeId: any, userId: any): Promise<boolean> {
  const result = await ctx.runQuery(internal.challenges.internal.getResultByChallengeAndUser, {
    challengeId,
    userId,
  });
  return !!result;
}

// ============================================================
// INTERNAL: Finalize Challenge (winner, ratings, notifications)
// ============================================================
async function finalizeChallenge(ctx: any, challengeId: any, challengeCode: string) {
  // Get participants with full user data and results (using the new helper)
  const participantList = await ctx.runQuery(
    internal.challenges.internal.getParticipantsWithDetails,
    { challengeId }
  );

  // Filter to submitted participants with valid data
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
      timeLimit: p.totalQuestions * 30, // fallback: 30s per question
      difficultyFactor: p.difficultyFactor,
      historyEWMA: p.historyEWMA ?? 0.5,
      rating: p.rating ?? BASE_RATING,
      completedExams: p.completedExams ?? 0,
      previousPRs: [], // We can extend later to fetch previous PRs
    };
    const prResult = perf.computePerformanceRatio(prData);
    prResults.push({
      userId: p.userId,
      pr: prResult.pr,
      factors: prResult.factors,
    });
  }

  // Compute lobby average PR
  if (prResults.length > 0) {
    lobbyAvgPR = prResults.reduce((sum, r) => sum + r.pr, 0) / prResults.length;
  }

  // Compute rating updates for each submitted participant
  const updates = [];
  for (const p of submitted) {
    const prEntry = prResults.find(r => r.userId === p.userId);
    if (!prEntry) continue;
    const newRating = perf.updateRatingRelative(
      p.rating ?? BASE_RATING,
      prEntry.pr,
      lobbyAvgPR,
      lobbyAvgPR * 100, // approximate opponent average rating
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

  // Award points to winner
  const config = await ctx.runQuery(internal.system.internal.getAppConfig, {});
  const points = config?.challengeWinnerPoints ?? 50;
  if (winner) {
    await ctx.runMutation(internal.challenges.internal.setChallengeWinner, {
      challengeId,
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

    // Also update the result document with PR and rating info if the participant submitted
    if (p.submitted && p.result) {
      const updateData: any = {};
      const prUpdate = updates.find(u => u.userId === p.userId);
      if (prUpdate) {
        updateData.pr = prUpdate.pr;
        updateData.ratingBefore = p.rating ?? BASE_RATING;
        updateData.ratingAfter = prUpdate.newRating;
      }
      if (Object.keys(updateData).length > 0) {
        await ctx.db.patch(p.result._id, updateData);
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
    challengeCode,
    summary,
    winner?.userId ?? null,
    points
  );

  // Mark challenge as completed
  await ctx.runMutation(internal.challenges.internal.updateChallengeStatus, {
    id: challengeId,
    status: "completed",
    winnerId: winner?.userId ?? null,
  });
}

// ============================================================
// 1. CREATE CHALLENGE
// ============================================================
export const createChallenge = action({
  args: { token: v.string(), blob: v.string() },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challengeCode = generateChallengeCode();
      const createdAt = Date.now();
      const expiresAt = createdAt + 30 * 60 * 1000;

      const challengeDocId = await ctx.runMutation(internal.challenges.internal.createChallenge, {
        challengeCode,
        creatorId: user._id,
        blob: args.blob,
        maxParticipants: 100,
        participantCount: 1,
        createdAt,
        expiresAt,
      });

      await ctx.runMutation(internal.challenges.internal.addParticipant, {
        challengeId: challengeDocId,
        userId: user._id,
      });

      await ctx.runMutation(internal.challenges.internal.updateUserLastSeen, { userId: user._id });

      const shareLink = `/exam-settings/?challenge=${challengeCode}`;
      await notificationTriggers.notifyChallengeCreated(
        ctx,
        user._id,
        challengeCode,
        shareLink,
        expiresAt
      );

      return {
        success: true,
        data: { code: challengeCode, expiresAt, shareLink },
      };
    } catch (error) {
      console.error("[createChallenge] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to create challenge",
      };
    }
  },
});

// ============================================================
// 2. JOIN CHALLENGE
// ============================================================
export const joinChallenge = action({
  args: {
    token: v.string(),
    challengeId: v.optional(v.id("challenges")),
    challengeCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      if (!args.challengeId && !args.challengeCode) {
        return {
          success: false,
          error: "invalid_args",
          message: "Either challengeId or challengeCode is required.",
        };
      }

      let challenge;
      if (args.challengeId) {
        challenge = await ctx.runQuery(internal.challenges.internal.getChallengeById, {
          id: args.challengeId,
        });
      } else if (args.challengeCode) {
        challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
          code: args.challengeCode,
        });
      }

      if (!challenge) {
        return { success: false, error: "not_found", message: "Challenge not found." };
      }

      const challengeDocId = challenge._id;

      const existing = await ctx.runQuery(
        internal.challenges.internal.getParticipantByChallengeAndUser,
        { challengeId: challengeDocId, userId: user._id }
      );

      if (existing) {
        const submitted = await hasUserSubmitted(ctx, challengeDocId, user._id);
        if (submitted) {
          return {
            success: false,
            error: "already_submitted",
            message: "You have already submitted your results for this challenge.",
          };
        }
        return {
          success: true,
          data: {
            challengeId: challengeDocId,
            status: challenge.status,
            blob: challenge.blob,
            alreadyJoined: true,
          },
        };
      }

      if (challenge.status !== "waiting" && challenge.status !== "created") {
        return {
          success: false,
          error: "invalid_status",
          message: "Challenge is not open for joining.",
        };
      }

      if (challenge.participantCount >= challenge.maxParticipants) {
        return {
          success: false,
          error: "full",
          message: `Challenge is full (${challenge.maxParticipants} max).`,
        };
      }

      await ctx.runMutation(internal.challenges.internal.addParticipant, {
        challengeId: challengeDocId,
        userId: user._id,
      });

      if (challenge.status !== "ready") {
        await ctx.runMutation(internal.challenges.internal.updateChallengeStatus, {
          id: challengeDocId,
          status: "ready",
        });
      }

      return {
        success: true,
        data: {
          challengeId: challengeDocId,
          status: "ready",
          blob: challenge.blob,
          alreadyJoined: false,
        },
      };
    } catch (error) {
      console.error("[joinChallenge] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to join challenge",
      };
    }
  },
});

// ============================================================
// 3. INVITE FRIEND
// ============================================================
export const inviteFriend = action({
  args: {
    token: v.string(),
    challengeCode: v.string(),
    friendEmail: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
        code: args.challengeCode,
      });
      if (!challenge) {
        return { success: false, error: "not_found", message: "Challenge not found." };
      }
      if (challenge.creatorId !== user._id) {
        return { success: false, error: "unauthorized", message: "Only the creator can invite." };
      }
      if (challenge.status !== "waiting" && challenge.status !== "created") {
        return { success: false, error: "invalid_status", message: "Challenge already started." };
      }

      const invitee = await ctx.runQuery(internal.auth.internal.getUserByEmail, {
        email: args.friendEmail,
      });
      if (!invitee) {
        return {
          success: false,
          error: "user_not_found",
          message: "No user found with that email.",
        };
      }

      const inviteToken = generateInviteToken();
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

      await ctx.runMutation(internal.challenges.internal.createInvitation, {
        challengeId: challenge._id,
        inviterId: user._id,
        inviteeEmail: args.friendEmail,
        token: inviteToken,
        expiresAt,
      });

      const inviteLink = `/exam-settings/?invite=${inviteToken}`;
      await notificationTriggers.notifyChallengeInvite(
        ctx,
        invitee._id,
        challenge.challengeCode,
        user.displayName || user.name,
        inviteLink
      );

      return {
        success: true,
        data: { inviteToken, inviteLink, expiresAt },
      };
    } catch (error) {
      console.error("[inviteFriend] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to send invitation",
      };
    }
  },
});

// ============================================================
// 4. ACCEPT INVITE
// ============================================================
export const acceptInvite = action({
  args: { token: v.string(), inviteToken: v.string() },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const invitation = await ctx.runQuery(internal.challenges.internal.getInvitationByToken, {
        token: args.inviteToken,
      });
      if (!invitation) {
        return { success: false, error: "not_found", message: "Invitation not found." };
      }
      if (invitation.status !== "pending") {
        return { success: false, error: "invalid", message: "Invitation already used or expired." };
      }
      if (invitation.expiresAt < Date.now()) {
        await ctx.runMutation(internal.challenges.internal.updateInvitationStatus, {
          id: invitation._id,
          status: "expired",
        });
        return { success: false, error: "expired", message: "Invitation has expired." };
      }
      if (invitation.inviteeEmail !== user.email) {
        return { success: false, error: "unauthorized", message: "This invitation is not for you." };
      }

      const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeById, {
        id: invitation.challengeId,
      });
      if (!challenge) {
        return { success: false, error: "not_found", message: "Challenge no longer exists." };
      }

      const challengeDocId = challenge._id;

      const existing = await ctx.runQuery(
        internal.challenges.internal.getParticipantByChallengeAndUser,
        { challengeId: challengeDocId, userId: user._id }
      );
      if (!existing) {
        if (challenge.participantCount >= challenge.maxParticipants) {
          return { success: false, error: "full", message: "Challenge is full." };
        }
        await ctx.runMutation(internal.challenges.internal.addParticipant, {
          challengeId: challengeDocId,
          userId: user._id,
        });
      }

      if (challenge.status !== "ready" && challenge.status !== "in_progress") {
        await ctx.runMutation(internal.challenges.internal.updateChallengeStatus, {
          id: challengeDocId,
          status: "ready",
        });
      }
      await ctx.runMutation(internal.challenges.internal.updateInvitationStatus, {
        id: invitation._id,
        status: "accepted",
      });

      return {
        success: true,
        data: {
          blob: challenge.blob,
          challengeCode: challenge.challengeCode,
          alreadyJoined: !!existing,
        },
      };
    } catch (error) {
      console.error("[acceptInvite] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to accept invitation",
      };
    }
  },
});

// ============================================================
// 5. SUBMIT CHALLENGE RESULT
// ============================================================
export const submitChallengeResult = action({
  args: {
    token: v.string(),
    challengeCode: v.string(),
    score: v.number(),
    totalQuestions: v.number(),
    percentage: v.number(),
    timeSpent: v.number(),
    difficultyFactor: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
        code: args.challengeCode,
      });
      if (!challenge) {
        return { success: false, error: "not_found", message: "Challenge not found." };
      }

      const challengeDocId = challenge._id;

      if (await hasUserSubmitted(ctx, challengeDocId, user._id)) {
        return {
          success: false,
          error: "already_submitted",
          message: "You have already submitted results for this challenge.",
        };
      }

      await ctx.runMutation(internal.challenges.internal.insertResult, {
        challengeId: challengeDocId,
        userId: user._id,
        score: args.score,
        percentage: args.percentage,
        timeSpent: args.timeSpent,
        submittedAt: Date.now(),
        difficultyFactor: args.difficultyFactor,
        totalQuestions: args.totalQuestions,
      });

      const participants = await ctx.runQuery(
        internal.challenges.internal.getChallengeParticipants,
        { challengeId: challengeDocId }
      );
      const allSubmitted = await Promise.all(
        participants.map(async (p: any) => {
          const res = await ctx.runQuery(
            internal.challenges.internal.getResultByChallengeAndUser,
            { challengeId: challengeDocId, userId: p.userId }
          );
          return !!res;
        })
      );
      const allDone = allSubmitted.every((s) => s === true);

      if (allDone) {
        await finalizeChallenge(ctx, challengeDocId, challenge.challengeCode);
      }

      return { success: true, data: { allDone } };
    } catch (error) {
      console.error("[submitChallengeResult] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to submit result",
      };
    }
  },
});

// ============================================================
// 6. CHECK CHALLENGE DEADLINES (cron)
// ============================================================
export const checkChallengeDeadlines = action({
  args: {},
  handler: async (ctx) => {
    try {
      const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
      const challenges = await ctx.runQuery(
        internal.challenges.internal.getChallengesByStatusAndCreatedAt,
        { status: "ready", olderThan: sixHoursAgo }
      );

      for (const challenge of challenges) {
        await finalizeChallenge(ctx, challenge._id, challenge.challengeCode);
      }
      return { processed: challenges.length };
    } catch (error) {
      console.error("[checkChallengeDeadlines] Error:", error);
      return { processed: 0, error: error instanceof Error ? error.message : "Cron failed" };
    }
  },
});

// ============================================================
// 7. GET CHALLENGE STATUS
// ============================================================
export const getChallengeStatus = action({
  args: { token: v.string(), challengeCode: v.string() },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
        code: args.challengeCode,
      });
      if (!challenge) {
        return { success: false, error: "not_found", message: "Challenge not found." };
      }
      const isCreator = challenge.creatorId === user._id;
      const isParticipant = isCreator || (await ctx.runQuery(
        internal.challenges.internal.getParticipantByChallengeAndUser,
        { challengeId: challenge._id, userId: user._id }
      ));
      if (!isParticipant) {
        return { success: false, error: "unauthorized", message: "You are not a participant." };
      }

      const submitted = await hasUserSubmitted(ctx, challenge._id, user._id);

      return {
        success: true,
        data: {
          status: challenge.status,
          creator: isCreator,
          blob: challenge.blob,
          expiresAt: challenge.expiresAt,
          participantCount: challenge.participantCount,
          maxParticipants: challenge.maxParticipants,
          hasSubmitted: submitted,
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
// 8–13. OTHER ACTIONS (unchanged)
// ============================================================

export const getOnlineUsers = action({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    try {
      await verifyTokenAndGetUser(ctx, args.token);
      const users = await ctx.runQuery(internal.challenges.internal.getOnlineUsers, {});
      return {
        success: true,
        data: users.map((u: any) => ({
          username: u.username,
          displayName: u.displayName,
        })),
      };
    } catch (error) {
      console.error("[getOnlineUsers] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to get online users",
      };
    }
  },
});

export const cleanupExpiredChallenges = action({
  args: {},
  handler: async (ctx) => {
    try {
      const now = Date.now();
      const expired = await ctx.runQuery(internal.challenges.internal.getExpiredChallenges, { now });
      for (const challenge of expired) {
        await ctx.runMutation(internal.challenges.internal.archiveChallenge, { id: challenge._id });
      }
      return { deleted: expired.length };
    } catch (error) {
      console.error("[cleanupExpiredChallenges] Error:", error);
      return { deleted: 0, error: error instanceof Error ? error.message : "Cleanup failed" };
    }
  },
});

export const sendMessage = action({
  args: {
    token: v.string(),
    challengeCode: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
        code: args.challengeCode,
      });
      if (!challenge) {
        return { success: false, error: "not_found", message: "Challenge not found." };
      }

      const isCreator = challenge.creatorId === user._id;
      const isParticipant = isCreator || (await ctx.runQuery(
        internal.challenges.internal.getParticipantByChallengeAndUser,
        { challengeId: challenge._id, userId: user._id }
      ));
      if (!isParticipant) {
        return { success: false, error: "unauthorized", message: "You are not a participant." };
      }

      await ctx.runMutation(internal.challenges.internal.sendChatMessage, {
        challengeId: challenge._id,
        userId: user._id,
        author: user.displayName || user.username,
        body: args.body,
      });

      return { success: true };
    } catch (error) {
      console.error("[sendMessage] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to send message",
      };
    }
  },
});

export const getMessages = action({
  args: {
    token: v.string(),
    challengeCode: v.string(),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
        code: args.challengeCode,
      });
      if (!challenge) {
        return { success: false, error: "not_found", message: "Challenge not found." };
      }

      const isCreator = challenge.creatorId === user._id;
      const isParticipant = isCreator || (await ctx.runQuery(
        internal.challenges.internal.getParticipantByChallengeAndUser,
        { challengeId: challenge._id, userId: user._id }
      ));
      if (!isParticipant) {
        return { success: false, error: "unauthorized", message: "You are not a participant." };
      }

      const messages = await ctx.runQuery(internal.challenges.internal.getChatMessagesSince, {
        challengeId: challenge._id,
        since: args.since || 0,
      });

      const formatted = messages.map((m: any) => ({
        author: m.author,
        body: m.body,
        timestamp: m.createdAt,
      }));

      return { success: true, messages: formatted };
    } catch (error) {
      console.error("[getMessages] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to get messages",
      };
    }
  },
});

export const getRoomParticipants = action({
  args: {
    token: v.string(),
    challengeCode: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      await verifyTokenAndGetUser(ctx, args.token);
      const challenge = await ctx.runQuery(internal.challenges.internal.getChallengeByCode, {
        code: args.challengeCode,
      });
      if (!challenge) {
        return { success: false, error: "not_found", message: "Challenge not found." };
      }

      const details = await ctx.runQuery(internal.challenges.internal.getRoomParticipantDetails, {
        challengeId: challenge._id,
      });

      return {
        success: true,
        count: details.count,
        creator: details.creator,
        onlineUsers: details.onlineUsers,
      };
    } catch (error) {
      console.error("[getRoomParticipants] Error:", error);
      return {
        success: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Failed to get participants",
      };
    }
  },
});

export const cleanupChatMessages = action({
  args: {},
  handler: async (ctx) => {
    try {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const deleted = await ctx.runMutation(internal.challenges.internal.cleanupOldChatMessages, {
        olderThan: twoHoursAgo,
      });
      return { deleted };
    } catch (error) {
      console.error("[cleanupChatMessages] Error:", error);
      return { deleted: 0, error: error instanceof Error ? error.message : "Cleanup failed" };
    }
  },
});