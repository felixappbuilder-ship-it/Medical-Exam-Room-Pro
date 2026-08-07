// convex/payments/ledger.ts
import { internal } from "../_generated/api";

/**
 * Log a payment event (audit trail).
 * @param ctx - Convex mutation or action context
 * @param paymentId - Optional payment ID
 * @param source - Source of the event (e.g., "stk", "c2b", "admin", "scheduler")
 * @param eventType - Type of event (e.g., "STK_INITIATED", "PAYMENT_SUCCESS")
 * @param payload - Event payload (any JSON-serializable data)
 */
export async function logPaymentEvent(
  ctx: any,
  paymentId: string | undefined,
  source: string,
  eventType: string,
  payload: any
): Promise<void> {
  await ctx.runMutation(internal.payments.internal.insertPaymentEvent, {
    paymentId,
    source,
    eventType,
    payload,
    createdAt: Date.now(),
  });
}

/**
 * Credit a user's wallet.
 * @param ctx - Convex mutation context
 * @param userId - User ID
 * @param amount - Amount to credit (positive number)
 * @param source - Source of the credit (e.g., "referral", "agent_commission", "bonus")
 * @param reference - Optional reference (e.g., transaction ID)
 */
export async function creditWallet(
  ctx: any,
  userId: string,
  amount: number,
  source: string,
  reference?: string
): Promise<void> {
  await ctx.runMutation(internal.payments.internal.creditWallet, {
    userId,
    amount,
    source,
    reference,
  });
}

/**
 * Debit a user's wallet.
 * @param ctx - Convex mutation context
 * @param userId - User ID
 * @param amount - Amount to debit (positive number)
 * @param source - Source of the debit (e.g., "withdrawal", "purchase")
 * @param reference - Optional reference (e.g., transaction ID)
 * @throws {Error} If wallet not found or insufficient balance
 */
export async function debitWallet(
  ctx: any,
  userId: string,
  amount: number,
  source: string,
  reference?: string
): Promise<void> {
  await ctx.runMutation(internal.payments.internal.debitWallet, {
    userId,
    amount,
    source,
    reference,
  });
}