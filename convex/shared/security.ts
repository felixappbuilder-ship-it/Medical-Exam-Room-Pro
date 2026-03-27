// Pure logic for security checks – no Node.js dependencies
// Can be used in default runtime functions.

export const MAX_ALLOWED_TIME_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if client time is within acceptable drift from server time.
 * @param clientTime – timestamp from client
 * @param serverTime – current server timestamp (Date.now())
 * @returns object with valid flag and drift in ms
 */
export function checkTimeDrift(clientTime: number, serverTime: number): { valid: boolean; drift: number } {
  const drift = serverTime - clientTime;
  const valid = Math.abs(drift) <= MAX_ALLOWED_TIME_DRIFT_MS;
  return { valid, drift };
}

/**
 * Detect time manipulation based on multiple violations.
 * @param violations – array of timestamps when violations occurred
 * @param withinHours – hours to consider (default 24)
 * @param threshold – number of violations to lock account (default 3)
 * @returns true if threshold exceeded
 */
export function shouldLockAccount(violations: number[], withinHours = 24, threshold = 3): boolean {
  const cutoff = Date.now() - withinHours * 60 * 60 * 1000;
  const recentViolations = violations.filter((ts) => ts >= cutoff);
  return recentViolations.length >= threshold;
}

/**
 * Generate a random token (not crypto‑secure, but fine for share links).
 * @param length – desired token length (default 32)
 * @returns random alphanumeric string
 */
export function generateRandomToken(length = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}