/**
 * PropertyPro - PayPal (Orders v2 REST, https://developer.paypal.com)
 *
 * Hosted page: an order with intent CAPTURE; the payer approves on PayPal and
 * comes back to `return_url` with `token=<order id>`. Approval moves no
 * money — `confirmPayment` captures the order, which is why PayPal is the one
 * gateway where coming back is more than a question. The capture id is what
 * a refund names, so it replaces the order id once paid; `fetchPayment` takes
 * either. A capture refunded in part (PARTIALLY_REFUNDED) is still paid; what
 * went back is read from its order's refunds, which a capture does not list.
 *
 * Webhooks are verified by PayPal itself (POST
 * /v1/notifications/verify-webhook-signature with the office's webhook id).
 * An approved order the payer never came back from (CHECKOUT.ORDER.APPROVED)
 * is captured from the webhook.
 *
 * PayPal does not settle in the Saudi riyal: the registry lists the
 * currencies it takes, and the screens never offer it for SAR.
 */

import type {
  AdapterContext,
  GatewayAdapter,
  GatewayPaymentState,
  GatewayPaymentStatus,
} from "@/lib/payments/gateway-adapter";
import { credential, fetchOf } from "@/lib/payments/gateway-adapter";
import { GatewayHttpError, gatewayRequest, isNotFound } from "@/lib/payments/gateway-http";
import { formatMajor } from "@/lib/payments/gateway-money";

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";
const LIVE_BASE = "https://api-m.paypal.com";

export function paypalApiBase(mode: string | undefined): string {
  return mode === "live" ? LIVE_BASE : SANDBOX_BASE;
}

// OAuth tokens, keyed by the credentials they were minted with.
const tokens = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(ctx: AdapterContext): Promise<string> {
  const clientId = credential(ctx, "clientId", "PayPal", "Client ID");
  const clientSecret = credential(ctx, "clientSecret", "PayPal", "Client Secret");
  const base = paypalApiBase(ctx.credentials.mode);
  const key = `${base}:${clientId}:${clientSecret}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const data = await gatewayRequest<{ access_token?: string; expires_in?: number }>(
    "PayPal",
    fetchOf(ctx),
    `${base}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    },
  );
  if (!data?.access_token) throw new GatewayHttpError("PayPal", 401, "PayPal authentication failed");
  if (tokens.size > 100) tokens.clear();
  // Refreshed a minute early so a call never goes out on an expiring token.
  tokens.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(0, (data.expires_in ?? 3000) - 60) * 1000,
  });
  return data.access_token;
}

async function call<T = unknown>(
  ctx: AdapterContext,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const token = await accessToken(ctx);
  return gatewayRequest<T>("PayPal", fetchOf(ctx), `${paypalApiBase(ctx.credentials.mode)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
}

interface PayPalAmount {
  value?: string;
  currency_code?: string;
}

interface PayPalCapture {
  id: string;
  status: string;
  amount?: PayPalAmount;
  custom_id?: string;
  supplementary_data?: { related_ids?: { order_id?: string } };
  status_details?: { reason?: string };
}

interface PayPalRefund {
  id?: string;
  status?: string;
  amount?: PayPalAmount;
}

interface PayPalOrder {
  id: string;
  status: string;
  purchase_units?: Array<{
    custom_id?: string;
    reference_id?: string;
    amount?: PayPalAmount;
    payments?: { captures?: PayPalCapture[]; refunds?: PayPalRefund[] };
  }>;
  links?: Array<{ rel?: string; href?: string }>;
}

function captureStatus(status: string): GatewayPaymentStatus {
  switch (status) {
    case "COMPLETED":
      return "paid";
    // Refunded in part, the rest is still paid (see `refundedOf`).
    case "PARTIALLY_REFUNDED":
      return "paid";
    case "REFUNDED":
      return "refunded";
    case "DECLINED":
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

/** What an order's refunds sent back: completed ones and ones on their way. */
function refundedOf(refunds: PayPalRefund[] | undefined): number | undefined {
  if (!Array.isArray(refunds)) return undefined;
  const cents = refunds
    .filter((refund) => refund.status === "COMPLETED" || refund.status === "PENDING")
    .reduce((sum, refund) => sum + Math.round(Number(refund.amount?.value ?? 0) * 100), 0);
  return cents / 100;
}

function captureState(
  capture: PayPalCapture,
  orderId?: string | null,
  customId?: string | null,
  refunds?: PayPalRefund[],
): GatewayPaymentState {
  const refunded = refundedOf(refunds);
  return {
    reference: capture.id,
    sessionReference: orderId ?? capture.supplementary_data?.related_ids?.order_id ?? null,
    status: captureStatus(capture.status),
    amount: Number(capture.amount?.value ?? 0),
    ...(refunded !== undefined ? { refundedAmount: refunded } : {}),
    currency: String(capture.amount?.currency_code ?? "").toUpperCase(),
    paymentId: capture.custom_id ?? customId ?? null,
    method: "paypal",
    failureReason: capture.status_details?.reason ?? null,
  };
}

function orderState(order: PayPalOrder): GatewayPaymentState {
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (capture) {
    // An order lists its refunds only once there are some.
    const refunds =
      unit?.payments?.refunds ??
      (capture.status === "COMPLETED" ? [] : undefined);
    return captureState(capture, order.id, unit?.custom_id ?? null, refunds);
  }
  return {
    reference: order.id,
    sessionReference: order.id,
    status: order.status === "VOIDED" ? "failed" : "pending",
    amount: Number(unit?.amount?.value ?? 0),
    currency: String(unit?.amount?.currency_code ?? "").toUpperCase(),
    paymentId: unit?.custom_id ?? null,
    method: "paypal",
  };
}

async function fetchCapture(ctx: AdapterContext, reference: string): Promise<GatewayPaymentState | null> {
  let capture: PayPalCapture;
  try {
    capture = await call<PayPalCapture>(ctx, `/v2/payments/captures/${encodeURIComponent(reference)}`);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  if (capture.status === "COMPLETED") return captureState(capture, null, null, []);
  // Refunded in part or in full: how much is on the order it came from.
  const orderId = capture.supplementary_data?.related_ids?.order_id;
  if (orderId && (capture.status === "PARTIALLY_REFUNDED" || capture.status === "REFUNDED")) {
    try {
      const order = await call<PayPalOrder>(ctx, `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
      const unit = order.purchase_units?.find((entry) =>
        entry.payments?.captures?.some((item) => item.id === capture.id),
      );
      return captureState(capture, orderId, unit?.custom_id ?? null, unit?.payments?.refunds);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  return captureState(capture);
}

/** Where an order — or, once paid, its capture — stands. */
async function fetchPayment(ctx: AdapterContext, reference: string): Promise<GatewayPaymentState | null> {
  try {
    return orderState(await call<PayPalOrder>(ctx, `/v2/checkout/orders/${encodeURIComponent(reference)}`));
  } catch (error) {
    if (isNotFound(error)) return fetchCapture(ctx, reference);
    throw error;
  }
}

/** Capture an approved order; an order captured already reports its capture. */
async function confirmPayment(ctx: AdapterContext, reference: string): Promise<GatewayPaymentState | null> {
  let order: PayPalOrder;
  try {
    order = await call<PayPalOrder>(ctx, `/v2/checkout/orders/${encodeURIComponent(reference)}`);
  } catch (error) {
    if (isNotFound(error)) return fetchCapture(ctx, reference);
    throw error;
  }
  if (order.status !== "APPROVED") return orderState(order);

  try {
    const captured = await call<PayPalOrder>(
      ctx,
      `/v2/checkout/orders/${encodeURIComponent(reference)}/capture`,
      { method: "POST", body: {}, headers: { "PayPal-Request-Id": `capture-${reference}` } },
    );
    return orderState(captured);
  } catch (error) {
    // Captured by the webhook a moment earlier: read where it stands.
    const body = (error as GatewayHttpError)?.body as { name?: string; details?: Array<{ issue?: string }> } | undefined;
    if (
      body?.name === "UNPROCESSABLE_ENTITY" &&
      body.details?.some((detail) => detail.issue === "ORDER_ALREADY_CAPTURED")
    ) {
      return fetchPayment(ctx, reference);
    }
    throw error;
  }
}

const SIGNATURE_HEADERS = [
  "paypal-auth-algo",
  "paypal-cert-url",
  "paypal-transmission-id",
  "paypal-transmission-sig",
  "paypal-transmission-time",
] as const;

export const paypalAdapter: GatewayAdapter = {
  id: "paypal",

  async createCheckout(ctx, input) {
    const currency = input.currency.toUpperCase();
    const order = await call<PayPalOrder>(ctx, "/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": input.idempotencyKey },
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.paymentId,
            custom_id: input.paymentId,
            description: input.description.slice(0, 127),
            amount: { currency_code: currency, value: formatMajor(input.amount, currency) },
          },
        ],
        application_context: {
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          locale: input.locale === "ar" ? "ar-SA" : "en-US",
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
      },
    });
    const approve = order.links?.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href;
    if (!order?.id || !approve) throw new Error("PayPal did not return an approval page.");
    return { reference: order.id, redirectUrl: approve };
  },

  async verifyWebhook(ctx, delivery) {
    const webhookId = credential(ctx, "webhookId", "PayPal", "Webhook ID");
    let event: { id?: string; event_type?: string; resource?: Record<string, unknown> };
    try {
      event = JSON.parse(delivery.rawBody);
    } catch {
      return null;
    }
    const headers = Object.fromEntries(
      SIGNATURE_HEADERS.map((name) => [name, delivery.headers.get(name)]),
    );
    if (SIGNATURE_HEADERS.some((name) => !headers[name]) || !event?.id) return null;

    const result = await call<{ verification_status?: string }>(
      ctx,
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: {
          auth_algo: headers["paypal-auth-algo"],
          cert_url: headers["paypal-cert-url"],
          transmission_id: headers["paypal-transmission-id"],
          transmission_sig: headers["paypal-transmission-sig"],
          transmission_time: headers["paypal-transmission-time"],
          webhook_id: webhookId,
          webhook_event: event,
        },
      },
    );
    if (result?.verification_status !== "SUCCESS") return null;

    const type = String(event.event_type ?? "");
    const resource = event.resource ?? {};
    let payment: GatewayPaymentState | null = null;
    let confirmWithApi = false;
    if (type.startsWith("PAYMENT.CAPTURE.") && type !== "PAYMENT.CAPTURE.REFUNDED" && resource.id) {
      payment = captureState(resource as unknown as PayPalCapture);
    } else if (type === "CHECKOUT.ORDER.APPROVED" && resource.id) {
      // Approved and never captured: the payer did not come back.
      payment = orderState(resource as unknown as PayPalOrder);
      confirmWithApi = true;
    }
    return { eventId: String(event.id), type, payment, confirmWithApi };
  },

  fetchPayment,
  confirmPayment,

  async refund(ctx, input) {
    const currency = input.currency.toUpperCase();
    const refund = await call<{ id?: string; status?: string; amount?: PayPalAmount }>(
      ctx,
      `/v2/payments/captures/${encodeURIComponent(input.reference)}/refund`,
      {
        method: "POST",
        // Per amount: the rest of a payment refunded in part in PayPal's
        // dashboard is a refund of its own, not a replay of an earlier one.
        headers: { "PayPal-Request-Id": `refund-${input.paymentId}-${formatMajor(input.amount, currency)}` },
        body: { amount: { value: formatMajor(input.amount, currency), currency_code: currency } },
      },
    );
    if (!refund.id || refund.status === "CANCELLED" || refund.status === "FAILED") {
      throw new GatewayHttpError("PayPal", 402, "PayPal declined the refund.", refund);
    }
    return {
      refundId: refund.id,
      status: refund.status === "COMPLETED" ? "succeeded" : "pending",
      amount: Number(refund.amount?.value ?? input.amount),
    };
  },

  async testCredentials(ctx) {
    await accessToken(ctx);
  },
};
