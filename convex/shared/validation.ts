// convex/shared/validation.ts
import { z } from "zod";

export const UserRegistrationSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().regex(/^[0-9+\-\s()]{10,15}$/),
  password: z.string().min(8),
  securityQuestions: z.array(
    z.object({
      question: z.string(),
      answer: z.string().min(1),
    })
  ).length(3),
  deviceFingerprint: z.string(),
});

export const LoginSchema = z.object({
  identifier: z.string(),
  password: z.string(),
  deviceFingerprint: z.string(),
});

export const PaymentInitiateSchema = z.object({
  planName: z.string(),
  deviceFingerprint: z.string(),
});

export const NoteCreateSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string(),
  plainText: z.string(),
  isProtected: z.boolean(),
  password: z.string().optional(),
});

export const ExamResultSyncSchema = z.object({
  examId: z.string(),
  score: z.number().min(0).max(100),
  topicPerformance: z.array(
    z.object({
      topic: z.string(),
      score: z.number(),
      timePerQuestion: z.number(),
    })
  ),
  weakAreas: z.array(z.string()),
  completedAt: z.number(),
  answers: z.array(
    z.object({
      questionId: z.string(),
      selectedAnswer: z.string(),
      isCorrect: z.boolean(),
      timeSpent: z.number(),
    })
  ),
});

export const AIAskSchema = z.object({
  question: z.string().min(1).max(2000),
  context: z.string().optional(),
});

// Response wrapper type
export type ApiResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};