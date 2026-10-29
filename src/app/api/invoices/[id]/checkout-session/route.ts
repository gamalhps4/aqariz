import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: Stripe-only invoice checkout.
 *
 * Online collection now works through any of the office's gateways (Stripe,
 * PayPal, Moyasar, PayTabs, Tap).
 *
 * Use POST /api/v1/invoices/<id>/checkout { gateway, amount }.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (Stripe-only invoice checkout). Use POST /api/v1/invoices/<id>/checkout { gateway, amount }.",
    410,
  );
}

export const POST = retired;
