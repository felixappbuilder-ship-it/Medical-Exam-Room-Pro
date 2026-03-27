import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";

export const mpesaCallback = httpAction(async (ctx, request) => {
  try {
    const body = await request.json() as any;
    const callback = body?.Body?.stkCallback;

    if (!callback) {
      return new Response(JSON.stringify({ error: "Invalid callback" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callback;

    // Find payment by merchant request ID or checkout request ID
    const payment = await ctx.runQuery(internal.payments.findPaymentByMerchantRequest, {
      merchantRequestId: MerchantRequestID,
      checkoutRequestId: CheckoutRequestID,
    });

    if (!payment) {
      // Log unknown callback
      await ctx.runMutation(internal.security.logSecurityEvent, {
        type: "payment_callback_unknown",
        details: { MerchantRequestID, CheckoutRequestID },
      });
      return new Response(JSON.stringify({ error: "Payment not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const status = ResultCode === 0 ? "completed" : "failed";
    let mpesaReceipt: string | undefined;

    if (ResultCode === 0 && CallbackMetadata?.Item) {
      const receiptItem = CallbackMetadata.Item.find((item: any) => item.Name === "MpesaReceiptNumber");
      if (receiptItem) {
        mpesaReceipt = receiptItem.Value;
      }
    }

    // Update payment status
    await ctx.runMutation(internal.payments.updatePaymentStatus, {
      paymentId: payment._id,
      status,
      mpesaReceipt,
      resultCode: ResultCode,
      resultDesc: ResultDesc,
    });

    // If completed, activate subscription
    if (ResultCode === 0) {
      await ctx.runMutation(internal.payments.activateSubscriptionAfterPayment, {
        paymentId: payment._id,
        userId: payment.userId,
        metadata: payment.metadata,
      });
    }

    // Return success to Safaricom
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Success" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mpesaCallback error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});