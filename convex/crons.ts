// convex/cron.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ============================================================
// 1. SYSTEM CLEANUP JOBS
// ============================================================

// Clean up expired shared links daily at 2:00 AM UTC
crons.daily(
  "cleanupExpiredShares",
  { hourUTC: 2, minuteUTC: 0 },
  internal.system.actions.cleanupExpiredShares
);

// Clean up expired shared exams every hour
crons.interval(
  "cleanupExpiredSharedExams",
  { hours: 1 },
  internal.sharedExams.actions.cleanupExpiredSharedExams
);

// Clean up expired challenges every 5 minutes
crons.interval(
  "cleanupExpiredChallenges",
  { minutes: 5 },
  internal.challenges.actions.cleanupExpiredChallenges
);

// ✅ Delete old notifications daily at 2:00 AM UTC
crons.daily(
  "deleteOldNotifications",
  { hourUTC: 2, minuteUTC: 0 },
  internal.notifications.internal.deleteOldNotifications
);

// Clean up old devices every 4 days (96 hours)
crons.interval(
  "cleanupOldDevices",
  { hours: 96 },
  internal.auth.internal.cleanupOldDevices
);

// ============================================================
// 2. SUBSCRIPTION AND PAYMENT CLEANUP
// ============================================================

// Mark stale pending payments as expired every 10 minutes
crons.interval(
  "handleStalePayments",
  { minutes: 10 },
  internal.payments.actions.handleStalePayments
);

// Mark expired subscriptions every 3 hours
crons.interval(
  "markExpiredSubscriptions",
  { hours: 3 },
  internal.subscriptions.actions.markExpiredSubscriptions
);

// ============================================================
// 3. SUBSCRIPTION EXPIRY WARNINGS (daily)
// ============================================================
crons.daily(
  "sendSubscriptionExpiryWarnings",
  { hourUTC: 8, minuteUTC: 0 },
  internal.subscriptions.actions.sendExpiryWarnings
);

// ============================================================
// 4. PRIVACY & COMPLIANCE – DORMANT ACCOUNT DELETION
//    Runs every 2 weeks (336 hours) to delete accounts inactive for 6 months
// ============================================================
crons.interval(
  "deleteDormantAccounts",
  { hours: 336 }, // 14 days = 2 weeks
  internal.users.actions.deleteDormantAccounts
);

// ============================================================
// 5. CHAT MESSAGE CLEANUP – remove messages older than 2 hours
//    Runs every 30 minutes to keep chat history fresh
// ============================================================
crons.interval(
  "cleanupChatMessages",
  { minutes: 30 },
  internal.challenges.actions.cleanupChatMessages
);

// ============================================================
// 6. CHALLENGE DEADLINE CHECK (every hour)
// ============================================================
crons.interval(
  "checkChallengeDeadlines",
  { minutes: 60 },
  internal.challenges.actions.checkChallengeDeadlines
);

// ============================================================
// 7. EXAM ENCOURAGEMENT NOTIFICATIONS (daily at 9 AM UTC)
// ============================================================
crons.daily(
  "sendExamEncouragementNotifications",
  { hourUTC: 9, minuteUTC: 0 },
  internal.examResults.actions.sendExamEncouragementNotifications
);

// ============================================================
// 8. SUBSCRIPTION EXPIRY REMINDERS (daily at 6 AM UTC)
// ============================================================
crons.daily(
  "sendSubscriptionExpiryReminders",
  { hourUTC: 6, minuteUTC: 0 },
  internal.subscriptions.actions.sendExpiryReminders
);

export default crons;