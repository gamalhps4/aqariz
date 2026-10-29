import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: Stripe invoice card payments.
 *
 * It raised Stripe card payments for the invoice payment portal, a screen
 * that was never reachable.
 *
 * Collect an invoice online with POST /api/v1/invoices/<id>/checkout {
 * gateway, amount }.
 */
function retired() {
  return createErrorResponse(
    "This endpoint is retired (Stripe invoice card payments). Collect an invoice online with POST /api/v1/invoices/<id>/checkout { gateway, amount }.",
    410,
  );
}

export const POST = retired;
export const PATCH = retired;
