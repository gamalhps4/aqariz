/**
 * PropertyPro - Acting on what a gateway reports
 *
 * Every gateway's answer — a verified webhook, the payer coming back, a
 * checkout finding an earlier attempt — lands here in the same terms
 * (GatewayPaymentState). `findPaymentForState` finds the payment it is about,
 * `applyGatewayState` carries out what ./gateway-outcome.ts decides:
 *
 *   settle  the shared settlement (./settlement.ts): claimed by version, so
 *           of a webhook and a return arriving together only one records the
 *           money, and applied to the installment in the same transaction;
 *   fail    the pending payment is marked failed and stays payable;
 *   review  money arrived that cannot settle this payment — held as the
 *           tenant's credit and put in front of the office (./gateway-review.ts).
 *
 * Runs inside the payment's organization context (the webhook and return
 * routes bind it from the URL), so row-level security keeps a report naming
 * another office's payment from finding it.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import { PaymentMethod, PaymentStatus } from "@/types";
import type { GatewayPaymentState } from "@/lib/payments/gateway-adapter";
import { getGatewayDef, type GatewayId } from "@/lib/payments/gateway-registry";
import { planGatewayOutcome, type GatewayOutcome } from "@/lib/payments/gateway-outcome";
import { settleGatewayPayment, type GatewayReferenceFields } from "@/lib/payments/settlement";
import { gatewayColumnsAvailable, gatewayColumnsOmit } from "@/lib/payments/gateway-columns";
import { holdGatewayMoneyAsCredit } from "@/lib/payments/gateway-review";

const METHOD_NAMES: Record<string, string> = {
  mada: "mada",
  card: "card",
  applepay: "Apple Pay",
  stcpay: "STC Pay",
  paypal: "PayPal",
};

/** The payment method stored on a payment a gateway took. */
export function gatewayPaymentMethod(gateway: GatewayId): PaymentMethod {
  return gateway === "paypal" ? PaymentMethod.PAYPAL : PaymentMethod.CREDIT_CARD;
}

/** The payment a gateway report is about, in the current organization. */
export async function findPaymentForState(gateway: GatewayId, state: GatewayPaymentState) {
  const omit = await gatewayColumnsOmit();
  if (state.paymentId) {
    const named = await db.payment.findFirst({ where: { id: state.paymentId }, omit });
    if (named) return named;
  }

  const references = [state.reference, state.sessionReference].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (references.length === 0) return null;

  if (await gatewayColumnsAvailable()) {
    const byReference = await db.payment.findFirst({
      where: { gatewayProvider: gateway, gatewayPaymentId: { in: references } },
      omit,
    });
    if (byReference) return byReference;
  }

  // Rows from before the generic columns, or written by Stripe's in-app flow.
  if (gateway === "stripe") {
    return db.payment.findFirst({
      where: {
        OR: [
          { stripePaymentIntentId: { in: references } },
          { stripeCheckoutSessionId: { in: references } },
        ],
      },
      omit,
    });
  }
  if (gateway === "paypal") {
    const legacy = await db.payment.findFirst({
      where: {
        OR: [{ paypalCaptureId: { in: references } }, { paypalOrderId: { in: references } }],
      },
      omit,
    });
    if (legacy) return legacy;
  }

  // An attempt taken off a payment that was then paid at the desk
  // (recordInstallmentPayment keeps it in the history): its money must still
  // find the payment, to be held as the tenant's credit rather than lost.
  for (const id of references) {
    const cleared = await db.payment.findFirst({
      where: {
        paymentHistory: {
          array_contains: [{ clearedAttempt: { provider: gateway, id } }],
        },
      },
      omit,
    });
    if (cleared) return cleared;
  }
  return null;
}

type FoundPayment = NonNullable<Awaited<ReturnType<typeof findPaymentForState>>>;

/** Reference columns to stamp on settlement — unless another payment already holds the reference. */
async function referenceFieldsFor(
  gateway: GatewayId,
  paymentId: string,
  state: GatewayPaymentState,
): Promise<GatewayReferenceFields> {
  if (!(await gatewayColumnsAvailable())) {
    // Before the migration only Stripe/PayPal flows run; their own columns.
    if (gateway === "stripe" && state.reference.startsWith("pi_")) {
      return { stripePaymentIntentId: state.reference };
    }
    return {};
  }
  const holder = await db.payment.findFirst({
    where: {
      gatewayProvider: gateway,
      gatewayPaymentId: state.reference,
      id: { not: paymentId },
      deletedAt: undefined,
    },
    select: { id: true },
  });
  if (holder) {
    console.error(
      `${gateway} reference ${state.reference} is already on payment ${holder.id}; not copied onto ${paymentId}.`,
    );
    return {};
  }
  return { gatewayProvider: gateway, gatewayPaymentId: state.reference };
}

export interface AppliedGatewayState {
  outcome: GatewayOutcome;
  /** True when this call recorded the money. */
  settled: boolean;
}

export async function applyGatewayState(
  gateway: GatewayId,
  payment: FoundPayment,
  state: GatewayPaymentState,
): Promise<AppliedGatewayState> {
  const name = getGatewayDef(gateway)?.name ?? gateway;
  const onFile = (payment as { gatewayPaymentId?: string | null }).gatewayPaymentId ?? null;
  const outcome = planGatewayOutcome(
    {
      id: payment.id,
      status: payment.status,
      gatewayPaymentId: onFile,
      recordedById: payment.recordedById,
    },
    state,
  );

  if (outcome.action === "review") {
    // Never dropped: the tenant's credit, and the office is told.
    await holdGatewayMoneyAsCredit(
      gateway,
      { ...payment, gatewayPaymentId: onFile },
      state,
      outcome.reason,
      gatewayPaymentMethod(gateway),
    );
    return { outcome, settled: false };
  }

  if (outcome.action === "fail") {
    await db.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING, version: payment.version },
      data: {
        status: PaymentStatus.FAILED,
        paymentHistory: [
          ...(((payment.paymentHistory as unknown) as unknown[]) ?? []),
          {
            amount: 0,
            paymentMethod: gatewayPaymentMethod(gateway),
            paidDate: new Date().toISOString(),
            transactionId: state.reference,
            notes: `Payment failed at ${name}${state.failureReason ? `: ${state.failureReason}` : ""}`,
          },
        ] as never,
        version: { increment: 1 },
        lastSyncedAt: new Date(),
      },
    });
    return { outcome, settled: false };
  }

  if (outcome.action !== "settle") return { outcome, settled: false };

  const method = state.method ? METHOD_NAMES[state.method] ?? state.method : null;
  const result = await settleGatewayPayment(payment.id, {
    amount: state.amount,
    currency: state.currency,
    paymentMethod: gatewayPaymentMethod(gateway),
    transactionId: state.reference,
    notes: method ? `Paid with ${method} through ${name}` : `Paid through ${name}`,
    referenceFields: await referenceFieldsFor(gateway, payment.id, state),
  });

  // A charge raised with no installment behind it goes to the tenant's
  // oldest open ones, as the Stripe webhook always did.
  if (result.applied && !payment.invoiceId && payment.tenantId) {
    try {
      const { paymentInvoiceLinkingService } = await import(
        "@/lib/services/payment-invoice-linking.service"
      );
      await paymentInvoiceLinkingService.applyPaymentToInvoices(
        payment.id,
        payment.tenantId,
        state.amount,
        payment.leaseId ?? undefined,
      );
    } catch (error) {
      console.error("Error linking a gateway payment to invoices:", error);
    }
  }
  return { outcome, settled: result.applied };
}
