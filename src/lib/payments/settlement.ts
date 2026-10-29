/**
 * PropertyPro - Shared gateway settlement (Prisma/Postgres)
 *
 * One idempotent "settle a Payment + apply it to its Invoice" implementation,
 * shared by every gateway (lib/payments/gateway-settle.ts) and Stripe's in-app
 * card flow. Replaces the
 * Mongoose `findOneAndUpdate({ status: { $ne: PAID } })` claim plus the
 * `Invoice.addPayment` document method (now `applyPaymentToInvoiceTx` in
 * payment-invoice-linking.service).
 *
 * Runs inside `runWithOrgTransaction`, which stamps the caller's RLS context —
 * gateway code is invoked both from org-scoped routes (verify/capture) and
 * from bypass contexts (webhooks), and works unchanged under either.
 */

import { runWithOrgTransaction } from "@/lib/db/prisma";
import { PaymentStatus } from "@/types";
import { applyPaymentToInvoiceTx } from "@/lib/services/payment-invoice-linking.service";
import {
  GATEWAY_FINAL_STATUSES,
  planGatewaySettlement,
} from "@/lib/payments/settlement-plan";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { postAfterCommit } from "@/lib/accounting/hooks";

/**
 * Gateway reference columns a settlement may stamp on the Payment. The
 * generic pair only once migration 20261004140000_payment_gateway_reference
 * is in (lib/payments/gateway-columns.ts) — the caller checks.
 */
export type GatewayReferenceFields = Partial<
  Record<
    | "gatewayProvider"
    | "gatewayPaymentId"
    | "stripePaymentIntentId"
    | "stripeCheckoutSessionId"
    | "paypalOrderId"
    | "paypalCaptureId",
    string
  >
>;

export interface GatewaySettlementInput {
  amount: number;
  /** PaymentMethod enum value recorded on the Payment + history entry. */
  paymentMethod: string;
  /** External transaction id recorded in the history entry. */
  transactionId?: string;
  /** History note, e.g. "Payment captured via PayPal". */
  notes: string;
  /**
   * ISO-4217 code the gateway actually charged in. Recorded on the Payment so
   * the amount keeps its meaning regardless of what the organization's
   * currency setting says later. Omitted only by callers with no gateway
   * response to read it from.
   */
  currency?: string;
  /** Gateway-specific reference columns to set (paypalCaptureId, ...). */
  referenceFields?: GatewayReferenceFields;
}

export interface GatewaySettlementResult {
  /** True when THIS call settled the payment (false if another path already had). */
  applied: boolean;
  payment: any;
}

/**
 * Settle a Payment exactly once and apply the captured amount to its invoice.
 *
 * The optimistic version check makes the claim atomic: of two concurrent
 * callers (redirect capture vs. webhook), only one wins the updateMany and
 * records history/invoice application; the loser gets back the already-settled
 * row with `applied: false`. The invoice application is itself idempotent
 * (`paymentIds` dedupe), so retries can never double-count.
 *
 * The resulting status is derived from what the gateway actually captured, not
 * assumed. A capture short of the amount due lands as PARTIAL, never PAID —
 * previously any successful capture marked the payment fully settled, so an
 * underpayment silently closed the balance and the organization's books said
 * they had been paid in full.
 *
 * PARTIAL is terminal for automation. It needs a person to look at it, and the
 * invoice application dedupes per payment id, so a second automated capture
 * against the same Payment could not be applied to the invoice anyway. The
 * claim below refuses it rather than drifting the two records apart.
 */
export async function settleGatewayPayment(
  paymentId: string,
  settlement: GatewaySettlementInput
): Promise<GatewaySettlementResult> {
  // Read inside the transaction, recorded after it commits (asserted: the
  // assignment inside the callback is invisible to narrowing).
  let before = null as { status: string; amountPaid: number } | null;
  const result: GatewaySettlementResult = await runWithOrgTransaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!payment) return { applied: false, payment: null };

    // Settled by another path, refunded, or cancelled — see
    // GATEWAY_FINAL_STATUSES. Return the current state without re-applying.
    const plan = planGatewaySettlement(payment, settlement);
    if (!plan.settle) {
      if (
        payment.status === PaymentStatus.REFUNDED ||
        payment.status === PaymentStatus.CANCELLED
      ) {
        // The gateway took money for a payment the office had already closed.
        // Nothing is written; someone has to refund or reconcile it by hand.
        console.warn(
          `Gateway capture of ${settlement.amount} (${settlement.transactionId ?? "no reference"}) ` +
            `arrived for payment ${paymentId}, which is ${payment.status}. Left as it is.`,
        );
      }
      return { applied: false, payment };
    }

    const now = new Date();
    const { currencyMismatch } = plan;
    const fullySettled = plan.status === PaymentStatus.PAID;
    before = { status: payment.status, amountPaid: Number(payment.amountPaid ?? 0) };

    if (currencyMismatch) {
      console.warn(
        `Currency mismatch on payment ${paymentId}: captured ` +
          `${settlement.amount} ${settlement.currency} against an expected ` +
          `${payment.amount} ${payment.currency}. Recorded as PARTIAL for ` +
          `manual review.`,
      );
    } else if (!fullySettled) {
      console.warn(
        `Underpayment on payment ${paymentId}: captured ${settlement.amount} ` +
          `of ${payment.amount} via ${settlement.paymentMethod}. ` +
          `Recorded as PARTIAL — the remaining balance needs manual follow-up.`,
      );
    }

    const historyEntry = {
      amount: settlement.amount,
      paymentMethod: settlement.paymentMethod,
      paidDate: now.toISOString(),
      transactionId: settlement.transactionId,
      notes: settlement.notes,
    };

    const claimed = await tx.payment.updateMany({
      where: {
        id: paymentId,
        version: payment.version,
        status: { notIn: [...GATEWAY_FINAL_STATUSES] },
        deletedAt: null,
      },
      data: {
        status: plan.status,
        paidDate: now,
        amountPaid: settlement.amount,
        paymentMethod: settlement.paymentMethod,
        ...(settlement.currency
          ? { currency: settlement.currency.toUpperCase() }
          : {}),
        ...settlement.referenceFields,
        paymentHistory: [
          ...(((payment.paymentHistory as unknown) as any[]) ?? []),
          historyEntry,
        ],
        version: { increment: 1 },
      },
    });

    // Lost the race — someone else claimed it between the read and the update.
    if (claimed.count === 0) {
      const current = await tx.payment.findFirst({ where: { id: paymentId } });
      return { applied: false, payment: current };
    }

    if (payment.invoiceId) {
      // Listed on its installment while it carried no money — the schedule
      // lists every row that way — the payment would read as applied already
      // and the money would never reach the installment: paid, while the
      // installment went on owing all of it. The claim above proved it held
      // no money, so taking it off the list first changes no balance (as
      // recordInstallmentPayment does for a row it converts).
      if (Number(payment.amountPaid ?? 0) === 0) {
        const listed = await tx.invoice.findFirst({
          where: { id: payment.invoiceId, deletedAt: null, paymentIds: { has: paymentId } },
          select: { id: true, paymentIds: true, version: true },
        });
        if (listed) {
          const unlisted = await tx.invoice.updateMany({
            where: { id: listed.id, version: listed.version, deletedAt: null },
            data: {
              paymentIds: listed.paymentIds.filter((id) => id !== paymentId),
              version: { increment: 1 },
            },
          });
          if (unlisted.count === 0) {
            throw new Error("Invoice was modified by another process");
          }
        }
      }
      try {
        await applyPaymentToInvoiceTx(
          tx,
          payment.invoiceId,
          paymentId,
          settlement.amount
        );
      } catch (error) {
        // A vanished (soft-deleted) invoice must not block the settlement —
        // the old gateway code logged and kept the payment PAID. The throw
        // happens before any invoice write, so the transaction is still good.
        if (
          error instanceof Error &&
          error.message === "Invoice not found"
        ) {
          console.error("Invoice not found for payment:", payment.invoiceId);
        } else {
          throw error;
        }
      }
    }

    const fresh = await tx.payment.findFirst({ where: { id: paymentId } });
    return { applied: true, payment: fresh ?? payment };
  });

  // Recorded only when this call settled it — a webhook arriving after the
  // redirect capture settles nothing and records nothing. Paid by the tenant
  // in the portal, the entry is theirs; settled by a webhook, it is the
  // system's.
  if (result.applied && result.payment) {
    void recordActivity({
      action: AuditAction.PAYMENT_PROCESSED,
      recordType: "payment",
      recordId: paymentId,
      recordName: result.payment.description ?? null,
      messageParams: {
        amount: settlement.amount,
        currency: settlement.currency?.toUpperCase(),
      },
      before,
      after: {
        status: result.payment.status,
        amountPaid: settlement.amount,
        paymentMethod: settlement.paymentMethod,
      },
      details: {
        gateway: true,
        transactionId: settlement.transactionId ?? undefined,
        leaseId: result.payment.leaseId ?? undefined,
      },
      organizationId: result.payment.organizationId,
    });
    // The tenant's receipt by SMS/WhatsApp, where the office sends one.
    void import("@/lib/messaging/events").then(({ notifyPaymentReceived }) =>
      notifyPaymentReceived(paymentId),
    );
    // The office's books (lib/accounting/hooks.ts): the receipt lands in
    // gateway clearing until the gateway pays out.
    postAfterCommit("payment", paymentId);
  }
  return result;
}
