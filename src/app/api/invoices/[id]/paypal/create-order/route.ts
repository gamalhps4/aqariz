import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: PayPal-only invoice checkout.
 *
 * Online collection now works through any of the office's gateways, PayPal
 * included.
 *
 * Use POST /api/v1/invoices/<id>/checkout { gateway: "paypal", amount }.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (PayPal-only invoice checkout). Use POST /api/v1/invoices/<id>/checkout { gateway: \"paypal\", amount }.",
    410,
  );
}

export const POST = retired;
