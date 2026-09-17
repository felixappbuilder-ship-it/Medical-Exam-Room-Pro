// convex/challenges/internal.ts
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ============================================================
// 1. CREATE CHALLENGE
// ============================================================
export const createChallenge = internalMutation({
  args: {
    challengeCode: v.string(),
    creatorId: v.id("users"),
    blob: v.string(),
    maxParticipants: v.number(),
    participantCount: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("challenges", {
      ...args,
      status: "created",
    });
    return id;
  },
});

// ============================================================
// 2. QUERY CHALLENGE BY CODE
// ============================================================
export const getChallengeByCode = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("challenges")
      .withIndex("by_code", (q) => q.eq("challengeCode", args.code))
      .first();
  },
});

// ============================================================
// 3. QUERY CHALLENGE BY ID
// ============================================================
export const getChallengeById = internalQuery({
  args: { id: v.id("challenges") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ============================================================
// 4. UPDATE CHALLENGE STATUS
// ============================================================
export const updateChallengeStatus = internalMutation({
  args: {
    id: v.id("challenges"),
    status: v.union(
      v.literal("created"),
      v.literal("waiting"),
      v.literal("ready"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("archived")
    ),
    winnerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const updates: any = { status: args.status };
    if (args.winnerId !== undefined) updates.winnerId = args.winnerId;
    await ctx.db.patch(args.id, updates);
  },
});

// ============================================================
// 5. CREATE RESULT (alias: insertResult for compatibility)
// ============================================================
export const createResult = internalMutation({
  args: {
    challengeId: v.id("challenges"),
    userId: v.id("users"),
    score: v.number(),
    percentage: v.number(),
    timeSpent: v.number(),
    submittedAt: v.number(),
    difficultyFactor: v.optional(v.number()),
    totalQuestions: v.optional(v.number()),
    pr: v.optional(v.number()),
    ratingBefore: v.optional(v.number()),
    ratingAfter: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("results", {
      challengeId: args.challengeId,
      userId: args.userId,
      score: args.score,
      percentage: args.percentage,
      timeSpent: args.timeSpent,
      submittedAt: args.submittedAt,
      difficultyFactor: args.difficultyFactor,
      totalQuestions: args.totalQuestions,
      pr: args.pr,
      ratingBefore: args.ratingBefore,
      ratingAfter: args.ratingAfter,
    });
    return id;
  },
});

// Alias for createResult
export const insertResult = createResult;

// ============================================================
// 6. GET RESULT BY CHALLENGE AND USER
// ============================================================
export const getResultByChallengeAndUser = internalQuery({
  args: { challengeId: v.id("challenges"), userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("results")
      .withIndex("by_challenge", (q) => q.eq("challengeId", args.challengeId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();
  },
});

// ============================================================
// 7. GET RESULTS BY CHALLENGE ID
// ============================================================
export const getResultsByChallengeId = internalQuery({
  args: { challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("results")
      .withIndex("by_challenge", (q) => q.eq("challengeId", args.challengeId))
      .collect();
  },
});

// ============================================================
// 8. GET CHALLENGES BY STATUS AND CREATED AT (for cron)
// ============================================================
export const getChallengesByStatusAndCreatedAt = internalQuery({
  args: { status: v.string(), olderThan: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("challenges")
      .withIndex("by_status_expires", (q) => q.eq("status", args.status))
      .filter((q) => q.lt(q.field("createdAt"), args.olderThan))
      .collect();
  },
});

// ============================================================
// 9. GET PARTICIPANTS BY CHALLENGE ID
// ============================================================
export const getParticipantsByChallengeId = internalQuery({
  args: { challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challengeId", (q) => q.eq("challengeId", args.challengeId))
      .collect();
  },
});

// ============================================================
// 10. GET PARTICIPANTS WITH DETAILS (user data + results)
// ============================================================
export const getParticipantsWithDetails = internalQuery({
  args: { challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    const participants = await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challengeId", (q) => q.eq("challengeId", args.challengeId))
      .collect();
    const results = await ctx.db
      .query("results")
      .withIndex("by_challenge", (q) => q.eq("challengeId", args.challengeId))
      .collect();

    const userMap = new Map();
    for (const p of participants) {
      const user = await ctx.db.get(p.userId);
      if (user) userMap.set(user._id, user);
    }

    const list = participants.map((p) => {
      const user = userMap.get(p.userId);
      const result = results.find((r) => r.userId === p.userId);
      return {
        userId: p.userId,
        displayName: user?.displayName || user?.username || "Unknown",
        rating: user?.rating || 100,
        historyEWMA: user?.historyEWMA || 0.5,
        completedExams: user?.completedExams || 0,
        startedExams: user?.startedExams || 0,
        leaderboardPoints: user?.leaderboardPoints || 0,
        score: result?.score || 0,
        percentage: result?.percentage || 0,
        timeSpent: result?.timeSpent || 0,
        submittedAt: result?.submittedAt || null,
        difficultyFactor: result?.difficultyFactor || null,
        totalQuestions: result?.totalQuestions || null,
        submitted: !!result,
        pr: result?.pr || null,
        ratingBefore: result?.ratingBefore || null,
        ratingAfter: result?.ratingAfter || null,
      };
    });
    return list;
  },
});

// ============================================================
// 11. GET CHALLENGE PARTICIPANTS (alias)
// ============================================================
export const getChallengeParticipants = getParticipantsByChallengeId;

// ============================================================
// 12. CREATE INVITATION
// ============================================================
export const createInvitation = internalMutation({
  args: {
    challengeId: v.id("challenges"),
    inviterId: v.id("users"),
    inviteeEmail: v.string(),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("invitations", {
      ...args,
      status: "pending",
      createdAt: Date.now(),
    });
    return id;
  },
});

// ============================================================
// 13. GET INVITATION BY TOKEN
// ============================================================
export const getInvitationByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
  },
});

// ============================================================
// 14. UPDATE INVITATION STATUS
// ============================================================
export const updateInvitationStatus = internalMutation({
  args: {
    id: v.id("invitations"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status });
  },
});

// ============================================================
// 15. GET EXPIRED CHALLENGES (for cron cleanup)
// ============================================================
export const getExpiredChallenges = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("challenges")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", "waiting").lt("expiresAt", args.now)
      )
      .collect();
  },
});

// ============================================================
// 16. ARCHIVE CHALLENGE
// ============================================================
export const archiveChallenge = internalMutation({
  args: { id: v.id("challenges") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: "archived" });
  },
});

// ============================================================
// 17. GET USER BY EMAIL
// ============================================================
export const getUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});

// ============================================================
// 18. GET USER BY USERNAME
// ============================================================
export const getUserByUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
  },
});

// ============================================================
// 19. UPDATE USER LAST SEEN (online status)
// ============================================================
export const updateUserLastSeen = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      lastSeen: Date.now(),
      status: "online",
    });
  },
});

// ============================================================
// 20. GENERATE UNIQUE USERNAME
// ============================================================
export const generateUniqueUsername = internalMutation({
  args: { baseName: v.string() },
  handler: async (ctx, args) => {
    let candidate = args.baseName.replace(/\s+/g, "");
    let attempts = 0;
    while (attempts < 20) {
      const existing = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", candidate))
        .first();
      if (!existing) return candidate;
      const digits = Math.floor(100 + Math.random() * 900).toString().slice(0, 3);
      candidate = args.baseName.replace(/\s+/g, "") + digits;
      attempts++;
    }
    return args.baseName.replace(/\s+/g, "") + Date.now().toString().slice(-4);
  },
});

// ============================================================
// 21. GET ONLINE USERS
// ============================================================
export const getOnlineUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    return await ctx.db
      .query("users")
      .filter((q) =>
        q.and(
          q.gt(q.field("lastSeen"), fiveMinAgo),
          q.eq(q.field("status"), "online")
        )
      )
      .collect();
  },
});

// ============================================================
// 22. GET CHALLENGES BY USER (uses participants table)
// ============================================================
export const getChallengesByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const participantRecords = await ctx.db
      .query("challengeParticipants")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const challengeIds = participantRecords.map((p) => p.challengeId);

    const created = await ctx.db
      .query("challenges")
      .withIndex("by_creator", (q) => q.eq("creatorId", args.userId))
      .collect();

    const allChallenges = [...created];
    for (const id of challengeIds) {
      if (!allChallenges.some((c) => c._id === id)) {
        const challenge = await ctx.db.get(id);
        if (challenge) allChallenges.push(challenge);
      }
    }

    return allChallenges;
  },
});

// ============================================================
// 23. ADD PARTICIPANT
// ============================================================
export const addParticipant = internalMutation({
  args: {
    challengeId: v.id("challenges"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challengeId_userId", (q) =>
        q.eq("challengeId", args.challengeId).eq("userId", args.userId)
      )
      .first();
    if (existing) return;

    const challenge = await ctx.db.get(args.challengeId);
    if (!challenge) throw new Error("Challenge not found");
    if (challenge.participantCount >= challenge.maxParticipants) {
      throw new Error("Challenge is full");
    }

    await ctx.db.insert("challengeParticipants", {
      challengeId: args.challengeId,
      userId: args.userId,
      joinedAt: Date.now(),
    });
    await ctx.db.patch(args.challengeId, {
      participantCount: (challenge.participantCount || 0) + 1,
    });
  },
});

// ============================================================
// 24. GET PARTICIPANT BY CHALLENGE AND USER
// ============================================================
export const getParticipantByChallengeAndUser = internalQuery({
  args: {
    challengeId: v.id("challenges"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challengeId_userId", (q) =>
        q.eq("challengeId", args.challengeId).eq("userId", args.userId)
      )
      .first();
  },
});

// ============================================================
// 25. SEND CHAT MESSAGE
// ============================================================
export const sendChatMessage = internalMutation({
  args: {
    challengeId: v.id("challenges"),
    userId: v.id("users"),
    author: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("chatMessages", {
      challengeId: args.challengeId,
      userId: args.userId,
      author: args.author,
      body: args.body,
      createdAt: Date.now(),
    });
    return id;
  },
});

// ============================================================
// 26. GET CHAT MESSAGES SINCE TIMESTAMP
// ============================================================
export const getChatMessagesSince = internalQuery({
  args: {
    challengeId: v.id("challenges"),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chatMessages")
      .withIndex("by_challengeId_createdAt", (q) =>
        q.eq("challengeId", args.challengeId).gt("createdAt", args.since)
      )
      .order("asc")
      .collect();
  },
});

// ============================================================
// 27. GET ROOM PARTICIPANT DETAILS (deduplicated count)
// ============================================================
export const getRoomParticipantDetails = internalQuery({
  args: { challengeId: v.id("challenges") },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.get(args.challengeId);
    if (!challenge) throw new Error("Challenge not found");

    const participantRows = await ctx.db
      .query("challengeParticipants")
      .withIndex("by_challengeId", (q) => q.eq("challengeId", args.challengeId))
      .collect();

    const userIdSet = new Set(participantRows.map(p => p.userId));
    userIdSet.add(challenge.creatorId);

    const userIds = Array.from(userIdSet);

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const onlineUsers: string[] = [];
    let creatorName = "Unknown";

    for (const uid of userIds) {
      const user = await ctx.db.get(uid);
      if (!user) continue;
      if (uid === challenge.creatorId) {
        creatorName = user.displayName || user.username || "Unknown";
      }
      if (user.lastSeen && user.lastSeen > fiveMinAgo) {
        const name = user.displayName || user.username;
        if (name && !onlineUsers.includes(name)) {
          onlineUsers.push(name);
        }
      }
    }

    return {
      count: userIds.length,
      creator: creatorName,
      onlineUsers,
    };
  },
});

// ============================================================
// 28. CLEANUP OLD CHAT MESSAGES (2 hours)
// ============================================================
export const cleanupOldChatMessages = internalMutation({
  args: { olderThan: v.number() },
  handler: async (ctx, args) => {
    const oldMessages = await ctx.db
      .query("chatMessages")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", args.olderThan))
      .collect();
    for (const msg of oldMessages) {
      await ctx.db.delete(msg._id);
    }
    return oldMessages.length;
  },
});

// ============================================================
// 29. UPDATE USER PERFORMANCE (rating, history, points)
// ============================================================
export const updateUserPerformance = internalMutation({
  args: {
    userId: v.id("users"),
    rating: v.number(),
    historyEWMA: v.number(),
    completedExams: v.number(),
    startedExams: v.number(),
    leaderboardPoints: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: any = {
      rating: args.rating,
      historyEWMA: args.historyEWMA,
      completedExams: args.completedExams,
      startedExams: args.startedExams,
    };
    if (args.leaderboardPoints !== undefined) {
      updates.leaderboardPoints = args.leaderboardPoints;
    }
    await ctx.db.patch(args.userId, updates);
  },
});

// ============================================================
// 30. SET CHALLENGE WINNER AND AWARD POINTS
// ============================================================
export const setChallengeWinner = internalMutation({
  args: {
    challengeId: v.id("challenges"),
    winnerId: v.id("users"),
    pointsAwarded: v.number(),
  },
  handler: async (ctx, args) => {
    // Update challenge with winner
    await ctx.db.patch(args.challengeId, { winnerId: args.winnerId });

    // Increment leaderboard points for winner
    const user = await ctx.db.get(args.winnerId);
    if (user) {
      const currentPoints = user.leaderboardPoints || 0;
      await ctx.db.patch(args.winnerId, {
        leaderboardPoints: currentPoints + args.pointsAwarded,
      });
    }
  },
});