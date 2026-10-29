import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: PayPal-only order capture.
 *
 * A PayPal payer coming back is now captured and recorded by
 * /api/payments/return/paypal/<office>/<payment>.
 *
 * Nothing to call: the return and PayPal's webhook record the payment.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (PayPal-only order capture). Nothing to call: the return and PayPal's webhook record the payment.",
    410,
  );
}

export const POST = retired;
