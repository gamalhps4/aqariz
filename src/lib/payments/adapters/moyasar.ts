/**
 * PropertyPro - Moyasar (https://docs.moyasar.com)
 *
 * Hosted page: an Invoice (POST /v1/invoices). Its `url` is Moyasar's
 * checkout page, which offers whatever the office's Moyasar account has
 * switched on — mada, Visa/Mastercard, Apple Pay, STC Pay. Amounts are
 * integers in halalas. Auth is HTTP Basic with the secret key as the user.
 *
 * The invoice id is stored at checkout; once paid, the payment's own id is,
 * because that is what a refund names. Both are UUIDs, so `fetchPayment`
 * asks for a payment first and falls back to an invoice. A payment carries
 * what was refunded on it (`refunded`, halalas): Moyasar calls a payment
 * "refunded" after a partial refund too, so the amount decides.
 *
 * Webhooks (Moyasar Dashboard → Webhooks) carry the office's `secret_token`
 * in the body rather than a signature over it. A token match proves the
 * sender knows the secret, not that the body is untouched, so the payment is
 * read back from the API before anything is recorded (`confirmWithApi`).
 */

import type {
  AdapterContext,
  GatewayAdapter,
  GatewayPaymentState,
  GatewayPaymentStatus,
} from "@/lib/payments/gateway-adapter";
import { credential, fetchOf } from "@/lib/payments/gateway-adapter";
import { gatewayRequest, isNotFound, safeEqual } from "@/lib/payments/gateway-http";
import { fromMinor, toMinor } from "@/lib/payments/gateway-money";
import type { GatewayMethod } from "@/lib/payments/gateway-registry";

export const MOYASAR_API = "https://api.moyasar.com/v1";

function authHeader(ctx: AdapterContext): Record<string, string> {
  const secretKey = credential(ctx, "secretKey", "Moyasar", "Secret Key");
  return {
    Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
  };
}

function call<T = unknown>(
  ctx: AdapterContext,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  return gatewayRequest<T>("Moyasar", fetchOf(ctx), `${MOYASAR_API}${path}`, {
    ...init,
    headers: authHeader(ctx),
  });
}

interface MoyasarPayment {
  id: string;
  status: string;
  amount: number;
  refunded?: number;
  currency: string;
  invoice_id?: string | null;
  metadata?: Record<string, string> | null;
  message?: string | null;
  source?: { type?: string; company?: string; message?: string | null } | null;
}

interface MoyasarInvoice {
  id: string;
  status: string;
  amount: number;
  currency: string;
  url?: string;
  metadata?: Record<string, string> | null;
  payments?: MoyasarPayment[];
}

function paymentStatus(status: string): GatewayPaymentStatus {
  switch (status) {
    case "paid":
    case "captured":
      return "paid";
    case "refunded":
      return "refunded";
    case "failed":
    case "voided":
    case "canceled":
    case "expired":
      return "failed";
    default:
      // initiated, authorized, verified, on_hold
      return "pending";
  }
}

function methodOf(source: MoyasarPayment["source"]): GatewayMethod | null {
  if (!source) return null;
  if (String(source.company ?? "").toLowerCase() === "mada") return "mada";
  switch (source.type) {
    case "applepay":
      return "applepay";
    case "stcpay":
      return "stcpay";
    case "creditcard":
      return "card";
    default:
      return null;
  }
}

function paymentState(payment: MoyasarPayment, invoiceId?: string): GatewayPaymentState {
  const currency = String(payment.currency || "SAR").toUpperCase();
  const refunded = typeof payment.refunded === "number" ? payment.refunded : undefined;
  let status = paymentStatus(payment.status);
  // Refunded in part, the rest is still paid.
  if (status === "refunded" && refunded !== undefined && refunded < payment.amount) status = "paid";
  return {
    reference: payment.id,
    sessionReference: invoiceId ?? payment.invoice_id ?? null,
    status,
    amount: fromMinor(payment.amount, currency),
    ...(refunded !== undefined ? { refundedAmount: fromMinor(refunded, currency) } : {}),
    currency,
    paymentId: payment.metadata?.paymentId ?? null,
    method: methodOf(payment.source),
    failureReason:
      status === "failed"
        ? (payment.source?.message ?? payment.message ?? null)
        : null,
  };
}

/** An invoice reported as the payment it settled, or the attempt it is waiting on. */
function invoiceState(invoice: MoyasarInvoice): GatewayPaymentState {
  const currency = String(invoice.currency || "SAR").toUpperCase();
  const payments = invoice.payments ?? [];
  const settled =
    payments.find((p) => paymentStatus(p.status) === "paid") ??
    payments.find((p) => paymentStatus(p.status) === "refunded");
  if (settled) {
    const state = paymentState(settled, invoice.id);
    return { ...state, paymentId: state.paymentId ?? invoice.metadata?.paymentId ?? null };
  }
  const status = paymentStatus(invoice.status);
  const last = payments[payments.length - 1];
  return {
    reference: invoice.id,
    sessionReference: invoice.id,
    // An invoice still open after a declined attempt can be paid again.
    status: status === "paid" ? "pending" : status,
    amount: fromMinor(invoice.amount, currency),
    currency,
    paymentId: invoice.metadata?.paymentId ?? null,
    method: last ? methodOf(last.source) : null,
    failureReason: last?.source?.message ?? null,
  };
}

async function fetchPayment(
  ctx: AdapterContext,
  reference: string,
): Promise<GatewayPaymentState | null> {
  try {
    const payment = await call<MoyasarPayment>(ctx, `/payments/${encodeURIComponent(reference)}`);
    return paymentState(payment);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  try {
    const invoice = await call<MoyasarInvoice>(ctx, `/invoices/${encodeURIComponent(reference)}`);
    return invoiceState(invoice);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export const moyasarAdapter: GatewayAdapter = {
  id: "moyasar",

  async createCheckout(ctx, input) {
    const currency = input.currency.toUpperCase();
    const invoice = await call<MoyasarInvoice>(ctx, "/invoices", {
      method: "POST",
      body: {
        amount: toMinor(input.amount, currency),
        currency,
        description: input.description.slice(0, 255),
        success_url: input.returnUrl,
        back_url: input.cancelUrl,
        metadata: {
          paymentId: input.paymentId,
          organizationId: input.organizationId,
          source: "PropertyPro",
        },
      },
    });
    if (!invoice?.id || !invoice.url) {
      throw new Error("Moyasar did not return a payment page for the invoice.");
    }
    return { reference: invoice.id, redirectUrl: invoice.url };
  },

  async verifyWebhook(ctx, delivery) {
    const secret = credential(ctx, "webhookSecret", "Moyasar", "Webhook Secret Token");
    let event: {
      id?: string;
      type?: string;
      secret_token?: string;
      data?: MoyasarPayment;
    };
    try {
      event = JSON.parse(delivery.rawBody);
    } catch {
      return null;
    }
    if (!safeEqual(event?.secret_token, secret)) return null;
    if (!event.id || !event.type) return null;
    const data = event.data;
    const isPayment = Boolean(data?.id && typeof data.amount === "number");
    return {
      eventId: String(event.id),
      type: String(event.type),
      payment: isPayment ? paymentState(data!) : null,
      confirmWithApi: true,
    };
  },

  fetchPayment,

  // Nothing to capture: Moyasar's hosted page captures on payment.
  confirmPayment: fetchPayment,

  async refund(ctx, input) {
    const currency = input.currency.toUpperCase();
    const payment = await call<MoyasarPayment>(
      ctx,
      `/payments/${encodeURIComponent(input.reference)}/refund`,
      { method: "POST", body: { amount: toMinor(input.amount, currency) } },
    );
    // `refunded` is what the payment has had back in all, earlier refunds
    // included; this refund is the amount asked for.
    return {
      refundId: payment.id,
      status: payment.status === "refunded" ? "succeeded" : "pending",
      amount: input.amount,
    };
  },

  async testCredentials(ctx) {
    await call(ctx, "/payments?page=1");
  },
};
