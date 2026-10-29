/**
 * PropertyPro - One interface for every payment gateway
 *
 * Stripe, PayPal, Moyasar, PayTabs and Tap each speak their own API. An
 * adapter (lib/payments/adapters/<id>.ts) turns that API into the five things
 * the rest of the app needs from any of them:
 *
 *   createCheckout   open the gateway's hosted payment page for one payment
 *                    and return the address to send the payer to
 *   verifyWebhook    check a delivery's signature with the office's secret and
 *                    say what it means for a payment — or null when forged
 *   fetchPayment     ask the gateway, with the office's secret, where a
 *                    payment stands (read-only)
 *   confirmPayment   the same, after the payer comes back; PayPal also
 *                    captures the approved order here
 *   refund           give the money back
 *
 * Adapters are pure translators: they never read or write the database. The
 * office's credentials are passed in (lib/services/payment-config.service.ts
 * resolves them), and so is `fetch`, which is how the tests answer for the
 * gateway. What a gateway's answer does to a payment is decided once, for all
 * of them, in ./gateway-outcome.ts. `getGatewayAdapter` is in ./adapters/index.ts.
 */

import type { GatewayId, GatewayMethod } from "@/lib/payments/gateway-registry";
import { GatewayConfigError, type FetchLike } from "@/lib/payments/gateway-http";

export interface AdapterContext {
  /** The office's own credentials for this gateway, decrypted. */
  credentials: Record<string, string>;
  /** Defaults to the global fetch; the tests pass their own. */
  fetch?: FetchLike;
}

export interface CheckoutCustomer {
  name: string;
  email?: string | null;
  phone?: string | null;
}

export interface CreateCheckoutInput {
  /** Our Payment id; every gateway carries it back (metadata, cart id, custom id). */
  paymentId: string;
  organizationId: string;
  /** Major units, in `currency`. */
  amount: number;
  currency: string;
  description: string;
  customer: CheckoutCustomer;
  /** Where the gateway sends the payer back after paying. */
  returnUrl: string;
  /** Where it sends the payer who gives up. */
  cancelUrl: string;
  /** This office's webhook address for the gateway, for the ones set per payment. */
  webhookUrl: string;
  /** The payer's language on the hosted page. */
  locale: "ar" | "en";
  /** Repeating the same key must not open a second charge. */
  idempotencyKey: string;
}

export interface CheckoutSession {
  /** The gateway's id for this checkout — stored on the Payment. */
  reference: string;
  /** The hosted payment page. */
  redirectUrl: string;
}

export type GatewayPaymentStatus = "paid" | "pending" | "failed" | "refunded";

/** A payment as the gateway reports it, in the same terms for every gateway. */
export interface GatewayPaymentState {
  /**
   * The gateway's id for the payment itself — what a refund names. Once
   * paid this can differ from the checkout's reference (a Stripe session
   * becomes a payment intent, a PayPal order a capture, a Moyasar invoice a
   * payment).
   */
  reference: string;
  /** The checkout this payment came from, when it differs from `reference`. */
  sessionReference?: string | null;
  /**
   * "refunded" only once the whole payment went back; a payment refunded in
   * part is still "paid", with `refundedAmount` saying how much went back.
   */
  status: GatewayPaymentStatus;
  /** Major units the gateway took (or would take), in `currency`. */
  amount: number;
  /**
   * Major units refunded so far, when the gateway says. Absent when it does
   * not report it (PayTabs, Tap): then "refunded" is all there is to go on.
   */
  refundedAmount?: number;
  currency: string;
  /** Our Payment id as the gateway recorded it, when it recorded one. */
  paymentId: string | null;
  method?: GatewayMethod | null;
  failureReason?: string | null;
}

export interface WebhookDelivery {
  headers: Headers;
  rawBody: string;
}

export interface VerifiedWebhook {
  /** Unique per gateway: the idempotency ledger's key. */
  eventId: string;
  type: string;
  /** What the event says about a payment; null for events that concern none. */
  payment: GatewayPaymentState | null;
  /**
   * Ask the gateway before acting on it: the delivery is authenticated by a
   * shared token rather than a signature over the body (Moyasar), or the
   * money still has to be captured (PayPal's approved order).
   */
  confirmWithApi?: boolean;
}

export interface RefundInput {
  /** The payment's reference (GatewayPaymentState.reference). */
  reference: string;
  /** Major units. */
  amount: number;
  currency: string;
  paymentId: string;
}

export interface RefundResult {
  refundId: string;
  /** "pending": accepted, the money is on its way back. */
  status: "succeeded" | "pending";
  amount: number;
}

export interface GatewayAdapter {
  id: GatewayId;
  createCheckout(ctx: AdapterContext, input: CreateCheckoutInput): Promise<CheckoutSession>;
  /**
   * Null when the signature does not hold. Throws GatewayConfigError when the
   * office has not stored what verification needs.
   */
  verifyWebhook(ctx: AdapterContext, delivery: WebhookDelivery): Promise<VerifiedWebhook | null>;
  /** Null when the gateway has no such payment. */
  fetchPayment(ctx: AdapterContext, reference: string): Promise<GatewayPaymentState | null>;
  confirmPayment(ctx: AdapterContext, reference: string): Promise<GatewayPaymentState | null>;
  refund(ctx: AdapterContext, input: RefundInput): Promise<RefundResult>;
  /** Throws when the credentials are refused. */
  testCredentials(ctx: AdapterContext): Promise<void>;
}

/** The fetch an adapter calls through. */
export function fetchOf(ctx: AdapterContext): FetchLike {
  return ctx.fetch ?? ((input, init) => fetch(input, init));
}

/** A required credential, or a GatewayConfigError naming it. */
export function credential(
  ctx: AdapterContext,
  key: string,
  gatewayName: string,
  fieldLabel: string,
): string {
  const value = ctx.credentials[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new GatewayConfigError(`${gatewayName}: ${fieldLabel} is not set.`);
}
