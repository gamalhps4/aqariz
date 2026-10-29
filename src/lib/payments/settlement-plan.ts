/**
 * PropertyPro - Whether a gateway capture may settle a payment, and as what
 *
 * Pure, and kept apart from ./settlement.ts, which runs the transaction: the
 * decision needs a status, two amounts and two currencies, nothing else, and
 * this way it is tested without a database.
 */

import { PaymentStatus } from "@/types";

/**
 * Statuses a gateway event never overwrites.
 *
 * Paid and part paid are already settled. Refunded and cancelled are the
 * office's own decisions: the money went back, or the charge was withdrawn.
 * The guard used to stop at the first two, so a late or replayed Stripe event
 * put a refunded payment back to PAID — and applied its money to the
 * installment a second time — and could do the same to a cancelled charge.
 */
export const GATEWAY_FINAL_STATUSES: readonly string[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIAL,
  PaymentStatus.REFUNDED,
  PaymentStatus.CANCELLED,
];

export function isGatewayFinal(status: string): boolean {
  return GATEWAY_FINAL_STATUSES.includes(status);
}

export type SettlementPlan =
  | { settle: false }
  | {
      settle: true;
      status: PaymentStatus.PAID | PaymentStatus.PARTIAL;
      /** Charged in another currency, so it is recorded for a person to reconcile. */
      currencyMismatch: boolean;
    };

/**
 * What a capture of `capture.amount` does to this payment.
 *
 * A capture short of the amount due, or in a different currency — 1,200 MXN
 * is not 1,200 USD — lands as PARTIAL for a person to look at, never PAID.
 */
export function planGatewaySettlement(
  payment: { status: string; amount: unknown; currency?: string | null },
  capture: { amount: number; currency?: string | null },
): SettlementPlan {
  if (isGatewayFinal(payment.status)) return { settle: false };

  const currencyMismatch = Boolean(
    capture.currency &&
      payment.currency &&
      capture.currency.toUpperCase() !== String(payment.currency).toUpperCase(),
  );

  // Whole cents: Decimal columns arrive as JS numbers, and 0.1 + 0.2 must not
  // decide whether someone has paid their rent.
  const capturedCents = Math.round(capture.amount * 100);
  const dueCents = Math.round(Number(payment.amount) * 100);
  const fullySettled = !currencyMismatch && capturedCents >= dueCents;

  return {
    settle: true,
    status: fullySettled ? PaymentStatus.PAID : PaymentStatus.PARTIAL,
    currencyMismatch,
  };
}
