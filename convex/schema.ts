// convex/schema.ts – final, with multi‑participant challenges, chat, moods, payments, referrals, AI memory (chunks + summaries), notifications, and performance tracking
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ============================================================
  // Users – enhanced for frontend models, challenge system, referrals, and performance
  // ============================================================
  users: defineTable({
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    passwordHash: v.string(),
    securityQuestions: v.array(
      v.object({
        question: v.string(),
        answerHash: v.string(),
      })
    ),
    isLocked: v.boolean(),
    lockReason: v.optional(v.string()),
    trialUsed: v.boolean(),
    devices: v.array(
      v.object({
        fingerprint: v.string(),
        lastUsed: v.number(),
        platform: v.optional(v.string()),
      })
    ),
    deviceFingerprint: v.optional(v.string()),
    institution: v.optional(v.string()),
    yearOfStudy: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    lastLogin: v.optional(v.number()),
    preferences: v.optional(
      v.object({
        theme: v.optional(v.string()),
        notifications: v.optional(
          v.object({
            examReminders: v.optional(v.boolean()),
            subscriptionExpiry: v.optional(v.boolean()),
            newFeatures: v.optional(v.boolean()),
          })
        ),
        dataUsage: v.optional(
          v.object({
            syncOnMobile: v.optional(v.boolean()),
            downloadImages: v.optional(v.string()),
            cacheSize: v.optional(v.string()),
          })
        ),
      })
    ),
    role: v.optional(v.string()),
    username: v.string(),
    displayName: v.string(),
    lastSeen: v.optional(v.number()),
    status: v.optional(v.union(v.literal("online"), v.literal("offline"))),
    // Session management fields
    activeSessionId: v.optional(v.string()),
    activeDeviceId: v.optional(v.string()),
    // Referral system fields
    referralCode: v.string(),
    referredBy: v.optional(v.id("users")),
    isAgent: v.boolean(),
    agentVerified: v.optional(v.boolean()),
    referralBalance: v.number(),
    totalEarned: v.number(),
    pendingBalance: v.number(),
    referralRewarded: v.optional(v.boolean()),
    lastExamEncouragementSentAt: v.optional(v.number()),
    examEncouragementOptOut: v.optional(v.boolean()),
    // ✅ NEW: Performance tracking fields
    rating: v.optional(v.number()),            // default 100
    historyEWMA: v.optional(v.number()),       // default 0.5
    completedExams: v.optional(v.number()),    // default 0
    startedExams: v.optional(v.number()),      // default 0
    leaderboardPoints: v.optional(v.number()), // default 0
    integrityScore: v.optional(v.number()),    // default 1
  })
    .index("by_email", ["email"])
    .index("by_phone", ["phone"])
    .index("by_username", ["username"])
    .index("by_activeSessionId", ["activeSessionId"])
    .index("by_referralCode", ["referralCode"])
    .index("by_referredBy", ["referredBy"]),

  // ============================================================
  // Sessions – for device session management (single-device enforcement)
  // ============================================================
  sessions: defineTable({
    sessionId: v.string(),
    userId: v.id("users"),
    deviceId: v.string(),
    deviceFingerprint: v.optional(v.string()),
    platform: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    lastSeen: v.number(),
    revoked: v.boolean(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_userId", ["userId"])
    .index("by_deviceId", ["deviceId"])
    .index("by_expiresAt", ["expiresAt"]),

  // ============================================================
  // Payments – extended for Buy Goods hybrid payment engine + financial ledger
  // ============================================================
  payments: defineTable({
    transactionId: v.string(),
    mpesaReceipt: v.optional(v.string()),
    merchantRequestId: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("expired"),
      v.literal("claimed"),
      v.literal("reversed")
    ),
    amount: v.number(),
    userId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
    mpesaCode: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    checkoutRequestId: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    claimedByUserId: v.optional(v.id("users")),
  })
    .index("by_transactionId", ["transactionId"])
    .index("by_merchantRequestId", ["merchantRequestId"])
    .index("by_userId_status", ["userId", "status"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_mpesaCode", ["mpesaCode"])
    .index("by_phoneNumber_status", ["phoneNumber", "status"])
    .index("by_checkoutRequestId", ["checkoutRequestId"]),

  // ============================================================
  // Payment Events (immutable audit trail)
  // ============================================================
  paymentEvents: defineTable({
    paymentId: v.optional(v.id("payments")),
    source: v.string(),
    eventType: v.string(),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_paymentId", ["paymentId"])
    .index("by_eventType", ["eventType"])
    .index("by_createdAt", ["createdAt"]),

  // ============================================================
  // B2C Transactions (disbursements)
  // ============================================================
  b2cTransactions: defineTable({
    userId: v.id("users"),
    transactionId: v.string(),
    originatorConversationID: v.string(),
    conversationID: v.optional(v.string()),
    amount: v.number(),
    phoneNumber: v.string(),
    status: v.union(v.literal("pending"), v.literal("processing"), v.literal("completed"), v.literal("failed")),
    requestPayload: v.any(),
    responsePayload: v.optional(v.any()),
    resultPayload: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_originatorConversationID", ["originatorConversationID"])
    .index("by_status", ["status"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // ============================================================
  // Account Balance Queries
  // ============================================================
  balanceQueries: defineTable({
    userId: v.id("users"),
    originatorConversationID: v.string(),
    conversationID: v.optional(v.string()),
    shortcode: v.string(),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    result: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_originatorConversationID", ["originatorConversationID"])
    .index("by_status", ["status"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // ============================================================
  // Transaction Status Queries
  // ============================================================
  statusQueries: defineTable({
    userId: v.id("users"),
    originatorConversationID: v.string(),
    conversationID: v.optional(v.string()),
    transactionID: v.optional(v.string()),
    partyA: v.string(),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    result: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_originatorConversationID", ["originatorConversationID"])
    .index("by_status", ["status"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // ============================================================
  // Reversals (refunds)
  // ============================================================
  reversals: defineTable({
    paymentId: v.id("payments"),
    userId: v.id("users"),
    originatorConversationID: v.string(),
    conversationID: v.optional(v.string()),
    transactionID: v.string(),
    amount: v.number(),
    reason: v.string(),
    status: v.union(v.literal("requested"), v.literal("processing"), v.literal("completed"), v.literal("failed")),
    requestPayload: v.any(),
    responsePayload: v.optional(v.any()),
    resultPayload: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_paymentId", ["paymentId"])
    .index("by_userId", ["userId"])
    .index("by_originatorConversationID", ["originatorConversationID"])
    .index("by_status", ["status"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // ============================================================
  // Webhook Logs (for debugging and audit)
  // ============================================================
  webhookLogs: defineTable({
    source: v.string(),
    payload: v.any(),
    headers: v.any(),
    response: v.optional(v.any()),
    status: v.number(),
    createdAt: v.number(),
  })
    .index("by_source", ["source"])
    .index("by_createdAt", ["createdAt"]),

  // ============================================================
  // Wallets (for referrals, agents, commissions, bonuses)
  // ============================================================
  wallets: defineTable({
    userId: v.id("users"),
    balance: v.number(),
    totalEarned: v.number(),
    pendingBalance: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"]),

  walletTransactions: defineTable({
    walletId: v.id("wallets"),
    userId: v.id("users"),
    type: v.union(v.literal("credit"), v.literal("debit")),
    amount: v.number(),
    source: v.string(),
    reference: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_walletId", ["walletId"])
    .index("by_userId", ["userId"]),

  // ============================================================
  // Questions – unchanged
  // ============================================================
  questions: defineTable({
    text: v.string(),
    options: v.array(
      v.object({
        letter: v.union(v.literal("A"), v.literal("B"), v.literal("C"), v.literal("D"), v.literal("E")),
        text: v.string(),
      })
    ),
    correct: v.string(),
    explanation: v.string(),
    difficulty: v.number(),
    category: v.string(),
    embedding: v.array(v.float64()),
  })
    .index("by_category_difficulty", ["category", "difficulty"])
    .vectorIndex("by_embedding", {
      dimensions: 1536,
      vectorField: "embedding",
    }),

  // ============================================================
  // examResults – stores full questions array
  // ============================================================
  examResults: defineTable({
    userId: v.id("users"),
    examId: v.string(),
    score: v.number(),
    topicPerformance: v.array(
      v.object({
        topic: v.string(),
        score: v.number(),
        timePerQuestion: v.number(),
      })
    ),
    weakAreas: v.array(v.string()),
    createdAt: v.number(),
    subject: v.optional(v.string()),
    mode: v.optional(v.string()),
    date: v.optional(v.string()),
    totalQuestions: v.optional(v.number()),
    correctAnswers: v.optional(v.number()),
    scorePercentage: v.optional(v.number()),
    timeSpent: v.optional(v.number()),
    averageTimePerQuestion: v.optional(v.number()),
    questions: v.optional(v.array(v.any())),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_examId", ["userId", "examId"])
    .index("by_createdAt", ["createdAt"]),

  // ============================================================
  // appConfig – unchanged
  // ============================================================
  appConfig: defineTable({
    trialDurationHours: v.number(),
    maintenanceMode: v.boolean(),
    subscriptionPlans: v.array(
      v.object({
        name: v.string(),
        price: v.number(),
        days: v.number(),
      })
    ),
    paymentsFrozen: v.boolean(),
    maxRequestsPerMinute: v.number(),
    autoApproveWithdrawals: v.optional(v.boolean()),
    // ✅ NEW: Points awarded to challenge winner
    challengeWinnerPoints: v.optional(v.number()),
  }),

  // ============================================================
  // seenQuestions – unchanged
  // ============================================================
  seenQuestions: defineTable({
    userId: v.id("users"),
    subject: v.string(),
    topic: v.string(),
    questionIds: v.array(v.string()),
  }).index("by_user_subject_topic", ["userId", "subject", "topic"]),

  // ============================================================
  // messages – DEPRECATED: use conversation_chunks instead (kept for compatibility)
  // ============================================================
  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.number(),
  }).index("by_conversationId_timestamp", ["conversationId", "timestamp"]),

  // ============================================================
  // examAnswers – unchanged
  // ============================================================
  examAnswers: defineTable({
    examResultId: v.id("examResults"),
    questionId: v.string(),
    selectedAnswer: v.string(),
    isCorrect: v.boolean(),
    timeSpent: v.number(),
  }).index("by_examResultId", ["examResultId"]),

  // ============================================================
  // devices – unchanged
  // ============================================================
  devices: defineTable({
    userId: v.id("users"),
    fingerprint: v.string(),
    lastUsed: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_fingerprint", ["fingerprint"]),

  // ============================================================
  // securityEvents – temporary with old fields
  // ============================================================
  securityEvents: defineTable({
    userId: v.optional(v.any()),
    eventType: v.optional(v.any()),
    timestamp: v.optional(v.any()),
    metadata: v.optional(v.any()),
    type: v.optional(v.any()),
    details: v.optional(v.any()),
    resolved: v.optional(v.any()),
  })
    .index("by_userId_timestamp", ["userId", "timestamp"])
    .index("by_eventType_timestamp", ["eventType", "timestamp"]),

  // ============================================================
  // sharedLinks – includes userId for ownership
  // ============================================================
  sharedLinks: defineTable({
    userId: v.id("users"),
    targetType: v.union(v.literal("examResult"), v.literal("note"), v.literal("conversation")),
    targetId: v.string(),
    token: v.string(),
    expiry: v.number(),
    passwordHash: v.optional(v.string()),
  })
    .index("by_token", ["token"])
    .index("by_expiry", ["expiry"])
    .index("by_user_target", ["userId", "targetType"]),

  // ============================================================
  // conversations – unchanged (metadata only)
  // ============================================================
  conversations: defineTable({
    userId: v.id("users"),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_updatedAt", ["userId", "updatedAt"])
    .index("by_createdAt", ["createdAt"]),

  // ============================================================
  // subscriptions – extended with autoRenew, paymentMethod, etc., plus updatedAt
  // ============================================================
  subscriptions: defineTable({
    userId: v.id("users"),
    plan: v.string(),
    startDate: v.number(),
    expiryDate: v.number(),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled")),
    autoRenew: v.optional(v.boolean()),
    paymentMethod: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
    lastPaymentDate: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_expiryDate", ["expiryDate"])
    .index("by_status_expiryDate", ["status", "expiryDate"]),

  // ============================================================
  // notes – extended with all frontend fields + clientId
  // ============================================================
  notes: defineTable({
    userId: v.id("users"),
    title: v.string(),
    content: v.string(),
    plainText: v.string(),
    isProtected: v.boolean(),
    passwordHash: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    subject: v.optional(v.string()),
    topic: v.optional(v.string()),
    questionId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    attachments: v.optional(
      v.array(
        v.object({
          type: v.string(),
          url: v.string(),
          name: v.string(),
        })
      )
    ),
    flashcards: v.optional(
      v.array(
        v.object({
          front: v.string(),
          back: v.string(),
        })
      )
    ),
    shareWith: v.optional(v.array(v.id("users"))),
    sharedPublic: v.optional(v.boolean()),
    sharedToken: v.optional(v.string()),
    lastReviewed: v.optional(v.number()),
    reviewCount: v.optional(v.number()),
    clientId: v.optional(v.string()),
  })
    .index("by_userId_updatedAt", ["userId", "updatedAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_subject", ["subject"])
    .index("by_topic", ["topic"]),

  // ============================================================
  // Notifications – global/group and user-specific
  // ============================================================
  notifications: defineTable({
    userId: v.optional(v.id("users")), // null for global/group
    targetAll: v.optional(v.boolean()),
    targetGroups: v.optional(v.array(v.string())),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    createdAt: v.number(),
    senderId: v.optional(v.id("users")),
  })
    .index("by_userId", ["userId"])
    .index("by_targetAll", ["targetAll"])
    .index("by_createdAt", ["createdAt"]),

  notificationReads: defineTable({
    notificationId: v.id("notifications"),
    userId: v.id("users"),
    read: v.boolean(),
    readAt: v.optional(v.number()),
  })
    .index("by_notificationId", ["notificationId"])
    .index("by_userId", ["userId"])
    .index("by_notificationId_userId", ["notificationId", "userId"]),

  // ============================================================
  // auditLogs – unchanged
  // ============================================================
  auditLogs: defineTable({
    actorId: v.string(),
    action: v.string(),
    targetId: v.optional(v.string()),
    timestamp: v.number(),
    details: v.any(),
  })
    .index("by_actorId_timestamp", ["actorId", "timestamp"])
    .index("by_action_timestamp", ["action", "timestamp"])
    .index("by_timestamp", ["timestamp"]),

  // ============================================================
  // rateLimit – unchanged
  // ============================================================
  rateLimit: defineTable({
    key: v.string(),
    endpoint: v.string(),
    count: v.number(),
    resetAt: v.number(),
  })
    .index("by_key_endpoint", ["key", "endpoint"])
    .index("by_resetAt", ["resetAt"]),

  // ============================================================
  // resources – uses R2
  // ============================================================
  resources: defineTable({
    title: v.string(),
    subject: v.string(),
    category: v.string(),
    r2Key: v.string(),
    r2ThumbnailKey: v.optional(v.string()),
    fileType: v.string(),
    fileSize: v.number(),
    fileHash: v.string(),
    originalPath: v.string(),
    uploadedAt: v.number(),
    updatedAt: v.number(),
    version: v.number(),
    isActive: v.boolean(),
    tags: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    isPremium: v.optional(v.boolean()),
    downloadCount: v.optional(v.number()),
    viewCount: v.optional(v.number()),
    author: v.optional(v.string()),
    year: v.optional(v.number()),
  })
    .index("by_subject", ["subject"])
    .index("by_category", ["category"])
    .index("by_subject_category", ["subject", "category"])
    .index("by_isActive", ["isActive"])
    .index("by_fileHash", ["fileHash"])
    .index("by_originalPath", ["originalPath"]),

  // ============================================================
  // sharedExams – unchanged
  // ============================================================
  sharedExams: defineTable({
    token: v.string(),
    examData: v.any(),
    userId: v.id("users"),
    createdAt: v.number(),
    expiry: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_expiry", ["expiry"]),

  // ============================================================
  // Challenges – updated for multi‑participant (up to 100)
  // ============================================================
  challenges: defineTable({
    challengeCode: v.string(),
    creatorId: v.id("users"),
    status: v.union(
      v.literal("created"),
      v.literal("waiting"),
      v.literal("ready"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("archived")
    ),
    blob: v.string(),
    maxParticipants: v.number(),
    participantCount: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    winnerId: v.optional(v.id("users")),
  })
    .index("by_code", ["challengeCode"])
    .index("by_creator", ["creatorId"])
    .index("by_status_expires", ["status", "expiresAt"]),

  // ============================================================
  // Challenge Participants – tracks all users in a challenge
  // ============================================================
  challengeParticipants: defineTable({
    challengeId: v.id("challenges"),
    userId: v.id("users"),
    joinedAt: v.number(),
  })
    .index("by_challengeId", ["challengeId"])
    .index("by_userId", ["userId"])
    .index("by_challengeId_userId", ["challengeId", "userId"]),

  // ============================================================
  // Chat Messages – persistent chat for shared rooms (2‑hour cleanup)
  // ============================================================
  chatMessages: defineTable({
    challengeId: v.id("challenges"),
    author: v.string(),
    userId: v.id("users"),
    body: v.string(),
    createdAt: v.number(),
  })
    .index("by_challengeId_createdAt", ["challengeId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  // ============================================================
  // Room Moods – community mood votes
  // ============================================================
  roomMoods: defineTable({
    challengeId: v.id("challenges"),
    userId: v.id("users"),
    mood: v.union(v.literal("easy"), v.literal("medium"), v.literal("hard"), v.literal("loving")),
    createdAt: v.number(),
  })
    .index("by_challengeId_mood", ["challengeId", "mood"]),

  // ============================================================
  // Results – challenge results (with performance fields)
  // ============================================================
  results: defineTable({
    challengeId: v.id("challenges"),
    userId: v.id("users"),
    score: v.number(),
    percentage: v.number(),
    timeSpent: v.number(),
    submittedAt: v.number(),
    // ✅ NEW: Aggregated performance data
    examResultId: v.optional(v.id("examResults")),
    difficultyFactor: v.optional(v.number()),
    totalQuestions: v.optional(v.number()),
    pr: v.optional(v.number()),
    ratingBefore: v.optional(v.number()),
    ratingAfter: v.optional(v.number()),
  })
    .index("by_challenge", ["challengeId"])
    .index("by_user", ["userId"]),

  // ============================================================
  // Invitations – friend invites
  // ============================================================
  invitations: defineTable({
    challengeId: v.id("challenges"),
    inviterId: v.id("users"),
    inviteeEmail: v.string(),
    token: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired")),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_invitee", ["inviteeEmail"])
    .index("by_challenge", ["challengeId"]),

  // ============================================================
  // Public Assets – for user manual, resources updates, and other public files
  // ============================================================
  publicAssets: defineTable({
    key: v.string(),
    r2Key: v.string(),
    version: v.number(),
    fileHash: v.string(),
    fileSize: v.number(),
    fileType: v.string(),
    uploadedAt: v.number(),
    updatedAt: v.number(),
    isActive: v.boolean(),
    description: v.optional(v.string()),
  })
    .index("by_key", ["key"])
    .index("by_isActive", ["isActive"]),

  // ============================================================
  // Withdrawals – for referral payouts
  // ============================================================
  withdrawals: defineTable({
    userId: v.id("users"),
    amount: v.number(),
    status: v.union(v.literal("pending"), v.literal("processed"), v.literal("failed")),
    method: v.string(),
    phoneNumber: v.optional(v.string()),
    reference: v.optional(v.string()),
    requestedAt: v.number(),
    processedAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    paymentMethod: v.optional(v.string()),
    paymentReference: v.optional(v.string()),
    b2cTransactionId: v.optional(v.string()),
    b2cResultCode: v.optional(v.string()),
    b2cResultDesc: v.optional(v.string()),
    processedBy: v.optional(v.id("users")),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"]),

  // ============================================================
  // CONVERSATION MEMORY – chunked storage with vector search (AI long-term memory)
  // ============================================================
  conversation_chunks: defineTable({
    conversationId: v.id("conversations"),
    chunkNumber: v.number(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        timestamp: v.number(),
      })
    ),
    tokenCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    summaryStatus: v.union(v.literal("none"), v.literal("summarized")),
    embedding: v.optional(v.array(v.float64())),
  })
    .index("by_conversationId_chunkNumber", ["conversationId", "chunkNumber"])
    .index("by_conversationId_createdAt", ["conversationId", "createdAt"])
    .vectorIndex("by_embedding", {
      dimensions: 1536,
      vectorField: "embedding",
    }),

  // ============================================================
  // SUMMARIES – compressed memory of older chunks
  // ============================================================
  summaries: defineTable({
    conversationId: v.id("conversations"),
    summaryText: v.string(),
    chunkNumbers: v.array(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_conversationId_createdAt", ["conversationId", "createdAt"]),
});