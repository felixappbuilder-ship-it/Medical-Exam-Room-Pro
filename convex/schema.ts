// convex/schema.ts — BRIDGE SCHEMA
//
// Accepts BOTH the old app-store frontend and the new one.
// All new fields are optional so existing rows continue to validate.
// Old tables (sessions, devices, deviceInfo) are kept.
// New tables (deviceIds, userDeviceInfo) are added alongside.
//
// The backend adapts old/new payloads in `convex/shared/deviceAdapter.ts`
// so every action normalises input before touching the DB.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({

  // ============================================================
  // USERS — accepts both old (fingerprint) and new (deviceId) entries
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

    // Bridge device entry — every field optional except lastUsed
    devices: v.array(
      v.object({
        fingerprint: v.optional(v.string()),   // old app-store clients
        deviceId: v.optional(v.string()),      // new clients
        displayName: v.optional(v.string()),   // new friendly label
        lastUsed: v.number(),
        platform: v.optional(v.string()),
      })
    ),

    deviceFingerprint: v.optional(v.string()), // old scalar — still accepted
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
    activeSessionId: v.optional(v.string()),
    activeDeviceId: v.optional(v.string()),
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
    rating: v.optional(v.number()),
    historyEWMA: v.optional(v.number()),
    completedExams: v.optional(v.number()),
    startedExams: v.optional(v.number()),
    leaderboardPoints: v.optional(v.number()),
    integrityScore: v.optional(v.number()),
    googleSubject: v.optional(v.string()),
    googleEmail: v.optional(v.string()),
    googlePicture: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_phone", ["phone"])
    .index("by_username", ["username"])
    .index("by_activeSessionId", ["activeSessionId"])
    .index("by_referralCode", ["referralCode"])
    .index("by_referredBy", ["referredBy"])
    .index("by_googleSubject", ["googleSubject"]),

  // ============================================================
  // AUTH IDENTITIES — multi-provider
  // ============================================================
  authIdentities: defineTable({
    userId: v.id("users"),
    provider: v.union(v.literal("password"), v.literal("google")),
    providerSubject: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.number(),
  })
    .index("by_provider_subject", ["provider", "providerSubject"])
    .index("by_userId", ["userId"])
    .index("by_userId_provider", ["userId", "provider"]),

  // ============================================================
  // SESSIONS — kept for old app-store clients
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
  // DEVICE INFO — OLD per-device shape (all fields optional).
  // Kept so old app-store clients still validate.
  // ============================================================
  deviceInfo: defineTable({
    deviceId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    info: v.optional(v.any()),
    platform: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_deviceId", ["deviceId"])
    .index("by_userId", ["userId"]),

  // ============================================================
  // ✅ NEW: DEVICE IDS — one row per user, up to N ids
  // ============================================================
  deviceIds: defineTable({
    userId: v.id("users"),
    ids: v.array(v.string()),
  })
    .index("by_userId", ["userId"]),

  // ============================================================
  // ✅ NEW: USER DEVICE INFO — one row per user, up to N JSON blobs
  // Parallel to deviceIds.ids.
  // ============================================================
  userDeviceInfo: defineTable({
    userId: v.id("users"),
    infos: v.array(v.any()),
  })
    .index("by_userId", ["userId"]),

  // ============================================================
  // PAYMENTS
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
    deviceCount: v.optional(v.number()),
    selectedPlanId: v.optional(v.string()),
  })
    .index("by_transactionId", ["transactionId"])
    .index("by_merchantRequestId", ["merchantRequestId"])
    .index("by_userId_status", ["userId", "status"])
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_mpesaCode", ["mpesaCode"])
    .index("by_phoneNumber_status", ["phoneNumber", "status"])
    .index("by_checkoutRequestId", ["checkoutRequestId"]),

  // ============================================================
  // SUBSCRIPTION DEVICES — fingerprint made optional
  // ============================================================
  subscriptionDevices: defineTable({
    subscriptionId: v.id("subscriptions"),
    userId: v.id("users"),
    deviceId: v.string(),
    deviceFingerprint: v.optional(v.string()),
    platform: v.optional(v.string()),
    isPrimary: v.boolean(),
    registeredAt: v.number(),
    lastSeen: v.number(),
    revoked: v.boolean(),
  })
    .index("by_subscriptionId", ["subscriptionId"])
    .index("by_userId", ["userId"])
    .index("by_deviceId", ["deviceId"])
    .index("by_subscriptionId_deviceId", ["subscriptionId", "deviceId"]),

  // ============================================================
  // DEVICES — legacy flat table, kept for old clients
  // ============================================================
  devices: defineTable({
    userId: v.id("users"),
    deviceId: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
    lastUsed: v.number(),
    platform: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_fingerprint", ["fingerprint"])
    .index("by_deviceId", ["deviceId"]),

  // ============================================================
  // SUBSCRIPTIONS
  // ============================================================
  subscriptions: defineTable({
    userId: v.id("users"),
    plan: v.string(),
    startDate: v.number(),
    expiryDate: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("expired"),
      v.literal("cancelled")
    ),
    autoRenew: v.optional(v.boolean()),
    paymentMethod: v.optional(v.string()),
    deviceFingerprint: v.optional(v.string()),
    lastPaymentDate: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    maxDevices: v.optional(v.number()),
    hasTwoDeviceDiscount: v.optional(v.boolean()),
  })
    .index("by_userId", ["userId"])
    .index("by_expiryDate", ["expiryDate"])
    .index("by_status_expiryDate", ["status", "expiryDate"]),

  // ============================================================
  // APP CONFIG — accepts BOTH old and new plan shapes
  // ============================================================
  appConfig: defineTable({
    trialDurationHours: v.number(),
    maintenanceMode: v.boolean(),
    paymentsFrozen: v.boolean(),
    maxRequestsPerMinute: v.number(),

    subscriptionPlans: v.array(
      v.object({
        name: v.string(),
        price: v.number(),
        days: v.number(),
        id: v.optional(v.string()),
        popular: v.optional(v.boolean()),
        features: v.optional(v.array(v.string())),
        limitations: v.optional(v.array(v.string())),
        savings: v.optional(v.string()),
        ctaText: v.optional(v.string()),
        ctaColor: v.optional(v.string()),
        durationText: v.optional(v.string()),
      })
    ),

    autoApproveWithdrawals: v.optional(v.boolean()),
    challengeWinnerPoints: v.optional(v.number()),
    twoDeviceDiscountPercent: v.optional(v.number()),
    customPenaltyPerDay: v.optional(v.number()),
    maxDevicesPerSubscription: v.optional(v.number()),
  }),

  // ============================================================
  // PAYMENT EVENTS
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
  // B2C TRANSACTIONS
  // ============================================================
  b2cTransactions: defineTable({
    userId: v.id("users"),
    transactionId: v.string(),
    originatorConversationID: v.string(),
    conversationID: v.optional(v.string()),
    amount: v.number(),
    phoneNumber: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
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
  // BALANCE QUERIES
  // ============================================================
  balanceQueries: defineTable({
    userId: v.id("users"),
    originatorConversationID: v.string(),
    conversationID: v.optional(v.string()),
    shortcode: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed")
    ),
    result: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_originatorConversationID", ["originatorConversationID"])
    .index("by_status", ["status"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // ============================================================
  // STATUS QUERIES
  // ============================================================
  statusQueries: defineTable({
    userId: v.id("users"),
    originatorConversationID: v.string(),
    conversationID: v.optional(v.string()),
    transactionID: v.optional(v.string()),
    partyA: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed")
    ),
    result: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_originatorConversationID", ["originatorConversationID"])
    .index("by_status", ["status"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  // ============================================================
  // REVERSALS
  // ============================================================
  reversals: defineTable({
    paymentId: v.id("payments"),
    userId: v.id("users"),
    originatorConversationID: v.string(),
    conversationID: v.optional(v.string()),
    transactionID: v.string(),
    amount: v.number(),
    reason: v.string(),
    status: v.union(
      v.literal("requested"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
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
  // WEBHOOK LOGS
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
  // WALLETS
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
  // QUESTIONS
  // ============================================================
  questions: defineTable({
    text: v.string(),
    options: v.array(
      v.object({
        letter: v.union(
          v.literal("A"),
          v.literal("B"),
          v.literal("C"),
          v.literal("D"),
          v.literal("E")
        ),
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
  // EXAM RESULTS
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
  // SEEN QUESTIONS
  // ============================================================
  seenQuestions: defineTable({
    userId: v.id("users"),
    subject: v.string(),
    topic: v.string(),
    questionIds: v.array(v.string()),
  }).index("by_user_subject_topic", ["userId", "subject", "topic"]),

  // ============================================================
  // MESSAGES — deprecated, kept for compatibility
  // ============================================================
  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.number(),
  }).index("by_conversationId_timestamp", ["conversationId", "timestamp"]),

  // ============================================================
  // EXAM ANSWERS
  // ============================================================
  examAnswers: defineTable({
    examResultId: v.id("examResults"),
    questionId: v.string(),
    selectedAnswer: v.string(),
    isCorrect: v.boolean(),
    timeSpent: v.number(),
  }).index("by_examResultId", ["examResultId"]),

  // ============================================================
  // SECURITY EVENTS
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
  // SHARED LINKS
  // ============================================================
  sharedLinks: defineTable({
    userId: v.id("users"),
    targetType: v.union(
      v.literal("examResult"),
      v.literal("note"),
      v.literal("conversation")
    ),
    targetId: v.string(),
    token: v.string(),
    expiry: v.number(),
    passwordHash: v.optional(v.string()),
  })
    .index("by_token", ["token"])
    .index("by_expiry", ["expiry"])
    .index("by_user_target", ["userId", "targetType"]),

  // ============================================================
  // CONVERSATIONS
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
  // NOTES
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
  // NOTIFICATIONS
  // ============================================================
  notifications: defineTable({
    userId: v.optional(v.id("users")),
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
  // AUDIT LOGS
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
  // RATE LIMIT
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
  // RESOURCES
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
  // SHARED EXAMS
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
  // CHALLENGES
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

  challengeParticipants: defineTable({
    challengeId: v.id("challenges"),
    userId: v.id("users"),
    joinedAt: v.number(),
  })
    .index("by_challengeId", ["challengeId"])
    .index("by_userId", ["userId"])
    .index("by_challengeId_userId", ["challengeId", "userId"]),

  // ============================================================
  // CHAT MESSAGES
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
  // ROOM MOODS
  // ============================================================
  roomMoods: defineTable({
    challengeId: v.id("challenges"),
    userId: v.id("users"),
    mood: v.union(
      v.literal("easy"),
      v.literal("medium"),
      v.literal("hard"),
      v.literal("loving")
    ),
    createdAt: v.number(),
  })
    .index("by_challengeId_mood", ["challengeId", "mood"]),

  // ============================================================
  // RESULTS
  // ============================================================
  results: defineTable({
    challengeId: v.id("challenges"),
    userId: v.id("users"),
    score: v.number(),
    percentage: v.number(),
    timeSpent: v.number(),
    submittedAt: v.number(),
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
  // INVITATIONS
  // ============================================================
  invitations: defineTable({
    challengeId: v.id("challenges"),
    inviterId: v.id("users"),
    inviteeEmail: v.string(),
    token: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("expired")
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_invitee", ["inviteeEmail"])
    .index("by_challenge", ["challengeId"]),

  // ============================================================
  // PUBLIC ASSETS
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
  // WITHDRAWALS
  // ============================================================
  withdrawals: defineTable({
    userId: v.id("users"),
    amount: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("processed"),
      v.literal("failed")
    ),
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
  // CONVERSATION MEMORY
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
  // SUMMARIES
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