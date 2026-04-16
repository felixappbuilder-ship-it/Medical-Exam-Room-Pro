// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const mpesaCallback = httpAction(async (ctx, request) => {
  // Parse the incoming JSON body from Safaricom
  const body = await request.json();

  const { MerchantRequestID, ResultCode, MpesaReceiptNumber } = body;

  // Validate required fields
  if (!MerchantRequestID) {
    // Malformed callback – still return 200 to avoid retries
    return new Response(null, { status: 200 });
  }

  // Retrieve the pending payment using the merchant request ID
  const payment = await ctx.runQuery(
    internal.payments.internal.getPaymentByMerchantRequestId,
    {
      merchantRequestId: MerchantRequestID,
    }
  );

  // Idempotency check (R10): if payment is not pending, ignore duplicate callback
  if (!payment || payment.status !== "pending") {
    // Already processed or not found – return 200 to prevent Safaricom retries
    return new Response(null, { status: 200 });
  }

  // Determine new status based on Safaricom result code
  const status = ResultCode === "0" ? "completed" : "failed";
  const receipt = ResultCode === "0" ? MpesaReceiptNumber : undefined;

  // Update the payment record and activate subscription if successful
  await ctx.runMutation(internal.payments.internal.updatePaymentStatus, {
    merchantRequestId: MerchantRequestID,
    status,
    receipt,
  });

  // Return 200 OK – Safaricom expects this to acknowledge receipt
  return new Response(null, { status: 200 });
});

const http = httpRouter();

http.route({
  path: "/mpesaCallback",
  method: "POST",
  handler: mpesaCallback,
});

// Add additional routes below as needed, e.g.:
// http.route({
//   path: "/stripeWebhook",
//   method: "POST",
//   handler: stripeWebhook,
// });

export default http;