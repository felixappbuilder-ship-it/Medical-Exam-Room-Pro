// convex/challenges/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

async function verifyTokenAndGetUser(ctx: any, token: string) {
  const result = await ctx.runAction(internal.auth.actions.verifyToken, { token });
  if (!result.success) throw new Error(result.message);
  const user = await ctx.runQuery(internal.auth.internal.getUserById, { userId: result.data.userId });
  if (!user) throw new Error("User not found");
  return user;
}

// ── Join a challenge (multi‑participant) ──
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

    // challenge._id is the Convex document ID – this is what we use everywhere
    const challengeId = challenge._id;

    // Check if already a participant
    const existing = await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challengeId_userId", (q) =>
        q.eq("challengeId", challengeId).eq("userId", user._id)
      )
      .first();

    if (existing) {
      return {
        success: false,
        error: "already_joined",
        message: "You have already joined this challenge.",
      };
    }

    if (challenge.creatorId === user._id) {
      return {
        success: false,
        error: "self_join",
        message: "You cannot join your own challenge (you are already a participant).",
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

    // Add participant using the Convex document ID
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
        challengeId,   // Convex document ID
        status: "ready",
      },
    };
  },
});

// ── Submit exam result ──
export const submitResult = mutation({
  args: {
    token: v.string(),
    challengeId: v.id("challenges"),  // expects a Convex document ID
    score: v.number(),
    percentage: v.number(),
    timeSpent: v.number(),
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

    await ctx.runMutation(internal.challenges.internal.createResult, {
      challengeId: args.challengeId,
      userId: user._id,
      score: args.score,
      percentage: args.percentage,
      timeSpent: args.timeSpent,
      submittedAt: Date.now(),
    });

    // Gather all participants: creator + everyone in challengeParticipants
    const participants = await ctx.runQuery(internal.challenges.internal.getParticipantsByChallenge, {
      challengeId: args.challengeId,
    });
    const allParticipantIds = [challenge.creatorId, ...participants.map(p => p.userId)];

    const results = await ctx.runQuery(internal.challenges.internal.getResultsByChallenge, {
      challengeId: args.challengeId,
    });
    const submittedUserIds = results.map(r => r.userId);
    const allSubmitted = allParticipantIds.every(id => submittedUserIds.includes(id));

    if (allSubmitted && results.length >= allParticipantIds.length) {
      // Determine winner – highest percentage, then score, then time
      const sorted = [...results].sort((a, b) => {
        if (a.percentage !== b.percentage) return b.percentage - a.percentage;
        if (a.score !== b.score) return b.score - a.score;
        return a.timeSpent - b.timeSpent;
      });
      const winnerId = sorted[0].userId;
      await ctx.runMutation(internal.challenges.internal.updateChallengeStatus, {
        id: args.challengeId,
        status: "completed",
        winnerId,
      });
    }

    return { success: true, data: { message: "Result submitted." } };
  },
});

// ── Update username ──
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

// ── Ping (online presence) ──
export const ping = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await verifyTokenAndGetUser(ctx, args.token);
    await ctx.runMutation(internal.challenges.internal.updateUserLastSeen, { userId: user._id });
    return { success: true };
  },
});