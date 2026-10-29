import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: saving Stripe cards.
 *
 * It opened a Stripe setup intent for the payment-method manager, a screen
 * that was never reachable.
 *
 * Pay from /dashboard/payments/pay-rent, or start a payment with POST
 * /api/v1/payments/<id>/checkout.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (saving Stripe cards). Pay from /dashboard/payments/pay-rent, or start a payment with POST /api/v1/payments/<id>/checkout.",
    410,
  );
}

export const POST = retired;
