// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Users table – Enhanced Security & Growth (Expanded Schema)
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
      })
    ),
  })
    .index("by_email", ["email"])
    .index("by_phone", ["phone"]),

  // Payments table
  payments: defineTable({
    transactionId: v.string(),
    mpesaReceipt: v.optional(v.string()),
    merchantRequestId: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"), v.literal("expired")),
    amount: v.number(),
    userId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_transactionId", ["transactionId"])
    .index("by_merchantRequestId", ["merchantRequestId"])
    .index("by_userId_status", ["userId", "status"])
    .index("by_status_createdAt", ["status", "createdAt"]),

  // Questions table – Granular Data with Vector Index
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

  // examResults table – Analytics Layer
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
  })
    .index("by_userId", ["userId"])
    .index("by_userId_examId", ["userId", "examId"])
    .index("by_createdAt", ["createdAt"]),

  // appConfig table – System Singleton
  appConfig: defineTable({
    _id: v.literal("config"),
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
  }),

  // seenQuestions table – for tracking user progress
  seenQuestions: defineTable({
    userId: v.id("users"),
    subject: v.string(),
    topic: v.string(),
    questionIds: v.array(v.string()),
  }).index("by_user_subject_topic", ["userId", "subject", "topic"]),

  // messages table – normalized for conversations
  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.number(),
  }).index("by_conversationId_timestamp", ["conversationId", "timestamp"]),

  // examAnswers table – normalized for exam results
  examAnswers: defineTable({
    examResultId: v.id("examResults"),
    questionId: v.string(),
    selectedAnswer: v.string(),
    isCorrect: v.boolean(),
    timeSpent: v.number(),
  }).index("by_examResultId", ["examResultId"]),

  // devices table – separate normalized device tracking
  devices: defineTable({
    userId: v.id("users"),
    fingerprint: v.string(),
    lastUsed: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_fingerprint", ["fingerprint"]),

  // securityEvents table – audit trail for security
  securityEvents: defineTable({
    userId: v.optional(v.id("users")),
    eventType: v.string(),
    timestamp: v.number(),
    metadata: v.any(),
  })
    .index("by_userId_timestamp", ["userId", "timestamp"])
    .index("by_eventType_timestamp", ["eventType", "timestamp"]),

  // sharedLinks table – for exam and note sharing
  sharedLinks: defineTable({
    targetType: v.union(v.literal("examResult"), v.literal("note"), v.literal("conversation")),
    targetId: v.string(),
    token: v.string(),
    expiry: v.number(),
    passwordHash: v.optional(v.string()),
  })
    .index("by_token", ["token"])
    .index("by_expiry", ["expiry"]),

  // conversations table – headers only, messages normalized
  conversations: defineTable({
    userId: v.id("users"),
    title: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_updatedAt", ["userId", "updatedAt"])
    .index("by_createdAt", ["createdAt"]),

  // subscriptions table
  subscriptions: defineTable({
    userId: v.id("users"),
    plan: v.string(),
    startDate: v.number(),
    expiryDate: v.number(),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("cancelled")),
  })
    .index("by_userId", ["userId"])
    .index("by_expiryDate", ["expiryDate"])
    .index("by_status_expiryDate", ["status", "expiryDate"]),

  // notes table
  notes: defineTable({
    userId: v.id("users"),
    title: v.string(),
    content: v.string(),
    plainText: v.string(),
    isProtected: v.boolean(),
    passwordHash: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_updatedAt", ["userId", "updatedAt"])
    .index("by_createdAt", ["createdAt"]),

  // auditLogs table – mandatory for admin and state changes
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

  // rateLimit table – for centralized rate limiting (R15)
  rateLimit: defineTable({
    key: v.string(),
    endpoint: v.string(),
    count: v.number(),
    resetAt: v.number(),
  })
    .index("by_key_endpoint", ["key", "endpoint"])
    .index("by_resetAt", ["resetAt"]),
});