import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: Stripe-only checkout reconciliation.
 *
 * A payer coming back from any gateway is now recorded by
 * /api/payments/return/<gateway>/<office>/<payment>, which asks the gateway
 * itself; this route settled the payment outside the shared settlement.
 *
 * Nothing to call: the return and the gateway's webhook record the payment.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (Stripe-only checkout reconciliation). Nothing to call: the return and the gateway's webhook record the payment.",
    410,
  );
}

export const POST = retired;
