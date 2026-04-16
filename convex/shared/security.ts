// convex/shared/security.ts
// Pure logic functions – no Node.js dependencies

export function calculateDrift(clientTime: number, serverTime: number): number {
  return Math.abs(serverTime - clientTime);
}

export function generateRandomToken(length: number = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function isTokenExpired(expiryTimestamp: number): boolean {
  return Date.now() > expiryTimestamp;
}

export function sanitizeUserForClient(user: any) {
  const { passwordHash, securityQuestions, ...safe } = user;
  return safe;
}

export function validateEmail(email: string): boolean {
  const re = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/;
  return re.test(email);
}

export function validatePhone(phone: string): boolean {
  const re = /^[0-9+\-\s()]{10,15}$/;
  return re.test(phone);
}

export function computeWeakAreas(topicPerformance: Array<{ topic: string; score: number }>): string[] {
  const threshold = 60; // below 60% is weak
  return topicPerformance.filter(tp => tp.score < threshold).map(tp => tp.topic);
}