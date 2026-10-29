import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: Stripe payment-intent status.
 *
 * It served the web's in-page Stripe card form, which hosted checkout pages
 * replaced; Stripe's webhook records an in-app card payment.
 *
 * Read the payment with GET /api/v1/payments/<id>.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (Stripe payment-intent status). Read the payment with GET /api/v1/payments/<id>.",
    410,
  );
}

export const GET = retired;
