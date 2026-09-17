// convex/notifications/triggers.ts
import { internal } from "../_generated/api";
import * as messages from "./messages";

async function notifyUser(ctx: any, userId: string, type: string, title: string, message: string, data?: any) {
  await ctx.runMutation(internal.notifications.internal.insertNotification, {
    userId,
    type,
    title,
    message,
    data,
  });
}

// ==================== USER-SPECIFIC NOTIFICATIONS ====================

export async function notifyAccountCreated(ctx: any, userId: string, name: string, email: string) {
  await notifyUser(ctx, userId, "account_created", "Welcome to Medical Exam Room Pro! 🎉", messages.buildAccountCreatedMessage(name), { route: "subjects" });
}

export async function notifyNewDevice(ctx: any, userId: string, platform: string, fingerprint: string) {
  await notifyUser(ctx, userId, "new_device", "New Device Detected", messages.buildNewDeviceMessage(platform, fingerprint), { route: "profile" });
}

export async function notifyPasswordChanged(ctx: any, userId: string) {
  await notifyUser(ctx, userId, "password_changed", "Password Changed", messages.buildPasswordChangedMessage(), { route: "profile" });
}

export async function notifyPasswordResetRequested(ctx: any, userId: string) {
  await notifyUser(ctx, userId, "password_reset_requested", "Password Reset Requested", messages.buildPasswordResetRequestedMessage(), { route: "login" });
}

export async function notifyPasswordResetCompleted(ctx: any, userId: string) {
  await notifyUser(ctx, userId, "password_reset_completed", "Password Reset Successful", messages.buildPasswordResetCompletedMessage(), { route: "login" });
}

export async function notifyPaymentSuccess(ctx: any, userId: string, amount: number, plan: string, receipt: string) {
  await notifyUser(ctx, userId, "payment_success", "Payment Successful", messages.buildPaymentSuccessMessage(amount, plan, receipt), { route: "subscription" });
}

export async function notifyPaymentFailed(ctx: any, userId: string, amount: number, plan: string, reason: string) {
  await notifyUser(ctx, userId, "payment_failed", "Payment Failed", messages.buildPaymentFailedMessage(amount, plan, reason), { route: "subscription" });
}

export async function notifyTrialStarted(ctx: any, userId: string, expiryDate: number) {
  await notifyUser(ctx, userId, "trial_started", "Trial Started", messages.buildTrialStartedMessage(expiryDate), { route: "subjects" });
}

export async function notifyExamResult(ctx: any, userId: string, examId: string, score: number, subject: string) {
  await notifyUser(ctx, userId, "exam_result", "Exam Complete", messages.buildExamResultMessage(examId, score, subject), { route: "performance", examId });
}

export async function notifyExamShared(ctx: any, userId: string, shareToken: string, expiry: number, sharerName: string) {
  await notifyUser(ctx, userId, "exam_shared", "📤 Exam Shared", messages.buildExamSharedMessage(shareToken, expiry, sharerName), { route: "shared-exam", shareToken });
}

export async function notifyNoteSharedWithUsers(ctx: any, userIds: string[], noteId: string, noteTitle: string, sharerName: string, shareToken: string) {
  if (!userIds || userIds.length === 0) return;
  await ctx.runMutation(internal.notifications.internal.insertNotificationsForUsers, {
    userIds,
    type: "note_shared_with_user",
    title: `📝 Note Shared with You`,
    message: messages.buildNoteSharedWithUserMessage(noteTitle, sharerName, shareToken),
    data: { route: "shared-note", noteId, shareToken },
  });
}

export async function notifyNoteShared(ctx: any, shareeId: string, noteId: string, noteTitle: string, sharerName: string, shareToken: string) {
  await notifyUser(ctx, shareeId, "note_shared", "Note Shared", messages.buildNoteSharedMessage(noteId, noteTitle, sharerName, shareToken), { route: "shared-note", noteId });
}

export async function notifySubscriptionExpiryWarning(ctx: any, userId: string, expiryDate: number) {
  await notifyUser(ctx, userId, "subscription_expiry_warning", "Subscription Expiring Soon", messages.buildSubscriptionExpiryWarningMessage(expiryDate), { route: "subscription" });
}

export async function notifySubscriptionCancelled(ctx: any, userId: string, plan: string) {
  await notifyUser(ctx, userId, "subscription_cancelled", "Subscription Cancelled", messages.buildSubscriptionCancelledMessage(plan), { route: "subscription" });
}

export async function notifyChallengeCreated(ctx: any, userId: string, challengeCode: string, shareLink: string, expiresAt: number) {
  await notifyUser(ctx, userId, "challenge_created", "Challenge Created! 🎯", messages.buildChallengeCreatedMessage(challengeCode, shareLink, expiresAt), { route: "exam-settings", challengeCode });
}

export async function notifyChallengeInvite(ctx: any, inviteeId: string, challengeCode: string, inviterName: string) {
  await notifyUser(ctx, inviteeId, "challenge_invite", "Challenge Invite", messages.buildChallengeInviteMessage(challengeCode, inviterName), { route: "exam-settings", challengeCode });
}

export async function notifyChallengeResults(
  ctx: any,
  userIds: string[],
  challengeCode: string,
  summary: Array<{
    displayName: string;
    score: number;
    percentage: number;
    timeSpent: number;
    submitted: boolean;
    isWinner: boolean;
    pr: number;
    ratingBefore: number;
    ratingAfter: number;
  }>,
  winnerId: string | null,
  pointsAwarded: number
) {
  await ctx.runMutation(internal.notifications.internal.insertNotificationsForUsers, {
    userIds,
    type: "challenge_results",
    title: "Challenge Results! 📊",
    message: messages.buildChallengeResultsMessage(challengeCode, summary, winnerId, pointsAwarded),
    data: { route: "performance", challengeCode },
  });
}

export async function notifyChallengeTimeout(ctx: any, userId: string, challengeCode: string, nonSubmitters: string[]) {
  await notifyUser(ctx, userId, "challenge_timeout", "Challenge Incomplete ⏰", messages.buildChallengeTimeoutMessage(challengeCode, nonSubmitters.length), { route: "exam-settings", challengeCode });
}

// ==================== ADMIN-RELATED NOTIFICATIONS ====================

export async function notifyAdminLockedAccount(ctx: any, userId: string, reason: string) {
  await notifyUser(ctx, userId, "admin_account_locked", "Account Locked by Admin", messages.buildAdminLockedAccountMessage(reason), { route: "profile" });
}

export async function notifyAdminUnlockedAccount(ctx: any, userId: string) {
  await notifyUser(ctx, userId, "admin_account_unlocked", "Account Unlocked by Admin", messages.buildAdminUnlockedAccountMessage(), { route: "profile" });
}

export async function notifyAdminChangedRole(ctx: any, userId: string, oldRole: string, newRole: string) {
  await notifyUser(ctx, userId, "admin_role_changed", "Account Role Updated", messages.buildAdminChangedRoleMessage(oldRole, newRole), { route: "profile" });
}

export async function notifyAdminForceLogout(ctx: any, userId: string) {
  await notifyUser(ctx, userId, "admin_force_logout", "Logged Out by Admin", messages.buildAdminForceLogoutMessage(), { route: "login" });
}

export async function notifyAdminResetPassword(ctx: any, userId: string) {
  await notifyUser(ctx, userId, "admin_password_reset", "Password Reset by Admin", messages.buildAdminResetPasswordMessage(), { route: "login" });
}

export async function notifyAdminExtendedSubscription(ctx: any, userId: string, days: number, newExpiry: number, reason: string) {
  await notifyUser(ctx, userId, "admin_subscription_extended", "Subscription Extended", messages.buildAdminExtendedSubscriptionMessage(days, newExpiry, reason), { route: "subscription" });
}

export async function notifyAdminTerminatedSubscription(ctx: any, userId: string, reason: string) {
  await notifyUser(ctx, userId, "admin_subscription_terminated", "Subscription Terminated by Admin", messages.buildAdminTerminatedSubscriptionMessage(reason), { route: "subscription" });
}

export async function notifyAdminGrantedTrial(ctx: any, userId: string, hours: number, expiryDate: number) {
  await notifyUser(ctx, userId, "admin_trial_granted", "Trial Granted by Admin", messages.buildAdminGrantedTrialMessage(hours, expiryDate), { route: "subjects" });
}

export async function notifyAdminManualPayment(ctx: any, userId: string, amount: number, plan: string, reference: string) {
  await notifyUser(ctx, userId, "admin_manual_payment", "Payment Recorded by Admin", messages.buildAdminManualPaymentMessage(amount, plan, reference), { route: "subscription" });
}

export async function notifyAdminProcessedWithdrawal(ctx: any, userId: string, amount: number, method: string) {
  await notifyUser(ctx, userId, "admin_withdrawal_processed", "Withdrawal Processed", messages.buildAdminProcessedWithdrawalMessage(amount, method), { route: "referral" });
}

export async function notifyAdminRejectedWithdrawal(ctx: any, userId: string, amount: number, reason: string) {
  await notifyUser(ctx, userId, "admin_withdrawal_rejected", "Withdrawal Rejected", messages.buildAdminRejectedWithdrawalMessage(amount, reason), { route: "referral" });
}

export async function notifyAdminProcessedReversal(ctx: any, userId: string, amount: number, transactionId: string) {
  await notifyUser(ctx, userId, "admin_reversal_processed", "Refund Processed", messages.buildAdminProcessedReversalMessage(amount, transactionId), { route: "payment" });
}

export async function notifyAdminRejectedReversal(ctx: any, userId: string, amount: number, reason: string) {
  await notifyUser(ctx, userId, "admin_reversal_rejected", "Refund Rejected", messages.buildAdminRejectedReversalMessage(amount, reason), { route: "payment" });
}

export async function notifyAdminVerifiedAgent(ctx: any, userId: string) {
  await notifyUser(ctx, userId, "admin_agent_verified", "Agent Verified", messages.buildAdminVerifiedAgentMessage(), { route: "referral" });
}

// ==================== ADMIN BROADCAST (using single-document global/group notifications) ====================

export async function notifyAdminBroadcastToAll(
  ctx: any,
  title: string,
  message: string,
  senderId: string
) {
  await ctx.runMutation(internal.notifications.internal.insertGlobalNotification, {
    type: "admin_broadcast",
    title,
    message,
    data: { adminId: senderId },
    senderId,
    targetAll: true,
    targetGroups: [],
  });
}

export async function notifyAdminBroadcastToGroup(
  ctx: any,
  groupName: string,
  title: string,
  message: string,
  senderId: string
) {
  await ctx.runMutation(internal.notifications.internal.insertGroupNotification, {
    groupName,
    type: "admin_broadcast",
    title,
    message,
    data: { adminId: senderId },
    senderId,
  });
}

export async function notifyAdminBroadcastToUsers(
  ctx: any,
  userIds: string[],
  title: string,
  message: string,
  senderId: string
) {
  if (!userIds || userIds.length === 0) return;
  await ctx.runMutation(internal.notifications.internal.insertNotificationsForUsers, {
    userIds,
    type: "admin_broadcast",
    title,
    message,
    data: { adminId: senderId },
    senderId,
  });
}

// In convex/notifications/triggers.ts, add this after the other admin notification exports:

export async function notifyAdminSystemLockdown(ctx: any, message: string) {
  // This is a broadcast to all users – use global notification (single document)
  await ctx.runMutation(internal.notifications.internal.insertGlobalNotification, {
    type: "admin_system_lockdown",
    title: "System Update",
    message: messages.buildAdminSystemLockdownMessage(message),
    data: { type: "system" },
    targetAll: true,
    targetGroups: [],
  });
}
// Legacy alias
export const notifyAdminBroadcast = notifyAdminBroadcastToUsers;

// ==================== GROUP-SPECIFIC NOTIFICATIONS ====================

export async function notifyGroup(
  ctx: any,
  userIds: string[],
  type: string,
  title: string,
  message: string,
  data?: any
) {
  if (!userIds || userIds.length === 0) return;
  await ctx.runMutation(internal.notifications.internal.insertNotificationsForUsers, {
    userIds,
    type,
    title,
    message,
    data,
  });
}

// ==================== ALL-USER NOTIFICATIONS (legacy) ====================

export async function notifyAllUsers(
  ctx: any,
  type: string,
  title: string,
  message: string,
  data?: any
) {
  const userIds = await ctx.runQuery(internal.users.internal.getAllUserIds);
  if (!userIds || userIds.length === 0) return;
  await ctx.runMutation(internal.notifications.internal.insertNotificationsForUsers, {
    userIds,
    type,
    title,
    message,
    data,
  });
}

// ==================== ADDITIONAL EXPORTS ====================

export async function notifySubscriptionUpdated(
  ctx: any,
  userId: string,
  planName: string,
  expiryDate: number,
  changeType: "new" | "extended" | "upgraded" | "downgraded",
  daysAwarded?: number
) {
  await notifyUser(ctx, userId, "subscription_updated", "Subscription Updated", messages.buildSubscriptionUpdatedMessage(planName, expiryDate, changeType, daysAwarded), { route: "subscription" });
}

export async function notifyReferralReward(
  ctx: any,
  userId: string,
  amount: number,
  referredUserName: string
) {
  await notifyUser(ctx, userId, "referral_reward", "Referral Reward! 🎉", messages.buildReferralRewardMessage(amount, referredUserName), { route: "referral" });
}
