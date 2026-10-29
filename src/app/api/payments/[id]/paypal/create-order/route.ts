import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: PayPal-only checkout.
 *
 * Online payment now works through any of the office's gateways, PayPal
 * included.
 *
 * Use POST /api/v1/payments/<id>/checkout { gateway: "paypal" }.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (PayPal-only checkout). Use POST /api/v1/payments/<id>/checkout { gateway: \"paypal\" }.",
    410,
  );
}

export const POST = retired;
