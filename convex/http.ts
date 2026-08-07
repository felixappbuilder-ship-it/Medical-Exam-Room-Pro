// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// ============================================================
// Helper: Generate unique request ID
// ============================================================
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ============================================================
// Helper: Log with timestamp and elapsed time
// ============================================================
function logWithTime(requestId: string, label: string, message: string, startTime?: number) {
  const now = Date.now();
  const elapsed = startTime ? ` (${now - startTime}ms)` : "";
  console.log(`[${requestId}] [${label}] ${message}${elapsed}`);
}

// ============================================================
// Helper: Parse JSON body safely
// ============================================================
async function parseBody(request: Request, requestId: string, label: string): Promise<any> {
  let rawBody = "";
  try {
    rawBody = await request.text();
    logWithTime(requestId, label, `Raw body: ${rawBody.substring(0, 500)}${rawBody.length > 500 ? "..." : ""}`);
  } catch (e) {
    console.error(`[${requestId}] [${label}] Failed to read body:`, e);
    return null;
  }
  try {
    return JSON.parse(rawBody);
  } catch (e) {
    console.error(`[${requestId}] [${label}] Invalid JSON:`, rawBody);
    return null;
  }
}

// ============================================================
// Helper: Normalize phone number intelligently
// Handles raw numbers, masked numbers, and SHA-256 hashes
// ============================================================
function normalizePhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;

  // If it's a SHA-256 hash (64 hex chars), store as-is – it's not a phone number
  if (/^[a-fA-F0-9]{64}$/.test(phone)) {
    return phone;
  }

  // If it's a masked phone (e.g., "2547*****126"), store as-is
  if (phone.includes('*')) {
    return phone;
  }

  // Attempt to normalize as a raw phone number
  let formatted = phone.replace(/\D/g, "");
  if (formatted.startsWith("0")) {
    formatted = "254" + formatted.slice(1);
  }
  if (!formatted.startsWith("254")) {
    formatted = "254" + formatted;
  }

  // Only return if it looks like a valid 12‑digit Kenyan phone number
  if (/^254[17]\d{8}$/.test(formatted)) {
    return formatted;
  }

  // If it doesn't match, return the original (could be a hash or other format)
  return phone;
}

// ============================================================
// STK Push Callback (from Safaricom after STK push)
// ROUTE: /stk/push/callback
// ============================================================
const stkCallbackHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  const startTime = Date.now();
  logWithTime(requestId, "stkCallback", "Received HTTP request");

  const body = await parseBody(request, requestId, "stkCallback");
  if (!body) return new Response(null, { status: 200 });

  const callbackData = body?.Body?.stkCallback || body;
  const {
    MerchantRequestID,
    ResultCode,
    MpesaReceiptNumber,
    CheckoutRequestID,
    ResultDesc,
    TransactionDate,
    Amount,
    PhoneNumber,
  } = callbackData;

  logWithTime(requestId, "stkCallback", `Parsed data: ${JSON.stringify({
    MerchantRequestID,
    ResultCode,
    MpesaReceiptNumber,
    CheckoutRequestID,
    ResultDesc,
    TransactionDate,
    Amount,
    PhoneNumber,
  })}`);

  if (!MerchantRequestID) {
    console.warn(`[${requestId}] [stkCallback] Missing MerchantRequestID, ignoring`);
    return new Response(null, { status: 200 });
  }

  logWithTime(requestId, "stkCallback", `Looking up payment for MerchantRequestID: ${MerchantRequestID}`);
  let payment;
  try {
    payment = await ctx.runQuery(
      internal.payments.internal.getPaymentByMerchantRequestId,
      { merchantRequestId: MerchantRequestID }
    );
  } catch (e) {
    console.error(`[${requestId}] [stkCallback] Error querying payment:`, e);
    return new Response(null, { status: 200 });
  }

  if (!payment) {
    console.warn(`[${requestId}] [stkCallback] No payment found for MerchantRequestID: ${MerchantRequestID}`);
    return new Response(null, { status: 200 });
  }

  logWithTime(requestId, "stkCallback", `Found payment: ${JSON.stringify({
    id: payment._id,
    status: payment.status,
    userId: payment.userId,
    phone: payment.phoneNumber,
    amount: payment.amount,
    createdAt: payment.createdAt,
  })}`);

  if (payment.status !== "pending") {
    logWithTime(requestId, "stkCallback", `Payment already processed (status: ${payment.status}), ignoring duplicate.`);
    return new Response(null, { status: 200 });
  }

  const status = Number(ResultCode) === 0 ? "completed" : "failed";
  const receipt = ResultCode === 0 ? MpesaReceiptNumber : undefined;

  logWithTime(requestId, "stkCallback", `Updating payment to status: ${status}, receipt: ${receipt}`);

  try {
    await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
      merchantRequestId: MerchantRequestID,
      status,
      receipt,
    });
    logWithTime(requestId, "stkCallback", `Payment updated successfully. Duration: ${Date.now() - startTime}ms`);
    if (status === "completed") {
      logWithTime(requestId, "stkCallback", `✅ SUBSCRIPTION ACTIVATED for user ${payment.userId}`);
    } else {
      logWithTime(requestId, "stkCallback", `❌ Payment failed with ResultCode: ${ResultCode} (${ResultDesc})`);
    }
  } catch (e) {
    console.error(`[${requestId}] [stkCallback] Error updating payment:`, e);
  }

  return new Response(null, { status: 200 });
});

// ============================================================
// C2B Validation (always return success)
// ROUTE: /c2b/validation
// ============================================================
const c2bValidationHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  const startTime = Date.now();
  logWithTime(requestId, "c2bValidation", "Received validation request");

  const body = await parseBody(request, requestId, "c2bValidation");
  if (body) {
    logWithTime(requestId, "c2bValidation", `Validation request body: ${JSON.stringify(body)}`);
  }

  logWithTime(requestId, "c2bValidation", `Validation successful. Duration: ${Date.now() - startTime}ms`);

  return new Response(
    JSON.stringify({
      ResultCode: 0,
      ResultDesc: "Validation successful",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

// ============================================================
// C2B Confirmation (manual Till payments)
// ROUTE: /c2b/confirmation
// ============================================================
const c2bConfirmationHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  const startTime = Date.now();
  logWithTime(requestId, "c2bConfirmation", "Received HTTP request");

  const body = await parseBody(request, requestId, "c2bConfirmation");
  if (!body) return new Response(null, { status: 200 });

  const {
    TransID,
    MSISDN,
    TransAmount,
    BusinessShortCode,
    BillRefNumber,
    OrgAccountBalance,
    ThirdPartyTransID,
    FirstName,
    MiddleName,
    LastName,
    ResultCode,
    ResultDesc,
  } = body;

  if (!TransID) {
    console.warn(`[${requestId}] [c2bConfirmation] Missing TransID, ignoring`);
    return new Response(null, { status: 200 });
  }

  // Normalize phone number intelligently – preserves hashes and masked numbers
  const normalizedPhone = normalizePhone(MSISDN);

  logWithTime(requestId, "c2bConfirmation", `Received payment: ${JSON.stringify({
    TransID,
    MSISDN,
    TransAmount,
    BusinessShortCode,
    ThirdPartyTransID,
    ResultCode,
    normalizedPhone,
  })}`);

  try {
    logWithTime(requestId, "c2bConfirmation", `Creating pending payment for TransID: ${TransID}`);
    const paymentId = await ctx.runMutation(internal.payments.internal.createPayment, {
      transactionId: `C2B_${TransID}_${Date.now()}`,
      amount: parseFloat(TransAmount),
      userId: undefined,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mpesaCode: TransID,
      phoneNumber: normalizedPhone,
      merchantRequestId: undefined,
      mpesaReceipt: TransID,
      checkoutRequestId: ThirdPartyTransID || undefined,
    });
    logWithTime(requestId, "c2bConfirmation", `Payment created with ID: ${paymentId}`);

    // Audit log
    await ctx.runMutation(internal.auth.internal.logAuditEvent, {
      actorId: "system",
      action: "c2b_confirmation_received",
      targetId: paymentId,
      details: {
        transId: TransID,
        amount: TransAmount,
        phone: MSISDN,
        normalizedPhone,
        businessShortCode: BusinessShortCode,
        first_name: FirstName,
        last_name: LastName,
        bill_ref: BillRefNumber,
        third_party_id: ThirdPartyTransID,
        resultCode: ResultCode,
        resultDesc: ResultDesc,
      },
    });
    logWithTime(requestId, "c2bConfirmation", `Audit log recorded. Duration: ${Date.now() - startTime}ms`);
  } catch (e) {
    console.error(`[${requestId}] [c2bConfirmation] Error processing payment:`, e);
    return new Response(null, { status: 200 });
  }

  logWithTime(requestId, "c2bConfirmation", `Payment recorded successfully`);
  return new Response(
    JSON.stringify({
      ResultCode: 0,
      ResultDesc: "Payment received successfully",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});

// ============================================================
// B2C Result Callback
// ROUTE: /b2c/result
// ============================================================
const b2cResultHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  const startTime = Date.now();
  logWithTime(requestId, "b2cResult", "Received B2C result callback");

  const body = await parseBody(request, requestId, "b2cResult");
  if (!body) return new Response(null, { status: 200 });

  const { Result } = body;
  if (!Result) {
    console.warn(`[${requestId}] [b2cResult] Missing Result object`);
    return new Response(null, { status: 200 });
  }

  const {
    OriginatorConversationID,
    ConversationID,
    ResultCode,
    ResultDesc,
    TransactionID,
    ResultParameters,
  } = Result;

  logWithTime(requestId, "b2cResult", `Parsed result: ${JSON.stringify({
    OriginatorConversationID,
    ConversationID,
    ResultCode,
    ResultDesc,
    TransactionID,
  })}`);

  // Find the B2C transaction
  let b2c;
  try {
    b2c = await ctx.runQuery(
      internal.payments.internal.getB2CByOriginatorConversationID,
      { originatorConversationID: OriginatorConversationID }
    );
  } catch (e) {
    console.error(`[${requestId}] [b2cResult] Error querying B2C transaction:`, e);
    return new Response(null, { status: 200 });
  }

  if (!b2c) {
    console.warn(`[${requestId}] [b2cResult] No B2C transaction found for OriginatorConversationID: ${OriginatorConversationID}`);
    return new Response(null, { status: 200 });
  }

  const status = ResultCode === 0 ? "completed" : "failed";
  logWithTime(requestId, "b2cResult", `Updating B2C transaction ${b2c._id} to status: ${status}`);

  try {
    await ctx.runMutation(internal.payments.internal.updateB2CTransaction, {
      id: b2c._id,
      status,
      conversationID: ConversationID,
      resultPayload: Result,
    });
    logWithTime(requestId, "b2cResult", `B2C transaction updated. Duration: ${Date.now() - startTime}ms`);
  } catch (e) {
    console.error(`[${requestId}] [b2cResult] Error updating B2C transaction:`, e);
  }

  // Log webhook event
  await ctx.runMutation(internal.payments.internal.insertWebhookLog, {
    source: "b2c_result",
    payload: body,
    headers: Object.fromEntries(request.headers.entries()),
    response: { status: "processed" },
    status: 200,
    createdAt: Date.now(),
  });

  return new Response(null, { status: 200 });
});

// ============================================================
// B2C Queue Timeout Callback
// ROUTE: /b2c/queue
// ============================================================
const b2cQueueHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  logWithTime(requestId, "b2cQueue", "Received B2C queue timeout callback");
  const body = await parseBody(request, requestId, "b2cQueue");
  if (body) {
    logWithTime(requestId, "b2cQueue", `Queue timeout body: ${JSON.stringify(body)}`);
  }
  return new Response(null, { status: 200 });
});

// ============================================================
// Account Balance Result Callback
// ROUTE: /balance/result
// ============================================================
const balanceResultHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  const startTime = Date.now();
  logWithTime(requestId, "balanceResult", "Received Account Balance result callback");

  const body = await parseBody(request, requestId, "balanceResult");
  if (!body) return new Response(null, { status: 200 });

  const { Result } = body;
  if (!Result) {
    console.warn(`[${requestId}] [balanceResult] Missing Result object`);
    return new Response(null, { status: 200 });
  }

  const {
    OriginatorConversationID,
    ConversationID,
    ResultCode,
    ResultDesc,
    ResultParameters,
  } = Result;

  logWithTime(requestId, "balanceResult", `Parsed result: ${JSON.stringify({
    OriginatorConversationID,
    ConversationID,
    ResultCode,
    ResultDesc,
  })}`);

  // Find the balance query
  let balanceQuery;
  try {
    balanceQuery = await ctx.runQuery(
      internal.payments.internal.getBalanceByOriginatorConversationID,
      { originatorConversationID: OriginatorConversationID }
    );
  } catch (e) {
    console.error(`[${requestId}] [balanceResult] Error querying balance query:`, e);
    return new Response(null, { status: 200 });
  }

  if (!balanceQuery) {
    console.warn(`[${requestId}] [balanceResult] No balance query found for OriginatorConversationID: ${OriginatorConversationID}`);
    return new Response(null, { status: 200 });
  }

  const status = ResultCode === 0 ? "completed" : "failed";
  logWithTime(requestId, "balanceResult", `Updating balance query ${balanceQuery._id} to status: ${status}`);

  try {
    await ctx.runMutation(internal.payments.internal.updateBalanceQuery, {
      id: balanceQuery._id,
      status,
      conversationID: ConversationID,
      result: Result,
    });
    logWithTime(requestId, "balanceResult", `Balance query updated. Duration: ${Date.now() - startTime}ms`);
  } catch (e) {
    console.error(`[${requestId}] [balanceResult] Error updating balance query:`, e);
  }

  // Log webhook event
  await ctx.runMutation(internal.payments.internal.insertWebhookLog, {
    source: "balance_result",
    payload: body,
    headers: Object.fromEntries(request.headers.entries()),
    response: { status: "processed" },
    status: 200,
    createdAt: Date.now(),
  });

  return new Response(null, { status: 200 });
});

// ============================================================
// Account Balance Queue Timeout Callback
// ROUTE: /balance/queue
// ============================================================
const balanceQueueHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  logWithTime(requestId, "balanceQueue", "Received Account Balance queue timeout callback");
  const body = await parseBody(request, requestId, "balanceQueue");
  if (body) {
    logWithTime(requestId, "balanceQueue", `Queue timeout body: ${JSON.stringify(body)}`);
  }
  return new Response(null, { status: 200 });
});

// ============================================================
// Transaction Status Result Callback
// ROUTE: /status/result
// ============================================================
const statusResultHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  const startTime = Date.now();
  logWithTime(requestId, "statusResult", "Received Transaction Status result callback");

  const body = await parseBody(request, requestId, "statusResult");
  if (!body) return new Response(null, { status: 200 });

  const { Result } = body;
  if (!Result) {
    console.warn(`[${requestId}] [statusResult] Missing Result object`);
    return new Response(null, { status: 200 });
  }

  const {
    OriginatorConversationID,
    ConversationID,
    ResultCode,
    ResultDesc,
    ResultParameters,
  } = Result;

  logWithTime(requestId, "statusResult", `Parsed result: ${JSON.stringify({
    OriginatorConversationID,
    ConversationID,
    ResultCode,
    ResultDesc,
  })}`);

  // Find the status query
  let statusQuery;
  try {
    statusQuery = await ctx.runQuery(
      internal.payments.internal.getStatusByOriginatorConversationID,
      { originatorConversationID: OriginatorConversationID }
    );
  } catch (e) {
    console.error(`[${requestId}] [statusResult] Error querying status query:`, e);
    return new Response(null, { status: 200 });
  }

  if (!statusQuery) {
    console.warn(`[${requestId}] [statusResult] No status query found for OriginatorConversationID: ${OriginatorConversationID}`);
    return new Response(null, { status: 200 });
  }

  const status = ResultCode === 0 ? "completed" : "failed";
  logWithTime(requestId, "statusResult", `Updating status query ${statusQuery._id} to status: ${status}`);

  try {
    await ctx.runMutation(internal.payments.internal.updateStatusQuery, {
      id: statusQuery._id,
      status,
      conversationID: ConversationID,
      result: Result,
    });
    logWithTime(requestId, "statusResult", `Status query updated. Duration: ${Date.now() - startTime}ms`);
  } catch (e) {
    console.error(`[${requestId}] [statusResult] Error updating status query:`, e);
  }

  // Log webhook event
  await ctx.runMutation(internal.payments.internal.insertWebhookLog, {
    source: "status_result",
    payload: body,
    headers: Object.fromEntries(request.headers.entries()),
    response: { status: "processed" },
    status: 200,
    createdAt: Date.now(),
  });

  return new Response(null, { status: 200 });
});

// ============================================================
// Transaction Status Queue Timeout Callback
// ROUTE: /status/queue
// ============================================================
const statusQueueHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  logWithTime(requestId, "statusQueue", "Received Transaction Status queue timeout callback");
  const body = await parseBody(request, requestId, "statusQueue");
  if (body) {
    logWithTime(requestId, "statusQueue", `Queue timeout body: ${JSON.stringify(body)}`);
  }
  return new Response(null, { status: 200 });
});

// ============================================================
// Reversal Result Callback
// ROUTE: /reversal/result
// ============================================================
const reversalResultHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  const startTime = Date.now();
  logWithTime(requestId, "reversalResult", "Received Reversal result callback");

  const body = await parseBody(request, requestId, "reversalResult");
  if (!body) return new Response(null, { status: 200 });

  const { Result } = body;
  if (!Result) {
    console.warn(`[${requestId}] [reversalResult] Missing Result object`);
    return new Response(null, { status: 200 });
  }

  const {
    OriginatorConversationID,
    ConversationID,
    ResultCode,
    ResultDesc,
    TransactionID,
    ResultParameters,
  } = Result;

  logWithTime(requestId, "reversalResult", `Parsed result: ${JSON.stringify({
    OriginatorConversationID,
    ConversationID,
    ResultCode,
    ResultDesc,
    TransactionID,
  })}`);

  // Find the reversal
  let reversal;
  try {
    reversal = await ctx.runQuery(
      internal.payments.internal.getReversalByOriginatorConversationID,
      { originatorConversationID: OriginatorConversationID }
    );
  } catch (e) {
    console.error(`[${requestId}] [reversalResult] Error querying reversal:`, e);
    return new Response(null, { status: 200 });
  }

  if (!reversal) {
    console.warn(`[${requestId}] [reversalResult] No reversal found for OriginatorConversationID: ${OriginatorConversationID}`);
    return new Response(null, { status: 200 });
  }

  const status = ResultCode === 0 ? "completed" : "failed";
  logWithTime(requestId, "reversalResult", `Updating reversal ${reversal._id} to status: ${status}`);

  try {
    await ctx.runMutation(internal.payments.internal.updateReversal, {
      id: reversal._id,
      status,
      conversationID: ConversationID,
      resultPayload: Result,
    });
    // If reversal completed, update the original payment status to 'reversed'
    if (status === "completed") {
      await ctx.db.patch(reversal.paymentId, { status: "reversed", updatedAt: Date.now() });
      logWithTime(requestId, "reversalResult", `Payment ${reversal.paymentId} marked as reversed`);
    }
    logWithTime(requestId, "reversalResult", `Reversal updated. Duration: ${Date.now() - startTime}ms`);
  } catch (e) {
    console.error(`[${requestId}] [reversalResult] Error updating reversal:`, e);
  }

  // Log webhook event
  await ctx.runMutation(internal.payments.internal.insertWebhookLog, {
    source: "reversal_result",
    payload: body,
    headers: Object.fromEntries(request.headers.entries()),
    response: { status: "processed" },
    status: 200,
    createdAt: Date.now(),
  });

  return new Response(null, { status: 200 });
});

// ============================================================
// Reversal Queue Timeout Callback
// ROUTE: /reversal/queue
// ============================================================
const reversalQueueHandler = httpAction(async (ctx, request) => {
  const requestId = request.headers.get("x-request-id") || generateRequestId();
  logWithTime(requestId, "reversalQueue", "Received Reversal queue timeout callback");
  const body = await parseBody(request, requestId, "reversalQueue");
  if (body) {
    logWithTime(requestId, "reversalQueue", `Queue timeout body: ${JSON.stringify(body)}`);
  }
  return new Response(null, { status: 200 });
});

// ============================================================
// Router Setup
// ============================================================
const http = httpRouter();

// STK Push callback
http.route({
  path: "/stk/push/callback",
  method: "POST",
  handler: stkCallbackHandler,
});

// C2B endpoints
http.route({
  path: "/c2b/validation",
  method: "POST",
  handler: c2bValidationHandler,
});
http.route({
  path: "/c2b/confirmation",
  method: "POST",
  handler: c2bConfirmationHandler,
});

// B2C endpoints
http.route({
  path: "/b2c/result",
  method: "POST",
  handler: b2cResultHandler,
});
http.route({
  path: "/b2c/queue",
  method: "POST",
  handler: b2cQueueHandler,
});

// Account Balance endpoints
http.route({
  path: "/balance/result",
  method: "POST",
  handler: balanceResultHandler,
});
http.route({
  path: "/balance/queue",
  method: "POST",
  handler: balanceQueueHandler,
});

// Transaction Status endpoints
http.route({
  path: "/status/result",
  method: "POST",
  handler: statusResultHandler,
});
http.route({
  path: "/status/queue",
  method: "POST",
  handler: statusQueueHandler,
});

// Reversal endpoints
http.route({
  path: "/reversal/result",
  method: "POST",
  handler: reversalResultHandler,
});
http.route({
  path: "/reversal/queue",
  method: "POST",
  handler: reversalQueueHandler,
});

export default http;