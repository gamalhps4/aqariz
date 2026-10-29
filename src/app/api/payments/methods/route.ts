import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: saved Stripe cards.
 *
 * It listed the tenant's saved Stripe cards for the payment-method manager,
 * a screen that was never reachable. Payments now open each gateway's own
 * hosted page, which keeps the payer's cards itself.
 *
 * Pay from /dashboard/payments/pay-rent, or start a payment with POST
 * /api/v1/payments/<id>/checkout.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (saved Stripe cards). Pay from /dashboard/payments/pay-rent, or start a payment with POST /api/v1/payments/<id>/checkout.",
    410,
  );
}

export const GET = retired;
