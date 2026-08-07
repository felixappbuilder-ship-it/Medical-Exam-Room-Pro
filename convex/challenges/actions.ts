// convex/challenges/actions.ts
"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import crypto from "crypto";

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
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

// =====================================================================
// 1. CREATE CHALLENGE (multi‑participant, uses Convex document ID)
// =====================================================================
export const createChallenge = action({
  args: {
    token: v.string(),
    blob: v.string(),           // opaque encoded exam configuration
  },
  handler: async (ctx, args) => {
    try {
      const user = await verifyTokenAndGetUser(ctx, args.token);
      const challengeCode = generateChallengeCode();
      const createdAt = Date.now();
      const expiresAt = createdAt + 30 * 60 * 1000; // 30 minutes

      // Insert the challenge document and obtain its Convex ID (_id)
      const challengeDocId = await ctx.runMutation(internal.challenges.internal.createChallenge, {
        challengeCode,
        creatorId: user._id,
        blob: args.blob,
        maxParticipants: 100,
        participantCount: 1,
        createdAt,
        expiresAt,
      });

      // Automatically add creator as the first participant
      await ctx.runMutation(internal.challenges.internal.addParticipant, {
        challengeId: challengeDocId,
        userId: user._id,
      });

      await ctx.runMutation(internal.challenges.internal.updateUserLastSeen, { userId: user._id });

      return {
        success: true,
        data: { code: challengeCode, expiresAt },
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

// =====================================================================
// 2. JOIN CHALLENGE (multi‑participant – uses challengeParticipants)
// =====================================================================
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
        return {
          success: false,
          error: "not_found",
          message: "Challenge not found.",
        };
      }

      const challengeDocId = challenge._id;

      // Prevent creator from joining again (should already be a participant)
      const existing = await ctx.runQuery(
        internal.challenges.internal.getParticipantByChallengeAndUser,
        { challengeId: challengeDocId, userId: user._id }
      );
      if (existing) {
        return {
          success: false,
          error: "already_joined",
          message: "You have already joined this challenge.",
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

      // Add participant and update status to ready
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
          challengeId: challengeDocId,   // Convex document ID
          status: "ready",
          blob: challenge.blob,
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

// =====================================================================
// 3. INVITE FRIEND
// =====================================================================
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

      const inviteToken = generateInviteToken();
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

      await ctx.runMutation(internal.challenges.internal.createInvitation, {
        challengeId: challenge._id,
        inviterId: user._id,
        inviteeEmail: args.friendEmail,
        token: inviteToken,
        expiresAt,
      });

      return {
        success: true,
        data: {
          inviteToken,
          inviteLink: `/pages/exam-settings.html/?exam=${inviteToken}`,
          expiresAt,
        },
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

// =====================================================================
// 4. ACCEPT INVITE (multi‑participant)
// =====================================================================
export const acceptInvite = action({
  args: {
    token: v.string(),
    inviteToken: v.string(),
  },
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

      // Check if already a participant
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

// =====================================================================
// 5. GET CHALLENGE STATUS
// =====================================================================
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

      return {
        success: true,
        data: {
          status: challenge.status,
          creator: isCreator,
          blob: challenge.blob,
          expiresAt: challenge.expiresAt,
          participantCount: challenge.participantCount,
          maxParticipants: challenge.maxParticipants,
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

// =====================================================================
// 6. GET ONLINE USERS
// =====================================================================
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

// =====================================================================
// 7. CLEANUP EXPIRED CHALLENGES (cron)
// =====================================================================
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

// =====================================================================
// 8. SEND MESSAGE (chat)
// =====================================================================
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

// =====================================================================
// 9. GET MESSAGES (chat polling)
// =====================================================================
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

// =====================================================================
// 10. GET ROOM PARTICIPANTS (used by exam-chat.js)
// =====================================================================
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

// =====================================================================
// 11. CLEANUP CHAT MESSAGES (cron – run every 30 minutes)
// =====================================================================
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