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

// Clean up expired shared exams every hour (48‑hour expiry)
crons.interval(
  "cleanupExpiredSharedExams",
  { hours: 1 },
  internal.sharedExams.actions.cleanupExpiredSharedExams
);

// Clean up expired challenges every 5 minutes (waiting rooms)
crons.interval(
  "cleanupExpiredChallenges",
  { minutes: 5 },
  internal.challenges.actions.cleanupExpiredChallenges
);

// Delete notifications older than 48 hours – runs every hour
crons.interval(
  "deleteOldNotifications",
  { hours: 1 },
  internal.notifications.internal.deleteOldNotifications,
  { olderThan: 48 * 60 * 60 * 1000 } // 48 hours in milliseconds
);

// Clean up old devices (keep only the current logged-in device) every 4 days
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
// 3. FINANCIAL LEDGER VERIFICATION JOBS
// ============================================================

// Verify pending STK payments that haven't received callbacks
// Runs every 2 minutes to catch missed callbacks
crons.interval(
  "verifyPendingStkPayments",
  { minutes: 2 },
  internal.payments.actions.verifyPendingStkPayments
);

// Verify pending B2C transactions that haven't received results
// Runs every 5 minutes
crons.interval(
  "verifyPendingB2C",
  { minutes: 5 },
  internal.payments.actions.verifyPendingB2C
);

// Verify pending Balance Queries that haven't received results
// Runs every 10 minutes
crons.interval(
  "verifyPendingBalanceQueries",
  { minutes: 10 },
  internal.payments.actions.verifyPendingBalanceQueries
);

// Verify pending Transaction Status Queries that haven't received results
// Runs every 10 minutes
crons.interval(
  "verifyPendingStatusQueries",
  { minutes: 10 },
  internal.payments.actions.verifyPendingStatusQueries
);

// Verify pending Reversals that haven't received results
// Runs every 15 minutes (reversals can take longer)
crons.interval(
  "verifyPendingReversals",
  { minutes: 15 },
  internal.payments.actions.verifyPendingReversals
);

export default crons;