import { createErrorResponse } from "@/lib/api-utils";

/**
 * Retired: the tenant "pay" endpoint, which marked a payment paid without
 * charging anything.
 *
 * It set the tenant's own PENDING or OVERDUE payment to PAID with a paid date
 * and a method, but its processor returned success without calling any
 * gateway, and it never set `amountPaid` or applied the money to its invoice
 * (the lease installment) the way a real settlement does
 * (lib/payments/settlement.ts). The tenant role carries `payment_portal`, so
 * any tenant could clear their own rent with one request.
 *
 * Tenants pay through a gateway, which settles the payment only once the
 * charge succeeds: the Pay Rent page (/dashboard/payments/pay-rent), or an API
 * client doing the same thing — POST /api/v1/payments/create-intent with the
 * payment's id, then confirming the card with Stripe.
 */
export async function POST() {
  return createErrorResponse(
    "This endpoint is retired: it marked payments paid without charging anything. " +
      "Pay online from /dashboard/payments/pay-rent, or start a card payment " +
      "with POST /api/v1/payments/create-intent.",
    410,
  );
}
