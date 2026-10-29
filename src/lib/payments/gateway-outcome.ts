/**
 * PropertyPro - What a gateway's answer does to a payment
 *
 * One decision for every gateway and every way an answer arrives — a
 * webhook, the payer coming back, or a checkout finding an earlier attempt.
 * Pure: the payment row and the gateway's report in, an action out. The
 * transaction that carries out "settle" is lib/payments/settlement.ts, which
 * also decides PAID or PARTIAL from what was actually taken.
 *
 * Idempotent by construction: once a payment is settled, refunded or
 * cancelled, nothing a gateway says — a replayed webhook, a second return,
 * a late "paid" from an abandoned attempt — settles it again.
 *
 * Money that cannot settle the payment is never dropped: every "review" is
 * recorded as the tenant's credit and put in front of the office
 * (./gateway-review.ts). The commonest: a tenant opened the checkout, then
 * paid at the desk, then finished the gateway's page — paid twice.
 */

import type { GatewayPaymentState } from "@/lib/payments/gateway-adapter";
import { isGatewayFinal } from "@/lib/payments/settlement-plan";
import { PaymentStatus } from "@/types";

export interface OutcomePayment {
  id: string;
  status: string;
  /** The checkout reference stored on the row, if any. */
  gatewayPaymentId?: string | null;
  /**
   * The member of staff who recorded the money. Set, the payment was
   * settled at the desk, not by this gateway — whatever attempt it carries.
   */
  recordedById?: string | null;
}

export type GatewayOutcome =
  /** Record the money (settlement.ts decides PAID or PARTIAL). */
  | { action: "settle" }
  /** The attempt on file failed: mark the payment failed, still payable. */
  | { action: "fail" }
  /** Nothing to do yet, or nothing to do at all. */
  | {
      action: "none";
      reason: "pending" | "settled-already" | "stale-attempt" | "still-owed" | "refunded-at-gateway";
    }
  /**
   * Money was taken that cannot settle this payment: held as the tenant's
   * credit, and a person must look.
   */
  | { action: "review"; reason: "other-payment" | "closed-payment" | "paid-at-desk" };

/** Whether the gateway's report names this checkout. */
function namesAttemptOnFile(payment: OutcomePayment, state: GatewayPaymentState): boolean {
  const onFile = payment.gatewayPaymentId;
  if (!onFile) return true;
  return onFile === state.reference || onFile === state.sessionReference;
}

export function planGatewayOutcome(
  payment: OutcomePayment,
  state: GatewayPaymentState,
): GatewayOutcome {
  // The gateway says which payment the charge was raised for. Another
  // payment's money never settles this one — the same rule create-intent
  // applies (lib/payments/stored-intent.ts).
  if (state.paymentId && state.paymentId !== payment.id) {
    return state.status === "paid"
      ? { action: "review", reason: "other-payment" }
      : { action: "none", reason: "stale-attempt" };
  }

  switch (state.status) {
    case "paid": {
      if (!isGatewayFinal(payment.status)) return { action: "settle" };
      // Paid or part-paid already: a replay, or a second payment. Settled
      // at the desk, no gateway money settled it, so this is the tenant
      // paying twice — whatever attempt the row still names.
      if (payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.PARTIAL) {
        if (payment.recordedById) return { action: "review", reason: "paid-at-desk" };
        return namesAttemptOnFile(payment, state)
          ? { action: "none", reason: "settled-already" }
          : { action: "review", reason: "closed-payment" };
      }
      // Refunded or cancelled by the office, and money arrived anyway.
      return { action: "review", reason: "closed-payment" };
    }
    case "failed":
      // Only the attempt on file can fail the payment, and only while it
      // waits: an old attempt expiring says nothing about a newer one. An
      // overdue payment stays overdue — that is what the follow-up lists read.
      if (payment.status !== PaymentStatus.PENDING) {
        return { action: "none", reason: isGatewayFinal(payment.status) ? "settled-already" : "still-owed" };
      }
      return namesAttemptOnFile(payment, state)
        ? { action: "fail" }
        : { action: "none", reason: "stale-attempt" };
    case "refunded":
      // Refunds are started here (lib/payments/gateway-refund.ts) and reverse
      // the books there. One made in the gateway's dashboard is left for the
      // office to record: its amount may be partial.
      return { action: "none", reason: "refunded-at-gateway" };
    default:
      return { action: "none", reason: "pending" };
  }
}
