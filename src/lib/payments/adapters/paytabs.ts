/**
 * PropertyPro - PayTabs (https://support.paytabs.com, PT2 API)
 *
 * Hosted page: POST /payment/request with tran_type "sale" returns a
 * `redirect_url` to PayTabs' payment page (mada, Visa/Mastercard, Apple Pay,
 * STC Pay — whatever the profile has). Each profile lives on one regional
 * domain (secure.paytabs.sa for Saudi profiles). Amounts are decimals in the
 * major unit. Auth is the profile's server key in the `authorization` header.
 *
 * Our Payment id travels as `cart_id`; the transaction reference
 * (`tran_ref`) is what PayTabs knows the payment by, before and after it is
 * paid.
 *
 * Notifications (`callback`) carry a `signature` header: hex HMAC-SHA256 of
 * the raw body keyed with the same server key. The browser's return to
 * `return` is a form POST that is not trusted at all — the return route asks
 * PayTabs (POST /payment/query) instead.
 */

import type {
  AdapterContext,
  GatewayAdapter,
  GatewayPaymentState,
  GatewayPaymentStatus,
} from "@/lib/payments/gateway-adapter";
import { credential, fetchOf } from "@/lib/payments/gateway-adapter";
import {
  GatewayConfigError,
  GatewayHttpError,
  gatewayRequest,
  hmacSha256Hex,
  safeEqual,
} from "@/lib/payments/gateway-http";
import { formatMajor } from "@/lib/payments/gateway-money";
import { PAYTABS_REGIONS, type GatewayMethod } from "@/lib/payments/gateway-registry";

function baseUrl(ctx: AdapterContext): string {
  const region = String(ctx.credentials.region || "SAU").toUpperCase();
  const base = PAYTABS_REGIONS[region];
  if (!base) throw new GatewayConfigError(`PayTabs: unknown region "${region}".`);
  return base;
}

function profileId(ctx: AdapterContext): number {
  const raw = credential(ctx, "profileId", "PayTabs", "Profile ID");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new GatewayConfigError("PayTabs: the Profile ID must be a number.");
  }
  return id;
}

function call<T = unknown>(ctx: AdapterContext, path: string, body: unknown): Promise<T> {
  const serverKey = credential(ctx, "serverKey", "PayTabs", "Server Key");
  return gatewayRequest<T>("PayTabs", fetchOf(ctx), `${baseUrl(ctx)}${path}`, {
    method: "POST",
    headers: { authorization: serverKey },
    body,
  });
}

interface PayTabsTransaction {
  tran_ref?: string;
  tran_type?: string;
  cart_id?: string;
  cart_currency?: string;
  cart_amount?: string | number;
  tran_currency?: string;
  tran_total?: string | number;
  payment_result?: {
    response_status?: string;
    response_code?: string;
    response_message?: string;
  };
  payment_info?: { payment_method?: string; card_scheme?: string };
  /** Error answers: { code, message }. */
  code?: number;
  message?: string;
}

/** PayTabs' one-letter result: Authorised, Pending, On hold, Declined, Error, Voided, eXpired. */
function statusOf(code: string | undefined): GatewayPaymentStatus {
  switch (String(code ?? "").toUpperCase()) {
    case "A":
      return "paid";
    case "P":
    case "H":
      return "pending";
    default:
      return "failed";
  }
}

function methodOf(info: PayTabsTransaction["payment_info"]): GatewayMethod | null {
  const value = `${info?.payment_method ?? ""} ${info?.card_scheme ?? ""}`.toLowerCase();
  if (!value.trim()) return null;
  if (value.includes("mada")) return "mada";
  if (value.includes("apple")) return "applepay";
  if (value.includes("stc")) return "stcpay";
  return "card";
}

function transactionState(tx: PayTabsTransaction): GatewayPaymentState {
  const currency = String(tx.tran_currency || tx.cart_currency || "SAR").toUpperCase();
  const status = statusOf(tx.payment_result?.response_status);
  return {
    reference: String(tx.tran_ref),
    status,
    amount: Number(tx.tran_total ?? tx.cart_amount ?? 0),
    currency,
    paymentId: tx.cart_id ? String(tx.cart_id) : null,
    method: methodOf(tx.payment_info),
    failureReason: status === "failed" ? (tx.payment_result?.response_message ?? null) : null,
  };
}

/** A sale (or the absence of a type, as on older callbacks) — not a refund or a void. */
function isSale(tx: PayTabsTransaction): boolean {
  const type = String(tx.tran_type ?? "sale").toLowerCase();
  return type === "sale" || type === "capture";
}

async function query(ctx: AdapterContext, reference: string): Promise<GatewayPaymentState | null> {
  let tx: PayTabsTransaction;
  try {
    tx = await call<PayTabsTransaction>(ctx, "/payment/query", {
      profile_id: profileId(ctx),
      tran_ref: reference,
    });
  } catch (error) {
    // PayTabs answers an unknown reference with a 4xx error body.
    if (error instanceof GatewayHttpError && (error.status === 400 || error.status === 404)) {
      return null;
    }
    throw error;
  }
  if (!tx?.tran_ref) return null;
  return transactionState(tx);
}

export const paytabsAdapter: GatewayAdapter = {
  id: "paytabs",

  async createCheckout(ctx, input) {
    const currency = input.currency.toUpperCase();
    const page = await call<{ tran_ref?: string; redirect_url?: string }>(
      ctx,
      "/payment/request",
      {
        profile_id: profileId(ctx),
        tran_type: "sale",
        tran_class: "ecom",
        cart_id: input.paymentId,
        cart_currency: currency,
        cart_amount: Number(formatMajor(input.amount, currency)),
        cart_description: input.description.slice(0, 128),
        paypage_lang: input.locale,
        hide_shipping: true,
        customer_details: {
          name: input.customer.name,
          ...(input.customer.email ? { email: input.customer.email } : {}),
          ...(input.customer.phone ? { phone: input.customer.phone } : {}),
        },
        callback: input.webhookUrl,
        return: input.returnUrl,
      },
    );
    if (!page?.tran_ref || !page.redirect_url) {
      throw new Error("PayTabs did not return a payment page.");
    }
    return { reference: page.tran_ref, redirectUrl: page.redirect_url };
  },

  async verifyWebhook(ctx, delivery) {
    const serverKey = credential(ctx, "serverKey", "PayTabs", "Server Key");
    const signature = delivery.headers.get("signature");
    if (!signature) return null;
    const expected = hmacSha256Hex(serverKey, delivery.rawBody);
    if (!safeEqual(signature.trim().toLowerCase(), expected)) return null;

    let tx: PayTabsTransaction;
    try {
      tx = JSON.parse(delivery.rawBody);
    } catch {
      return null;
    }
    if (!tx?.tran_ref) return null;
    const status = String(tx.payment_result?.response_status ?? "").toUpperCase();
    return {
      // One notification per transaction and result.
      eventId: `${tx.tran_ref}:${status || "-"}`,
      type: `${String(tx.tran_type ?? "sale").toLowerCase()}.${status || "unknown"}`,
      payment: isSale(tx) ? transactionState(tx) : null,
    };
  },

  fetchPayment: query,

  // The hosted page captures on payment; coming back is only a question.
  confirmPayment: query,

  async refund(ctx, input) {
    const currency = input.currency.toUpperCase();
    const tx = await call<PayTabsTransaction>(ctx, "/payment/request", {
      profile_id: profileId(ctx),
      tran_type: "refund",
      tran_class: "ecom",
      cart_id: input.paymentId,
      cart_currency: currency,
      cart_amount: Number(formatMajor(input.amount, currency)),
      cart_description: "Refund",
      tran_ref: input.reference,
    });
    const status = String(tx.payment_result?.response_status ?? "").toUpperCase();
    if (status !== "A" && status !== "P" && status !== "H") {
      throw new GatewayHttpError(
        "PayTabs",
        402,
        tx.payment_result?.response_message || "PayTabs declined the refund.",
        tx,
      );
    }
    return {
      refundId: String(tx.tran_ref ?? input.reference),
      status: status === "A" ? "succeeded" : "pending",
      amount: Number(tx.tran_total ?? tx.cart_amount ?? input.amount),
    };
  },

  async testCredentials(ctx) {
    try {
      await call(ctx, "/payment/query", {
        profile_id: profileId(ctx),
        tran_ref: "TST0000000000000",
      });
    } catch (error) {
      // An unknown reference is the expected answer for a key that works.
      if (error instanceof GatewayHttpError && error.status !== 401 && error.status !== 403 && error.status !== 0) {
        const message = String(error.message).toLowerCase();
        if (!message.includes("authentication") && !message.includes("profile")) return;
      }
      throw error;
    }
  },
};
