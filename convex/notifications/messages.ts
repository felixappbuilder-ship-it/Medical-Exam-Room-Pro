// convex/notifications/messages.ts

export function buildPaymentSuccessMessage(amount: number, plan: string, receipt: string): string {
  return `
    <p><strong>✅ Payment Successful!</strong></p>
    <p>KES ${amount} for <strong>${plan}</strong> (Receipt: ${receipt})</p>
    <button data-action="navigate" data-route="subscription">View Subscription</button>
  `;
}

export function buildPaymentFailedMessage(amount: number, plan: string, reason: string): string {
  return `
    <p><strong>❌ Payment Failed</strong></p>
    <p>KES ${amount} for <strong>${plan}</strong> – ${reason}</p>
    <button data-action="navigate" data-route="subscription">Retry</button>
  `;
}

export function buildTrialStartedMessage(expiryDate: number): string {
  const expiry = new Date(expiryDate).toLocaleString();
  return `
    <p><strong>🎉 Free Trial Started!</strong></p>
    <p>Your 3‑hour trial expires on <strong>${expiry}</strong>.</p>
    <button data-action="navigate" data-route="subjects">Start Studying</button>
  `;
}

export function buildExamResultMessage(examId: string, score: number, subject: string): string {
  return `
    <p><strong>📊 Exam Complete!</strong></p>
    <p>${subject} – Score: <strong>${score}%</strong></p>
    <button data-action="navigate" data-route="results" data-exam-id="${examId}">View Details</button>
  `;
}

export function buildChallengeInviteMessage(challengeCode: string, inviterName: string): string {
  return `
    <p><strong>🤝 Challenge Invite</strong></p>
    <p><strong>${inviterName}</strong> invited you to a challenge!</p>
    <button data-action="navigate" data-route="exam-settings" data-challenge-code="${challengeCode}">Join Challenge</button>
  `;
}

export function buildNoteSharedMessage(noteId: string, noteTitle: string, sharerName: string, shareToken: string): string {
  return `
    <p><strong>📝 Note Shared</strong></p>
    <p><strong>${sharerName}</strong> shared a note: <em>${noteTitle}</em></p>
    <button data-action="navigate" data-route="shared-note" data-note-id="${noteId}">View Note</button>
  `;
}

export function buildNoteSharedWithUserMessage(noteTitle: string, sharerName: string, shareToken: string): string {
  return `
    <p><strong>📝 ${sharerName} shared a note with you</strong></p>
    <p><strong>Title:</strong> ${noteTitle}</p>
    <button data-action="navigate" data-route="shared-note" data-share-token="${shareToken}">View Note</button>
  `;
}

export function buildSubscriptionExpiryWarningMessage(expiryDate: number): string {
  const days = Math.ceil((expiryDate - Date.now()) / (1000 * 60 * 60 * 24));
  return `
    <p><strong>⏳ Subscription Expiring Soon</strong></p>
    <p>Your subscription expires in <strong>${days} day${days > 1 ? 's' : ''}</strong>.</p>
    <button data-action="navigate" data-route="subscription">Renew Now</button>
  `;
}

export function buildSubscriptionCancelledMessage(plan: string): string {
  return `
    <p><strong>⛔ Subscription Cancelled</strong></p>
    <p>Your <strong>${plan}</strong> subscription has been cancelled.</p>
    <p>You will retain access until the expiry date.</p>
    <button data-action="navigate" data-route="subscription">View Details</button>
  `;
}

export function buildSubscriptionUpdatedMessage(
  planName: string,
  expiryDate: number,
  changeType: "new" | "extended" | "upgraded" | "downgraded",
  daysAwarded?: number
): string {
  const expiry = new Date(expiryDate).toLocaleString();
  let label = "";
  if (changeType === "new") label = "✅ Subscription Activated";
  else if (changeType === "extended") label = `✅ Extended by ${daysAwarded || 0} days`;
  else if (changeType === "upgraded") label = "⭐ Upgraded Plan";
  else if (changeType === "downgraded") label = "Plan Downgraded";
  return `
    <p><strong>${label}</strong></p>
    <p>Plan: <strong>${planName}</strong></p>
    <p>Expires: <strong>${expiry}</strong></p>
    <button data-action="navigate" data-route="subscription">View Details</button>
  `;
}

export function buildSubscriptionExpiryReminderMessage(daysRemaining: number, expiryDate: number): string {
  const expiry = new Date(expiryDate).toLocaleString();
  return `
    <p><strong>⏳ Subscription Expiring Soon</strong></p>
    <p>Your subscription expires in <strong>${daysRemaining} day${daysRemaining > 1 ? 's' : ''}</strong> (${expiry}).</p>
    <p>Renew now to continue access.</p>
    <button data-action="navigate" data-route="subscription">Renew Now</button>
  `;
}

export function buildReferralRewardMessage(amount: number, referredUserName: string): string {
  return `
    <p><strong>🎉 Referral Reward!</strong></p>
    <p>You earned <strong>KES ${amount}</strong> from a referral (${referredUserName}).</p>
    <p>Check your wallet balance.</p>
    <button data-action="navigate" data-route="referral">View Wallet</button>
  `;
}

export function buildExamSharedMessage(shareToken: string, expiry: number, sharerName: string): string {
  const expiryDate = new Date(expiry).toLocaleString();
  return `
    <p><strong>📤 Exam Shared</strong></p>
    <p>You have shared an exam. Share this link with others:</p>
    <a href="/shared-exam?token=${shareToken}">/shared-exam?token=${shareToken}</a>
    <p>Link expires on <strong>${expiryDate}</strong>.</p>
    <button data-action="navigate" data-route="shared-exam" data-share-token="${shareToken}">View Shared Exam</button>
  `;
}

export function buildAccountCreatedMessage(name: string): string {
  return `
    <p><strong>🎉 Welcome, ${name}!</strong></p>
    <p>Your account has been created successfully.</p>
    <p>Start your medical exam preparation journey today.</p>
    <button data-action="navigate" data-route="subjects">Start Studying</button>
  `;
}

export function buildNewDeviceMessage(platform: string, fingerprint: string): string {
  return `
    <p><strong>🔐 New Device Detected</strong></p>
    <p>A new device (${platform || 'unknown'}) just logged into your account.</p>
    <p>If this wasn't you, please change your password immediately.</p>
    <button data-action="navigate" data-route="profile">Review Settings</button>
  `;
}

export function buildPasswordChangedMessage(): string {
  return `
    <p><strong>✅ Password Changed</strong></p>
    <p>Your password has been changed successfully.</p>
    <p>If you didn't make this change, please contact support immediately.</p>
    <button data-action="navigate" data-route="profile">Settings</button>
  `;
}

export function buildPasswordResetRequestedMessage(): string {
  return `
    <p><strong>🔐 Password Reset Requested</strong></p>
    <p>Someone requested a password reset for your account.</p>
    <p>If this wasn't you, please contact support immediately.</p>
  `;
}

export function buildPasswordResetCompletedMessage(): string {
  return `
    <p><strong>✅ Password Reset Complete</strong></p>
    <p>Your password has been reset successfully.</p>
    <p>Please login with your new password.</p>
    <button data-action="navigate" data-route="login">Login Now</button>
  `;
}

export function buildAdminLockedAccountMessage(reason: string): string {
  return `
    <p><strong>🔒 Account Locked by Admin</strong></p>
    <p>An administrator has locked your account.</p>
    <p><strong>Reason:</strong> ${reason}</p>
    <p>Contact support for assistance.</p>
  `;
}

export function buildAdminUnlockedAccountMessage(): string {
  return `
    <p><strong>🔓 Account Unlocked</strong></p>
    <p>An administrator has unlocked your account.</p>
    <p>You can now log in and access all features.</p>
    <button data-action="navigate" data-route="login">Login Now</button>
  `;
}

export function buildAdminChangedRoleMessage(oldRole: string, newRole: string): string {
  return `
    <p><strong>👤 Account Role Updated</strong></p>
    <p>An administrator has changed your account role from <strong>${oldRole}</strong> to <strong>${newRole}</strong>.</p>
    <p>Contact support if you have questions.</p>
  `;
}

export function buildAdminForceLogoutMessage(): string {
  return `
    <p><strong>🚪 Logged Out by Admin</strong></p>
    <p>An administrator has logged you out from all devices.</p>
    <p>Please log in again.</p>
    <button data-action="navigate" data-route="login">Login Again</button>
  `;
}

export function buildAdminResetPasswordMessage(): string {
  return `
    <p><strong>🔑 Password Reset by Admin</strong></p>
    <p>An administrator has reset your password.</p>
    <p>Please check your email or contact support for your new login credentials.</p>
  `;
}

export function buildAdminExtendedSubscriptionMessage(days: number, newExpiry: number, reason: string): string {
  const expiry = new Date(newExpiry).toLocaleString();
  return `
    <p><strong>✅ Subscription Extended</strong></p>
    <p>An administrator has extended your subscription by <strong>${days} days</strong>.</p>
    <p>Your subscription is now active until <strong>${expiry}</strong>.</p>
    ${reason !== "Admin extension" ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
    <button data-action="navigate" data-route="subscription">View Subscription</button>
  `;
}

export function buildAdminTerminatedSubscriptionMessage(reason: string): string {
  return `
    <p><strong>⛔ Subscription Terminated</strong></p>
    <p>An administrator has terminated your subscription.</p>
    <p><strong>Reason:</strong> ${reason}</p>
    <p>Contact support for assistance.</p>
  `;
}

export function buildAdminGrantedTrialMessage(hours: number, expiryDate: number): string {
  const expiry = new Date(expiryDate).toLocaleString();
  return `
    <p><strong>🎉 Trial Granted by Admin</strong></p>
    <p>An administrator has granted you a <strong>${hours}-hour free trial</strong>.</p>
    <p>Your trial expires on <strong>${expiry}</strong>.</p>
    <button data-action="navigate" data-route="subjects">Start Studying</button>
  `;
}

export function buildAdminManualPaymentMessage(amount: number, plan: string, reference: string): string {
  return `
    <p><strong>✅ Payment Recorded by Admin</strong></p>
    <p>KES ${amount} for <strong>${plan}</strong> (Reference: ${reference})</p>
    <p>Your subscription has been updated.</p>
    <button data-action="navigate" data-route="subscription">View Subscription</button>
  `;
}

export function buildAdminProcessedWithdrawalMessage(amount: number, method: string): string {
  return `
    <p><strong>✅ Withdrawal Processed</strong></p>
    <p>KES ${amount} has been sent via <strong>${method}</strong>.</p>
    <p>Check your payment method for confirmation.</p>
  `;
}

export function buildAdminRejectedWithdrawalMessage(amount: number, reason: string): string {
  return `
    <p><strong>❌ Withdrawal Rejected</strong></p>
    <p>Your withdrawal of KES ${amount} has been rejected.</p>
    <p><strong>Reason:</strong> ${reason}</p>
    <p>Contact support for more information.</p>
  `;
}

export function buildAdminProcessedReversalMessage(amount: number, transactionId: string): string {
  return `
    <p><strong>✅ Refund Processed</strong></p>
    <p>KES ${amount} has been refunded.</p>
    <p><strong>Transaction:</strong> ${transactionId}</p>
  `;
}

export function buildAdminRejectedReversalMessage(amount: number, reason: string): string {
  return `
    <p><strong>❌ Refund Rejected</strong></p>
    <p>Your refund request of KES ${amount} has been rejected.</p>
    <p><strong>Reason:</strong> ${reason}</p>
  `;
}

export function buildAdminVerifiedAgentMessage(): string {
  return `
    <p><strong>✅ Agent Verified</strong></p>
    <p>An administrator has verified you as an agent.</p>
    <p>You are now eligible for referral bonuses.</p>
    <button data-action="navigate" data-route="dashboard">Go to Dashboard</button>
  `;
}

export function buildAdminSystemLockdownMessage(message: string): string {
  return `
    <p><strong>🔧 System Update</strong></p>
    <p>${message}</p>
  `;
}

export function buildChallengeCreatedMessage(challengeCode: string, shareLink: string, expiresAt: number): string {
  const expiry = new Date(expiresAt).toLocaleString();
  return `
    <p><strong>🎯 Challenge Created!</strong></p>
    <p>Your challenge code: <strong>${challengeCode}</strong></p>
    <p>Share this link with friends: <br/><a href="${shareLink}">${shareLink}</a></p>
    <p>Expires: ${expiry}</p>
    <button data-action="navigate" data-route="exam-settings" data-challenge-code="${challengeCode}">Open Challenge</button>
  `;
}

export function buildChallengeResultsMessage(
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
): string {
  const rows = summary.map(p => {
    const status = p.submitted
      ? `${p.percentage}% (${p.score}) | PR: ${p.pr.toFixed(3)} | Rating: ${p.ratingBefore} → ${p.ratingAfter}`
      : "❌ Not Submitted";
    const winnerBadge = p.isWinner ? " 🏆" : "";
    return `<li><strong>${p.displayName}</strong>: ${status}${winnerBadge}</li>`;
  }).join('');

  const winnerLine = winnerId
    ? `<p>🏆 <strong>Winner: ${summary.find(p => p.userId === winnerId)?.displayName || 'Unknown'}</strong> — awarded ${pointsAwarded} points!</p>`
    : `<p>No winner (no submissions).</p>`;

  return `
    <p><strong>📊 Challenge ${challengeCode} Complete!</strong></p>
    <ul style="list-style: none; padding: 0;">${rows}</ul>
    ${winnerLine}
    <button data-action="navigate" data-route="performance" data-challenge-code="${challengeCode}">View Full Results</button>
  `;
}

export function buildChallengeTimeoutMessage(challengeCode: string, nonSubmittersCount: number): string {
  return `
    <p><strong>⏰ Challenge ${challengeCode} Incomplete</strong></p>
    <p>${nonSubmittersCount} participant(s) did not submit their results within 6 hours.</p>
    <p>The challenge has been archived.</p>
    <button data-action="navigate" data-route="exam-settings" data-challenge-code="${challengeCode}">View Details</button>
  `;
}