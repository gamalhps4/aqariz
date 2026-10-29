/**
 * PropertyPro - Tap Payments (https://developers.tap.company)
 *
 * Hosted page: a Charge (POST /v2/charges) with `source.id = "src_all"`,
 * whose `transaction.url` is Tap's payment page offering every method the
 * office's account has (mada, Visa/Mastercard, Apple Pay, STC Pay). Amounts
 * are decimals in the major unit. Auth is the secret key as a Bearer token.
 *
 * The charge id (`chg_…`) is known from the start and stays the payment's id.
 * Our Payment id goes in `metadata.paymentId` and `reference.transaction`.
 *
 * Notifications go to the `post.url` set on each charge and carry a
 * `hashstring` header: hex HMAC-SHA256, keyed with the secret key, of
 *   x_id{id}x_amount{amount}x_currency{currency}x_gateway_reference{…}
 *   x_payment_reference{…}x_status{status}x_created{transaction.created}
 * with the amount written to the currency's decimals ("100.00", "1.250").
 */

import type {
  AdapterContext,
  GatewayAdapter,
  GatewayPaymentState,
  GatewayPaymentStatus,
} from "@/lib/payments/gateway-adapter";
import { credential, fetchOf } from "@/lib/payments/gateway-adapter";
import {
  GatewayHttpError,
  gatewayRequest,
  hmacSha256Hex,
  isNotFound,
  safeEqual,
} from "@/lib/payments/gateway-http";
import { formatMajor } from "@/lib/payments/gateway-money";
import type { GatewayMethod } from "@/lib/payments/gateway-registry";

export const TAP_API = "https://api.tap.company/v2";

function call<T = unknown>(
  ctx: AdapterContext,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const secretKey = credential(ctx, "secretKey", "Tap", "Secret Key");
  return gatewayRequest<T>("Tap", fetchOf(ctx), `${TAP_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey}` },
  });
}

interface TapCharge {
  id: string;
  object?: string;
  status: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string> | null;
  reference?: { transaction?: string; order?: string; gateway?: string; payment?: string } | null;
  transaction?: { url?: string; created?: string | number } | null;
  source?: { payment_method?: string; payment_type?: string; id?: string } | null;
  response?: { code?: string; message?: string } | null;
}

function statusOf(status: string): GatewayPaymentStatus {
  switch (String(status).toUpperCase()) {
    case "CAPTURED":
      return "paid";
    case "INITIATED":
    case "IN_PROGRESS":
    case "AUTHORIZED":
      return "pending";
    case "REFUNDED":
      return "refunded";
    default:
      // ABANDONED, CANCELLED, FAILED, DECLINED, RESTRICTED, VOID, TIMEDOUT, UNKNOWN
      return "failed";
  }
}

function methodOf(source: TapCharge["source"]): GatewayMethod | null {
  const value = `${source?.payment_method ?? ""} ${source?.id ?? ""}`.toLowerCase();
  if (!value.trim()) return null;
  if (value.includes("mada")) return "mada";
  if (value.includes("apple")) return "applepay";
  if (value.includes("stc")) return "stcpay";
  return "card";
}

function chargeState(charge: TapCharge): GatewayPaymentState {
  const currency = String(charge.currency || "SAR").toUpperCase();
  const status = statusOf(charge.status);
  return {
    reference: charge.id,
    status,
    amount: Number(charge.amount),
    currency,
    paymentId: charge.metadata?.paymentId ?? charge.reference?.transaction ?? null,
    method: methodOf(charge.source),
    failureReason: status === "failed" ? (charge.response?.message ?? null) : null,
  };
}

/** The string Tap signs a charge notification over. */
export function tapHashString(charge: TapCharge): string {
  const currency = String(charge.currency ?? "");
  return (
    `x_id${charge.id ?? ""}` +
    `x_amount${formatMajor(Number(charge.amount), currency)}` +
    `x_currency${currency}` +
    `x_gateway_reference${charge.reference?.gateway ?? ""}` +
    `x_payment_reference${charge.reference?.payment ?? ""}` +
    `x_status${charge.status ?? ""}` +
    `x_created${charge.transaction?.created ?? ""}`
  );
}

async function fetchCharge(ctx: AdapterContext, reference: string): Promise<GatewayPaymentState | null> {
  try {
    return chargeState(await call<TapCharge>(ctx, `/charges/${encodeURIComponent(reference)}`));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export const tapAdapter: GatewayAdapter = {
  id: "tap",

  async createCheckout(ctx, input) {
    const currency = input.currency.toUpperCase();
    const [firstName, ...rest] = input.customer.name.trim().split(/\s+/);
    const charge = await call<TapCharge>(ctx, "/charges", {
      method: "POST",
      body: {
        amount: Number(formatMajor(input.amount, currency)),
        currency,
        threeDSecure: true,
        save_card: false,
        description: input.description.slice(0, 255),
        metadata: {
          paymentId: input.paymentId,
          organizationId: input.organizationId,
          source: "PropertyPro",
        },
        reference: { transaction: input.paymentId, order: input.paymentId },
        receipt: { email: false, sms: false },
        customer: {
          first_name: firstName || input.customer.name || "Tenant",
          ...(rest.length ? { last_name: rest.join(" ") } : {}),
          ...(input.customer.email ? { email: input.customer.email } : {}),
        },
        source: { id: "src_all" },
        post: { url: input.webhookUrl },
        redirect: { url: input.returnUrl },
      },
    });
    const url = charge?.transaction?.url;
    if (!charge?.id || !url) {
      throw new Error(charge?.response?.message || "Tap did not return a payment page.");
    }
    return { reference: charge.id, redirectUrl: url };
  },

  async verifyWebhook(ctx, delivery) {
    const secretKey = credential(ctx, "secretKey", "Tap", "Secret Key");
    const signature = delivery.headers.get("hashstring");
    if (!signature) return null;
    let charge: TapCharge;
    try {
      charge = JSON.parse(delivery.rawBody);
    } catch {
      return null;
    }
    if (!charge?.id) return null;
    const expected = hmacSha256Hex(secretKey, tapHashString(charge));
    if (!safeEqual(signature.trim().toLowerCase(), expected)) return null;
    const isCharge = String(charge.id).startsWith("chg_") || charge.object === "charge";
    return {
      eventId: `${charge.id}:${charge.status}`,
      type: `${charge.object ?? "charge"}.${String(charge.status).toLowerCase()}`,
      payment: isCharge ? chargeState(charge) : null,
    };
  },

  fetchPayment: fetchCharge,

  // src_all charges capture on payment; coming back is only a question.
  confirmPayment: fetchCharge,

  async refund(ctx, input) {
    const currency = input.currency.toUpperCase();
    const refund = await call<{ id?: string; status?: string; amount?: number; response?: { message?: string } }>(
      ctx,
      "/refunds",
      {
        method: "POST",
        body: {
          charge_id: input.reference,
          amount: Number(formatMajor(input.amount, currency)),
          currency,
          reason: "requested_by_customer",
          reference: { merchant: input.paymentId },
          metadata: { paymentId: input.paymentId },
        },
      },
    );
    const status = String(refund.status ?? "").toUpperCase();
    if (!refund.id || ["FAILED", "DECLINED", "CANCELLED"].includes(status)) {
      throw new GatewayHttpError("Tap", 402, refund.response?.message || "Tap declined the refund.", refund);
    }
    return {
      refundId: refund.id,
      status: status === "REFUNDED" ? "succeeded" : "pending",
      amount: Number(refund.amount ?? input.amount),
    };
  },

  async testCredentials(ctx) {
    try {
      await call(ctx, "/charges/chg_credentials_check");
    } catch (error) {
      // An unknown charge is the expected answer for a key that works.
      if (error instanceof GatewayHttpError && (error.status === 404 || error.status === 400)) return;
      throw error;
    }
  },
};
