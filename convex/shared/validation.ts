import { z } from "zod";

// Reusable validation schemas

export const emailSchema = z.string().email();
export const phoneSchema = z.string().regex(/^254\d{9}$/, "Must be a valid Kenyan phone number (254XXXXXXXXX)");
export const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const deviceFingerprintSchema = z.string().min(1);
export const deviceInfoSchema = z.object({
  platform: z.string(),
  lastIp: z.string().ip().optional(),
});

export const securityQuestionSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const paginationSchema = z.object({
  limit: z.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const dateRangeSchema = z.object({
  startDate: z.number().optional(),
  endDate: z.number().optional(),
});

// User profile
export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: phoneSchema.optional(),
  institution: z.string().optional(),
  yearOfStudy: z.number().min(1).max(6).optional(),
});

export const updatePreferencesSchema = z.object({
  theme: z.enum(["auto", "light", "dark"]).optional(),
  notifications: z.boolean().optional(),
});

// Exam result
export const examResultSchema = z.object({
  examId: z.string(),
  subject: z.string(),
  mode: z.string(),
  date: z.number(),
  totalQuestions: z.number().positive(),
  correctAnswers: z.number().min(0),
  timeSpent: z.number().positive(),
  questions: z.array(
    z.object({
      questionId: z.string(),
      userAnswer: z.string().optional(),
      timeSpent: z.number(),
      flagged: z.boolean(),
      correct: z.boolean(),
    })
  ),
  topicPerformance: z.array(
    z.object({
      topic: z.string(),
      correct: z.number(),
      total: z.number(),
      avgTime: z.number(),
    })
  ),
  weakAreas: z.array(z.string()),
});

// Note
export const noteAttachmentSchema = z.object({
  type: z.string(),
  storageId: z.string(), // will be Id<"_storage"> but zod can't know that
  name: z.string(),
});

export const createNoteSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string(),
  plainText: z.string().max(10000),
  subject: z.string().optional(),
  topic: z.string().optional(),
  tags: z.array(z.string()).optional(),
  attachments: z.array(noteAttachmentSchema).optional(),
  isProtected: z.boolean().optional(),
  password: z.string().optional(),
});

// Conversation message
export const conversationMessageSchema = z.object({
  role: z.enum(["user", "ai"]),
  content: z.string(),
  timestamp: z.number(),
  references: z
    .array(
      z.object({
        book: z.string(),
        page: z.number().optional(),
      })
    )
    .optional(),
  rating: z.string().optional(),
});