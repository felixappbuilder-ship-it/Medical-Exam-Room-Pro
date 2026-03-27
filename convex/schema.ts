import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------
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
    devices: v.array(
      v.object({
        fingerprint: v.string(),
        lastUsed: v.number(),
        platform: v.string(),
        lastIp: v.optional(v.string()),
      })
    ),
    preferences: v.object({
      theme: v.union(v.literal("auto"), v.literal("light"), v.literal("dark")),
      notifications: v.boolean(),
    }),
    createdAt: v.number(),
    lastLogin: v.number(),
    isLocked: v.boolean(),
    lockReason: v.optional(v.string()),
    role: v.union(v.literal("user"), v.literal("admin")),
    trialUsed: v.boolean(),
    institution: v.optional(v.string()),
    yearOfStudy: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_phone", ["phone"]),

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------
  subscriptions: defineTable({
    userId: v.id("users"),
    plan: v.union(
      v.literal("trial"),
      v.literal("monthly"),
      v.literal("quarterly"),
      v.literal("yearly")
    ),
    startDate: v.number(),
    expiryDate: v.number(),
    isActive: v.boolean(),
    autoRenew: v.boolean(),
    paymentHistory: v.array(v.id("payments")),
  })
    .index("by_userId", ["userId"])
    .index("by_expiryDate", ["expiryDate"]),

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------
  payments: defineTable({
    userId: v.id("users"),
    subscriptionId: v.optional(v.id("subscriptions")),
    amount: v.number(),
    currency: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("refunded")
    ),
    mpesaReceipt: v.optional(v.string()),
    phoneNumber: v.string(),
    transactionId: v.string(),
    merchantRequestId: v.optional(v.string()),
    checkoutRequestId: v.optional(v.string()),
    resultCode: v.optional(v.number()),
    resultDesc: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
  })
    .index("by_userId", ["userId"])
    .index("by_transactionId", ["transactionId"])
    .index("by_mpesaReceipt", ["mpesaReceipt"])
    .index("by_merchantRequestId", ["merchantRequestId"])
    .index("by_checkoutRequestId", ["checkoutRequestId"]),

  // -------------------------------------------------------------------------
  // Questions
  // -------------------------------------------------------------------------
  questions: defineTable({
    id: v.string(), // original ID from JSON
    subject: v.string(),
    topic: v.string(),
    question: v.string(),
    options: v.array(v.string()),
    correct: v.string(),
    explanation: v.string(),
    difficulty: v.number(),
    image: v.optional(v.string()),
  })
    .index("by_originalId", ["id"])   // Changed from "by_id" to "by_originalId"
    .index("by_subject", ["subject"])
    .index("by_topic", ["topic"])
    .index("by_subject_topic", ["subject", "topic"]),

  // -------------------------------------------------------------------------
  // SeenQuestions
  // -------------------------------------------------------------------------
  seenQuestions: defineTable({
    userId: v.id("users"),
    subject: v.string(),
    topic: v.string(),
    questionIds: v.array(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_user_subject_topic", ["userId", "subject", "topic"]),

  // -------------------------------------------------------------------------
  // ExamResults
  // -------------------------------------------------------------------------
  examResults: defineTable({
    examId: v.string(),
    userId: v.id("users"),
    subject: v.string(),
    mode: v.string(),
    date: v.number(),
    totalQuestions: v.number(),
    correctAnswers: v.number(),
    timeSpent: v.number(),
    questions: v.array(
      v.object({
        questionId: v.string(),
        userAnswer: v.optional(v.string()),
        timeSpent: v.number(),
        flagged: v.boolean(),
        correct: v.boolean(),
      })
    ),
    topicPerformance: v.array(
      v.object({
        topic: v.string(),
        correct: v.number(),
        total: v.number(),
        avgTime: v.number(),
      })
    ),
    weakAreas: v.array(v.string()),
  })
    .index("by_examId", ["examId"])
    .index("by_userId", ["userId"])
    .index("by_date", ["date"]),

  // -------------------------------------------------------------------------
  // Notes
  // -------------------------------------------------------------------------
  notes: defineTable({
    userId: v.id("users"),
    title: v.string(),
    content: v.string(),
    plainText: v.string(),
    subject: v.optional(v.string()),
    topic: v.optional(v.string()),
    questionId: v.optional(v.string()),
    tags: v.array(v.string()),
    attachments: v.array(
      v.object({
        type: v.string(),
        storageId: v.id("_storage"),
        name: v.string(),
      })
    ),
    flashcards: v.array(
      v.object({
        front: v.string(),
        back: v.string(),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastReviewed: v.optional(v.number()),
    reviewCount: v.number(),
    shareWith: v.array(v.string()),
    sharedPublic: v.boolean(),
    sharedToken: v.optional(v.string()),
    isProtected: v.boolean(),
    passwordHash: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_subject", ["subject"])
    .index("by_topic", ["topic"])
    .index("by_sharedToken", ["sharedToken"]),

  // -------------------------------------------------------------------------
  // Conversations
  // -------------------------------------------------------------------------
  conversations: defineTable({
    userId: v.id("users"),
    title: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("ai")),
        content: v.string(),
        timestamp: v.number(),
        references: v.optional(
          v.array(
            v.object({
              book: v.string(),
              page: v.optional(v.number()),
            })
          )
        ),
        rating: v.optional(v.string()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_updatedAt", ["updatedAt"]),

  // -------------------------------------------------------------------------
  // SharedLinks
  // -------------------------------------------------------------------------
  sharedLinks: defineTable({
    token: v.string(),
    type: v.union(v.literal("note"), v.literal("conversation"), v.literal("exam")),
    targetId: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_token", ["token"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_target", ["type", "targetId"]),

  // -------------------------------------------------------------------------
  // SecurityEvents
  // -------------------------------------------------------------------------
  securityEvents: defineTable({
    userId: v.optional(v.id("users")),
    type: v.string(),
    details: v.any(),
    timestamp: v.number(),
    resolved: v.boolean(),
  })
    .index("by_userId", ["userId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_type", ["type"]),

  // -------------------------------------------------------------------------
  // AuditLogs
  // -------------------------------------------------------------------------
  auditLogs: defineTable({
    adminId: v.id("users"),
    action: v.string(),
    targetId: v.optional(v.string()),
    details: v.any(),
    timestamp: v.number(),
  })
    .index("by_adminId", ["adminId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_targetId", ["targetId"]),

  // -------------------------------------------------------------------------
  // AppConfig (singleton)
  // -------------------------------------------------------------------------
  appConfig: defineTable({
    trialDuration: v.number(),
    plans: v.array(
      v.object({
        id: v.union(v.literal("monthly"), v.literal("quarterly"), v.literal("yearly")),
        price: v.number(),
        durationDays: v.number(),
      })
    ),
    systemLocked: v.boolean(),
    maintenanceMode: v.boolean(),
    paymentsFrozen: v.boolean(),
  }),
});