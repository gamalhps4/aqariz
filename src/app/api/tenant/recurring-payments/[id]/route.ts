import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: automatic rent payments.
 *
 * It changed the Stripe subscriptions of the automatic-payment setup screen,
 * which was never reachable.
 *
 * Each installment is paid from /dashboard/payments/pay-rent through the
 * office's gateways.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (automatic rent payments). Each installment is paid from /dashboard/payments/pay-rent through the office's gateways.",
    410,
  );
}

export const PUT = retired;
export const DELETE = retired;
