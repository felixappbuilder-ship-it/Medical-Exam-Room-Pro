import { v } from "convex/values";
import { query } from "../_generated/server";
import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { z } from "zod";

// -----------------------------------------------------------------------------
// Helper to get all exam results for a user
// -----------------------------------------------------------------------------
async function getUserExamResults(ctx: any, userId: Id<"users">) {
  return await ctx.db
    .query("examResults")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();
}

// -----------------------------------------------------------------------------
// Helper to compute percentage correct by subject
// -----------------------------------------------------------------------------
function computeSubjectProgress(examResults: Doc<"examResults">[]): Record<string, number> {
  const subjectStats: Record<string, { correct: number; total: number }> = {};

  for (const exam of examResults) {
    if (!subjectStats[exam.subject]) {
      subjectStats[exam.subject] = { correct: 0, total: 0 };
    }
    subjectStats[exam.subject].correct += exam.correctAnswers;
    subjectStats[exam.subject].total += exam.totalQuestions;
  }

  const result: Record<string, number> = {};
  for (const [subject, stats] of Object.entries(subjectStats)) {
    if (stats.total > 0) {
      result[subject] = Math.round((stats.correct / stats.total) * 100);
    } else {
      result[subject] = 0;
    }
  }
  return result;
}

// -----------------------------------------------------------------------------
// Helper to compute weak areas (topics with < threshold%)
// -----------------------------------------------------------------------------
function computeWeakAreas(
  examResults: Doc<"examResults">[],
  threshold: number
): Array<{ topic: string; score: number; priority: number }> {
  const topicStats: Record<string, { correct: number; total: number }> = {};

  for (const exam of examResults) {
    for (const topicPerf of exam.topicPerformance || []) {
      if (!topicStats[topicPerf.topic]) {
        topicStats[topicPerf.topic] = { correct: 0, total: 0 };
      }
      topicStats[topicPerf.topic].correct += topicPerf.correct;
      topicStats[topicPerf.topic].total += topicPerf.total;
    }
  }

  const weak: Array<{ topic: string; score: number; priority: number }> = [];
  for (const [topic, stats] of Object.entries(topicStats)) {
    if (stats.total > 0) {
      const score = (stats.correct / stats.total) * 100;
      if (score < threshold) {
        weak.push({
          topic,
          score: Math.round(score * 100) / 100, // rounded to 2 decimals
          priority: Math.round((threshold - score) * 100) / 100, // how far below threshold
        });
      }
    }
  }

  // Sort by priority descending (most urgent first)
  weak.sort((a, b) => b.priority - a.priority);
  return weak;
}

// -----------------------------------------------------------------------------
// Helper to compute study trends (daily scores and study time over last N days)
// -----------------------------------------------------------------------------
function computeStudyTrends(
  examResults: Doc<"examResults">[],
  days: number
): {
  dailyScores: Array<{ date: string; averageScore: number }>;
  studyTime: Array<{ date: string; minutes: number }>;
} {
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const recentExams = examResults.filter((e) => e.date >= cutoff);

  // Group by date (YYYY-MM-DD)
  const dateMap = new Map<string, { scores: number[]; totalTime: number }>();

  for (const exam of recentExams) {
    const dateStr = new Date(exam.date).toISOString().split("T")[0];
    if (!dateMap.has(dateStr)) {
      dateMap.set(dateStr, { scores: [], totalTime: 0 });
    }
    const entry = dateMap.get(dateStr)!;
    // Score percentage for this exam
    const score = (exam.correctAnswers / exam.totalQuestions) * 100;
    entry.scores.push(score);
    entry.totalTime += exam.timeSpent; // seconds
  }

  const dailyScores: Array<{ date: string; averageScore: number }> = [];
  const studyTime: Array<{ date: string; minutes: number }> = [];

  // Fill in missing dates with zeros (for the last N days)
  for (let i = 0; i < days; i++) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const entry = dateMap.get(date);
    if (entry) {
      const avgScore = entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length;
      dailyScores.unshift({ date, averageScore: Math.round(avgScore * 100) / 100 });
      studyTime.unshift({ date, minutes: Math.round(entry.totalTime / 60) }); // convert to minutes
    } else {
      dailyScores.unshift({ date, averageScore: 0 });
      studyTime.unshift({ date, minutes: 0 });
    }
  }

  return { dailyScores, studyTime };
}

// -----------------------------------------------------------------------------
// Helper to compute current study streak (consecutive days with any exam)
// -----------------------------------------------------------------------------
function computeStreak(examResults: Doc<"examResults">[]): number {
  if (examResults.length === 0) return 0;

  // Sort by date ascending
  const sorted = [...examResults].sort((a, b) => a.date - b.date);
  const uniqueDays = new Set<string>();
  for (const exam of sorted) {
    const dateStr = new Date(exam.date).toISOString().split("T")[0];
    uniqueDays.add(dateStr);
  }

  const dayList = Array.from(uniqueDays).sort();
  let streak = 0;
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  // Check if today or yesterday has activity
  const hasToday = dayList.includes(today);
  const hasYesterday = dayList.includes(yesterday);

  if (!hasToday && !hasYesterday) return 0;

  // Start from the most recent day that is either today or yesterday
  let currentDate = hasToday ? today : yesterday;
  let i = dayList.indexOf(currentDate);
  if (i === -1) return 0;

  streak = 1;
  let prevDate = currentDate;
  for (let j = i - 1; j >= 0; j--) {
    const date = dayList[j];
    const expectedPrev = new Date(new Date(prevDate).getTime() - 86400000)
      .toISOString()
      .split("T")[0];
    if (date === expectedPrev) {
      streak++;
      prevDate = date;
    } else {
      break;
    }
  }

  return streak;
}

// -----------------------------------------------------------------------------
// Helper for recommendations (simple rule-based)
// -----------------------------------------------------------------------------
function generateRecommendations(
  weakAreas: Array<{ topic: string; score: number }>,
  recentExams: Doc<"examResults">[]
): string[] {
  const recommendations: string[] = [];

  // If no weak areas, suggest review or new topics
  if (weakAreas.length === 0) {
    recommendations.push("Great job! You have no weak areas. Consider exploring new subjects or topics.");
    return recommendations;
  }

  // For top 3 weak areas, recommend practice
  weakAreas.slice(0, 3).forEach((wa) => {
    recommendations.push(`Focus on ${wa.topic} (current score: ${Math.round(wa.score)}%). Practice more questions in this topic.`);
  });

  // If recent exams show no activity in last 3 days, encourage study
  const now = Date.now();
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
  const recent = recentExams.some((e) => e.date >= threeDaysAgo);
  if (!recent) {
    recommendations.push("It's been a few days since your last exam. Start a practice session to maintain your streak.");
  }

  return recommendations;
}

// -----------------------------------------------------------------------------
// Get progress by subject (percentage correct per subject)
// -----------------------------------------------------------------------------
export const getProgressBySubject = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const examResults = await getUserExamResults(ctx, userId);
    return computeSubjectProgress(examResults);
  },
});

// -----------------------------------------------------------------------------
// Get weak areas (topics with < threshold%)
// -----------------------------------------------------------------------------
export const getWeakAreas = query({
  args: {
    threshold: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const threshold = args.threshold ?? 70; // default 70%
    if (threshold < 0 || threshold > 100) {
      throw new ConvexError("Threshold must be between 0 and 100");
    }

    const examResults = await getUserExamResults(ctx, userId);
    return computeWeakAreas(examResults, threshold);
  },
});

// -----------------------------------------------------------------------------
// Get study trends (daily scores and study time over last N days)
// -----------------------------------------------------------------------------
export const getStudyTrends = query({
  args: {
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const days = args.days ?? 30; // default 30 days
    if (days < 1 || days > 365) {
      throw new ConvexError("Days must be between 1 and 365");
    }

    const examResults = await getUserExamResults(ctx, userId);
    return computeStudyTrends(examResults, days);
  },
});

// -----------------------------------------------------------------------------
// Get current study streak (consecutive days with exam activity)
// -----------------------------------------------------------------------------
export const getStreak = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const examResults = await getUserExamResults(ctx, userId);
    return computeStreak(examResults);
  },
});

// -----------------------------------------------------------------------------
// Get recommendations (simple rule-based)
// -----------------------------------------------------------------------------
export const getRecommendations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");
    const userId = identity.subject as Id<"users">;

    const examResults = await getUserExamResults(ctx, userId);
    const weakAreas = computeWeakAreas(examResults, 70);
    const recommendations = generateRecommendations(weakAreas, examResults);

    return recommendations;
  },
});