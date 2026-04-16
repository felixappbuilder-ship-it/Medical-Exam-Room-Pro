// convex/cron.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Clean up expired shared links daily at 2:00 AM UTC
crons.daily(
  "cleanupExpiredShares",
  { hourUTC: 2, minuteUTC: 0 },
  internal.system.actions.cleanupExpiredShares
);

// Mark stale pending payments as expired every 10 minutes
crons.interval(
  "handleStalePayments",
  { minutes: 10 },
  internal.payments.actions.handleStalePayments
);

export default crons;