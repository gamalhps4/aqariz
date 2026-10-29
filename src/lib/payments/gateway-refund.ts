/**
 * PropertyPro - Refunding a payment, online ones through their gateway
 *
 * A payment a gateway took is refunded at that gateway, from the office's own
 * merchant account, and then taken off the books (refundRecordedPayment
 * reverses its installments). Desk payments only have the second step.
 *
 * The gateway goes first: books saying "refunded" while the money stayed
 * with the office would be the worse failure. If the books then fail (the
 * row changed a moment ago), trying again finds the gateway already reports
 * the refund and does not ask for a second one.
 *
 * Full refunds only — the books reverse the whole payment. Part of it may
 * already have gone back from the gateway's dashboard: the gateway is asked
 * how much, only the rest is refunded now, and the refund entry records both
 * parts (./gateway-refund-plan.ts).
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import { PaymentStatus } from "@/types";
import { getGatewayDef, isGatewayId } from "@/lib/payments/gateway-registry";
import { getGatewayAdapter } from "@/lib/payments/adapters";
import type { RefundResult } from "@/lib/payments/gateway-adapter";
import { planGatewayRefund } from "@/lib/payments/gateway-refund-plan";
import { gatewayReferenceOf } from "@/lib/payments/gateway-reference";
import { gatewayColumnsOmit } from "@/lib/payments/gateway-columns";
import { chargeCurrency } from "@/lib/payments/gateway-currency";
import { getStoredGatewayCredentials } from "@/lib/services/payment-config.service";
import { refundRecordedPayment } from "@/lib/services/payment-invoice-linking.service";

export class GatewayRefundError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GatewayRefundError";
    this.status = status;
  }
}

export interface PaymentRefund {
  reversed: Awaited<ReturnType<typeof refundRecordedPayment>>["reversed"];
  /**
   * Set when the money went back through a gateway. `amount` is what was
   * refunded now; `refundedEarlier` what the gateway had already sent back
   * (a refund made in its dashboard).
   */
  gatewayRefund?: RefundResult & {
    gateway: string;
    alreadyRefunded: boolean;
    refundedEarlier: number;
  };
}

export async function refundPayment(paymentId: string, refundedBy: string): Promise<PaymentRefund> {
  const payment = await db.payment.findFirst({
    where: { id: paymentId },
    omit: await gatewayColumnsOmit(),
  });
  // Missing or not paid: refundRecordedPayment refuses with its own words.
  if (!payment || payment.status !== PaymentStatus.PAID) {
    return refundRecordedPayment(paymentId, refundedBy);
  }

  // Taken online: a gateway reference and nobody recorded it at the desk. A
  // checkout opened and then paid in cash carries both — the person wins.
  const reference = payment.recordedById ? null : gatewayReferenceOf(payment);
  if (!reference || !isGatewayId(reference.provider)) {
    return refundRecordedPayment(paymentId, refundedBy);
  }

  const gateway = reference.provider;
  const name = getGatewayDef(gateway)?.name ?? gateway;
  const credentials = await getStoredGatewayCredentials(gateway);
  if (Object.keys(credentials).length === 0) {
    throw new GatewayRefundError(
      `This payment was made through ${name}, and the office's ${name} account is no longer connected. Reconnect it in Settings → Online payments to refund it.`,
      409,
    );
  }

  const adapter = getGatewayAdapter(gateway);
  const received = Number(payment.amountPaid || payment.amount);
  const currency = chargeCurrency(payment.currency);
  let gatewayRefund: PaymentRefund["gatewayRefund"];
  try {
    const state = await adapter.fetchPayment({ credentials }, reference.id);
    const plan = planGatewayRefund(received, state);
    if (plan.toRefund <= 0) {
      gatewayRefund = {
        gateway,
        refundId: state?.reference ?? reference.id,
        status: "succeeded",
        amount: 0,
        alreadyRefunded: true,
        refundedEarlier: plan.refundedEarlier,
      };
    } else {
      const result = await adapter.refund(
        { credentials },
        { reference: state?.reference ?? reference.id, amount: plan.toRefund, currency, paymentId: payment.id },
      );
      gatewayRefund = {
        ...result,
        gateway,
        alreadyRefunded: false,
        refundedEarlier: plan.refundedEarlier,
      };
    }
  } catch (error) {
    console.error(`${name} refund failed for payment ${payment.id}`, error);
    const reason = error instanceof Error && error.message ? `: ${error.message.replace(/\.$/, "")}` : "";
    throw new GatewayRefundError(
      `${name} did not refund the payment${reason}. Nothing was changed.`,
      502,
    );
  }

  const { reversed } = await refundRecordedPayment(paymentId, refundedBy, {
    gateway,
    refundId: gatewayRefund.alreadyRefunded ? null : gatewayRefund.refundId,
    refundedNow: gatewayRefund.amount,
    refundedEarlier: gatewayRefund.refundedEarlier,
  });
  return { reversed, gatewayRefund };
}
