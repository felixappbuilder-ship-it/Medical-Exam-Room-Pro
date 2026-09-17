// convex/shared/performance.ts
/**
 * MedVix Performance Rating Engine v2 (MPREv2) – Backend Port
 * 
 * This engine computes:
 *   - Performance Ratio (PR) from aggregated exam data
 *   - Rating updates based on relative performance within a lobby
 *   - History EWMA, rank, confidence, consistency, etc.
 * 
 * All inputs are aggregated metrics – no raw questions/answers are stored or transmitted.
 * 
 * Version: 2.1 – Production‑ready with robust edge‑case handling.
 */

// ==================== CONSTANTS ====================

const BASE_RATING = 100;
const RANK_GROWTH_FACTOR = 1.8;
const MAX_RANKS = 10;
const RATING_SMOOTHING = 3000;
const EWMA_ALPHA = 0.20;
const TIME_DECAY_ALPHA = 0.8;
const K_FACTOR = 32;
const CONFIDENCE_DECAY = 50;
const CONFIDENCE_CAP = 200;
const MIN_TIME_PER_QUESTION = 4;
const PR_PRECISION = 6;
const MAX_DIFFICULTY = 5;

const RANK_NAMES = ['Seed', 'Aspire', 'Scholar', 'Proficient', 'Advanced', 'Expert', 'Elite', 'Master', 'Apex', 'Luminary'];
const RANK_TITLES = ['Starting Out', 'Rising', 'Learning', 'Capable', 'Skilled', 'Expert', 'Elite', 'Master', 'Apex', 'Luminary'];

// ==================== RANK ====================

export function getRank(rating: number) {
  const effectiveRating = Math.max(rating, BASE_RATING);
  for (let i = MAX_RANKS - 1; i >= 0; i--) {
    const required = BASE_RATING * Math.pow(RANK_GROWTH_FACTOR, i);
    if (effectiveRating >= required) {
      return {
        rank: i + 1,
        ratingRequired: Math.round(required),
        label: RANK_NAMES[i],
        title: RANK_TITLES[i],
      };
    }
  }
  return { rank: 1, ratingRequired: BASE_RATING, label: RANK_NAMES[0], title: RANK_TITLES[0] };
}

// ==================== FACTOR COMPUTATIONS ====================

export function computeCorrectFactor(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, correct / total));
}

/**
 * Difficulty factor from weighted average difficulty.
 * @param difficultyFactor – average difficulty of the exam (1–5)
 * @returns normalized difficulty factor (0–1)
 */
export function computeDifficultyFactor(difficultyFactor: number): number {
  // Ensure difficultyFactor is at least 1 (so D is never 0)
  const safeDiff = Math.max(1, difficultyFactor || 1);
  const clamped = Math.min(MAX_DIFFICULTY, safeDiff);
  return clamped / MAX_DIFFICULTY; // 0.2 – 1.0
}

export function computeTimeFactor(timeUsed: number, timeLimit: number, questionCount: number): number {
  // Guard: if no time data, assume a moderate time factor (0.5)
  if (timeLimit <= 0 || timeUsed <= 0 || questionCount <= 0) return 0.5;
  const minTime = questionCount * MIN_TIME_PER_QUESTION;
  const effectiveTime = Math.max(timeUsed, minTime);
  const ratio = Math.min(effectiveTime / timeLimit, 3);
  return Math.exp(-TIME_DECAY_ALPHA * ratio);
}

export function computeHistoryFactor(historyEWMA: number): number {
  if (typeof historyEWMA !== 'number' || isNaN(historyEWMA)) return 0.5;
  return Math.min(1, Math.max(0, historyEWMA));
}

export function computeRankFactor(rating: number): number {
  const safeRating = Math.max(rating, BASE_RATING);
  return 1 - Math.exp(-safeRating / RATING_SMOOTHING);
}

export function computeAttemptFactor(attempted: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, attempted / total));
}

export function computeConfidenceFactor(completedExams: number): number {
  const capped = Math.min(Math.max(completedExams, 0), CONFIDENCE_CAP);
  return 1 - Math.exp(-capped / CONFIDENCE_DECAY);
}

export function computeConsistencyFactor(previousPRs: number[], avgPR?: number): number {
  if (!previousPRs || previousPRs.length < 3) return 0.5;
  const avg = avgPR ?? previousPRs.reduce((s, v) => s + v, 0) / previousPRs.length;
  const variance = previousPRs.reduce((s, v) => s + (v - avg) ** 2, 0) / previousPRs.length;
  const stdDev = Math.sqrt(variance);
  const normalized = Math.min(stdDev, 0.5) / 0.5;
  const consistency = 1 - normalized;
  return Math.min(1, Math.max(0, consistency * avg));
}

// ==================== PERFORMANCE RATIO (PR) ====================

/**
 * Compute Performance Ratio from aggregated exam data.
 * No raw questions or answers are needed – only aggregated metrics.
 * 
 * All inputs are validated with safe defaults to prevent zero factors.
 */
export function computePerformanceRatio(data: {
  correct: number;
  total: number;
  timeUsed: number; // seconds
  timeLimit: number; // seconds
  difficultyFactor: number; // average difficulty (1–5)
  historyEWMA: number;
  rating: number;
  completedExams: number;
  previousPRs: number[];
}) {
  const {
    correct,
    total,
    timeUsed,
    timeLimit,
    difficultyFactor,
    historyEWMA,
    rating,
    completedExams,
    previousPRs,
  } = data;

  // Guard: if total is zero, return 0 (no exam data)
  if (total <= 0) {
    return { pr: 0, factors: { C: 0, D: 0, T: 0, H: 0, R: 0, A: 0, CF: 0, S: 0 } };
  }

  const safeCorrect = Math.max(0, Math.min(correct, total));
  const safeTotal = Math.max(1, total);
  const safeTimeUsed = Math.max(1, timeUsed || 1);
  const safeTimeLimit = Math.max(1, timeLimit || 1);
  const safeDiff = Math.max(1, difficultyFactor || 1);
  const safeHistory = Math.max(0, Math.min(1, historyEWMA ?? 0.5));
  const safeRating = Math.max(BASE_RATING, rating || BASE_RATING);
  const safeCompleted = Math.max(0, completedExams || 0);
  const safePrevious = previousPRs ?? [];

  const C = computeCorrectFactor(safeCorrect, safeTotal);
  const D = computeDifficultyFactor(safeDiff);
  const T = computeTimeFactor(safeTimeUsed, safeTimeLimit, safeTotal);
  const H = computeHistoryFactor(safeHistory);
  const R = computeRankFactor(safeRating);
  const A = 1; // all questions attempted
  const CF = computeConfidenceFactor(safeCompleted);
  const avgPR = safePrevious.length > 0 ? safePrevious.reduce((a, b) => a + b, 0) / safePrevious.length : 0.5;
  const S = computeConsistencyFactor(safePrevious, avgPR);

  let pr = Math.pow(C, 0.43) *
           Math.pow(D, 0.25) *
           Math.pow(T, 0.10) *
           Math.pow(H, 0.08) *
           Math.pow(R, 0.05) *
           Math.pow(A, 0.04) *
           Math.pow(CF, 0.02) *
           Math.pow(S, 0.03);

  pr = Math.min(1, Math.max(0, pr));
  return {
    pr: Math.round(pr * Math.pow(10, PR_PRECISION)) / Math.pow(10, PR_PRECISION),
    factors: { C, D, T, H, R, A, CF, S },
  };
}

// ==================== RATING UPDATE (relative performance) ====================

/**
 * Update rating based on relative performance within a lobby.
 * Uses a combination of PR difference and Elo rating expectation.
 */
export function updateRatingRelative(
  currentRating: number,
  pr: number,
  lobbyAvgPR: number,
  opponentAvgRating: number,
  kFactor: number = K_FACTOR
): number {
  // Guard: if pr is 0 or lobbyAvgPR is 0, no meaningful update
  if (pr <= 0 || lobbyAvgPR <= 0) return Math.max(BASE_RATING, currentRating || BASE_RATING);

  const performanceDiff = pr - lobbyAvgPR;
  // Probability of being the top performer based on PR (logistic function)
  const winProbability = 1 / (1 + Math.exp(-4 * performanceDiff));
  // Elo expected score based on rating difference
  const safeCurrent = Math.max(BASE_RATING, currentRating || BASE_RATING);
  const safeOpponent = Math.max(BASE_RATING, opponentAvgRating || BASE_RATING);
  const ratingDiff = safeOpponent - safeCurrent;
  const eloExpected = 1 / (1 + Math.pow(10, ratingDiff / 400));
  // Combine both signals
  const actual = winProbability;
  const expected = eloExpected;
  const change = kFactor * (actual - expected);
  return Math.max(BASE_RATING, Math.round(safeCurrent + change));
}

// ==================== HISTORY UPDATE (EWMA) ====================

export function updateHistoryEWMA(previousEWMA: number, pr: number, alpha: number = EWMA_ALPHA): number {
  const safePrev = (typeof previousEWMA === 'number' && !isNaN(previousEWMA)) ? previousEWMA : 0.5;
  const safePR = Math.min(1, Math.max(0, pr));
  return alpha * safePR + (1 - alpha) * safePrev;
}

// ==================== COMPLETE PERFORMANCE COMPUTATION ====================

/**
 * Compute full performance update for a single user in a challenge.
 * This combines PR, rating, rank, and history in one call.
 */
export function computeFullPerformance(
  currentRating: number,
  currentHistoryEWMA: number,
  completedExams: number,
  previousPRs: number[],
  examData: {
    correct: number;
    total: number;
    timeUsed: number;
    timeLimit: number;
    difficultyFactor: number;
  },
  lobbyAvgPR: number,
  opponentAvgRating: number
) {
  // Validate inputs
  const safeTotal = Math.max(1, examData.total || 1);
  const safeCorrect = Math.min(examData.correct, safeTotal);
  const safeTimeUsed = Math.max(1, examData.timeUsed || 1);
  const safeTimeLimit = Math.max(1, examData.timeLimit || 1);
  const safeDiff = Math.max(1, examData.difficultyFactor || 1);
  const safeRating = Math.max(BASE_RATING, currentRating || BASE_RATING);
  const safeHistory = (typeof currentHistoryEWMA === 'number' && !isNaN(currentHistoryEWMA)) ? currentHistoryEWMA : 0.5;
  const safeCompleted = Math.max(0, completedExams || 0);
  const safePrevious = previousPRs ?? [];

  const prResult = computePerformanceRatio({
    correct: safeCorrect,
    total: safeTotal,
    timeUsed: safeTimeUsed,
    timeLimit: safeTimeLimit,
    difficultyFactor: safeDiff,
    historyEWMA: safeHistory,
    rating: safeRating,
    completedExams: safeCompleted,
    previousPRs: safePrevious,
  });

  const newRating = updateRatingRelative(safeRating, prResult.pr, lobbyAvgPR || 0.5, opponentAvgRating || BASE_RATING);
  const newHistory = updateHistoryEWMA(safeHistory, prResult.pr);
  const rank = getRank(newRating);

  return {
    pr: prResult.pr,
    factors: prResult.factors,
    previousRating: safeRating,
    newRating,
    ratingChange: newRating - safeRating,
    rank,
    historyEWMA: newHistory,
  };
}