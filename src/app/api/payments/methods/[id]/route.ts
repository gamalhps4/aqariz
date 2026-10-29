import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: saved Stripe cards.
 *
 * It removed a saved Stripe card for the payment-method manager, a screen
 * that was never reachable.
 *
 * Cards saved with a gateway are managed on that gateway's own pages.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (saved Stripe cards). Cards saved with a gateway are managed on that gateway's own pages.",
    410,
  );
}

export const DELETE = retired;
