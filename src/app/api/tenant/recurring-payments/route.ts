import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: automatic rent payments.
 *
 * It opened Stripe subscriptions for the automatic-payment setup screen,
 * which was never reachable. They were created incomplete, waiting for a
 * first card confirmation nothing on the web ever made, in dollars whatever
 * the office billed in, and nothing tied what they charged to the rent
 * schedule.
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

export const GET = retired;
export const POST = retired;
