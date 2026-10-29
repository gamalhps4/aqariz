/**
 * PropertyPro - Stripe (the office's own account; https://docs.stripe.com)
 *
 * Hosted page: a Checkout Session in payment mode. Amounts are integers in the
 * currency's minor unit. The session id (`cs_…`) is stored at checkout; once
 * paid, the payment intent's (`pi_…`), which is what a refund names. The
 * prefixes tell the two apart.
 *
 * Webhooks carry the `stripe-signature` header, checked against the office's
 * signing secret. Both the session events and the payment-intent events are
 * read, so a payment intent raised by the mobile app's in-app card flow
 * (POST /api/payments/create-intent) settles through the same path.
 *
 * The platform's own Stripe account (subscription billing) never reaches this
 * file: the client is always built from the office's secret key.
 */

import Stripe from "stripe";
import type {
  AdapterContext,
  GatewayAdapter,
  GatewayPaymentState,
  GatewayPaymentStatus,
} from "@/lib/payments/gateway-adapter";
import { credential } from "@/lib/payments/gateway-adapter";
import { GatewayHttpError } from "@/lib/payments/gateway-http";
import { fromMinor, toMinor } from "@/lib/payments/gateway-money";
import type { GatewayMethod } from "@/lib/payments/gateway-registry";

/** Single Stripe API version for every server-side Stripe client. */
export const STRIPE_GATEWAY_API_VERSION = "2026-06-24.dahlia";

const clients = new Map<string, Stripe>();

function client(ctx: AdapterContext): Stripe {
  const secretKey = credential(ctx, "secretKey", "Stripe", "Secret Key");
  const config: Stripe.StripeConfig = {
    apiVersion: STRIPE_GATEWAY_API_VERSION as Stripe.StripeConfig["apiVersion"],
    maxNetworkRetries: 1,
    timeout: 20_000,
  };
  // The tests answer for Stripe through their own fetch.
  if (ctx.fetch) {
    return new Stripe(secretKey, {
      ...config,
      maxNetworkRetries: 0,
      httpClient: Stripe.createFetchHttpClient(ctx.fetch as typeof fetch),
    });
  }
  const cached = clients.get(secretKey);
  if (cached) return cached;
  if (clients.size >= 100) clients.clear();
  const created = new Stripe(secretKey, config);
  clients.set(secretKey, created);
  return created;
}

/** Stripe's errors as the app's: a missing object is a 404. */
function asGatewayError(error: unknown): unknown {
  if (error instanceof Stripe.errors.StripeError) {
    const status = error.code === "resource_missing" ? 404 : (error.statusCode ?? 0);
    return new GatewayHttpError("Stripe", status, error.message, error.raw);
  }
  return error;
}

function isMissing(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeError && error.code === "resource_missing";
}

function methodOf(types: readonly string[] | null | undefined): GatewayMethod | null {
  if (!types?.length) return null;
  return types.includes("card") ? "card" : null;
}

function intentStatus(intent: Stripe.PaymentIntent): GatewayPaymentStatus {
  if (intent.status === "succeeded") {
    const charge = intent.latest_charge;
    if (charge && typeof charge === "object" && charge.refunded) return "refunded";
    return "paid";
  }
  if (intent.status === "canceled") return "failed";
  if (intent.status === "requires_payment_method" && intent.last_payment_error) return "failed";
  return "pending";
}

function intentState(intent: Stripe.PaymentIntent, sessionId?: string | null): GatewayPaymentState {
  const currency = String(intent.currency || "").toUpperCase();
  const received = intent.status === "succeeded" && intent.amount_received ? intent.amount_received : intent.amount;
  // The charge (expanded where it is read) says what went back: a charge
  // refunded in part is not `refunded`, only `amount_refunded`.
  const charge = intent.latest_charge;
  const refunded =
    charge && typeof charge === "object" && typeof charge.amount_refunded === "number"
      ? fromMinor(charge.amount_refunded, currency)
      : undefined;
  return {
    reference: intent.id,
    sessionReference: sessionId ?? null,
    status: intentStatus(intent),
    amount: fromMinor(received, currency),
    ...(refunded !== undefined ? { refundedAmount: refunded } : {}),
    currency,
    paymentId: intent.metadata?.paymentId || null,
    method: methodOf(intent.payment_method_types),
    failureReason: intent.last_payment_error?.message ?? null,
  };
}

function sessionState(session: Stripe.Checkout.Session): GatewayPaymentState {
  const currency = String(session.currency || "").toUpperCase();
  const intentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  let status: GatewayPaymentStatus = "pending";
  if (session.payment_status === "paid") status = "paid";
  else if (session.status === "expired") status = "failed";
  return {
    // Paid, the payment intent is the payment; before that, only the session exists.
    reference: status === "paid" && intentId ? intentId : session.id,
    sessionReference: session.id,
    status,
    amount: fromMinor(session.amount_total ?? 0, currency),
    currency,
    paymentId: session.client_reference_id || session.metadata?.paymentId || null,
    method: methodOf(session.payment_method_types),
  };
}

async function fetchPayment(ctx: AdapterContext, reference: string): Promise<GatewayPaymentState | null> {
  const stripe = client(ctx);
  try {
    if (reference.startsWith("cs_")) {
      return sessionState(await stripe.checkout.sessions.retrieve(reference));
    }
    return intentState(await stripe.paymentIntents.retrieve(reference, { expand: ["latest_charge"] }));
  } catch (error) {
    if (isMissing(error)) return null;
    throw asGatewayError(error);
  }
}

export const stripeAdapter: GatewayAdapter = {
  id: "stripe",

  async createCheckout(ctx, input) {
    const stripe = client(ctx);
    const currency = input.currency.toUpperCase();
    const metadata = {
      source: "PropertyPro",
      paymentId: input.paymentId,
      organizationId: input.organizationId,
    };
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: input.paymentId,
          ...(input.customer.email ? { customer_email: input.customer.email } : {}),
          success_url: input.returnUrl,
          cancel_url: input.cancelUrl,
          locale: "auto",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: currency.toLowerCase(),
                unit_amount: toMinor(input.amount, currency),
                product_data: { name: input.description.slice(0, 250) },
              },
            },
          ],
          metadata,
          payment_intent_data: { description: input.description.slice(0, 250), metadata },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (!session.url) throw new Error("Stripe did not return a checkout page.");
      return { reference: session.id, redirectUrl: session.url };
    } catch (error) {
      throw asGatewayError(error);
    }
  },

  async verifyWebhook(ctx, delivery) {
    const secret = credential(ctx, "webhookSecret", "Stripe", "Webhook Signing Secret");
    const signature = delivery.headers.get("stripe-signature");
    if (!signature) return null;
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(delivery.rawBody, signature, secret);
    } catch {
      return null;
    }

    let payment: GatewayPaymentState | null = null;
    switch (event.type) {
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
      case "payment_intent.canceled":
      case "payment_intent.processing":
      case "payment_intent.requires_action": {
        const intent = event.data.object as Stripe.PaymentIntent;
        payment = intentState(intent);
        if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
          payment = { ...payment, status: "failed" };
        }
        break;
      }
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        payment = sessionState(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        payment = { ...sessionState(event.data.object as Stripe.Checkout.Session), status: "failed" };
        break;
      default:
        payment = null;
    }
    return { eventId: event.id, type: event.type, payment };
  },

  fetchPayment,
  confirmPayment: fetchPayment,

  async refund(ctx, input) {
    const stripe = client(ctx);
    const currency = input.currency.toUpperCase();
    try {
      let intentId = input.reference;
      if (intentId.startsWith("cs_")) {
        const session = await stripe.checkout.sessions.retrieve(intentId);
        const fromSession =
          typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        if (!fromSession) throw new GatewayHttpError("Stripe", 409, "This checkout was never paid.");
        intentId = fromSession;
      }
      const refund = await stripe.refunds.create(
        {
          payment_intent: intentId,
          amount: toMinor(input.amount, currency),
          reason: "requested_by_customer",
          metadata: { source: "PropertyPro", paymentId: input.paymentId },
        },
        // Per amount: the rest of a payment refunded in part in Stripe's
        // dashboard is a refund of its own, not a replay of an earlier one.
        { idempotencyKey: `refund-${input.paymentId}-${toMinor(input.amount, currency)}` },
      );
      if (refund.status === "failed" || refund.status === "canceled") {
        throw new GatewayHttpError("Stripe", 402, refund.failure_reason || "Stripe declined the refund.");
      }
      return {
        refundId: refund.id,
        status: refund.status === "succeeded" ? "succeeded" : "pending",
        amount: fromMinor(refund.amount, currency),
      };
    } catch (error) {
      throw asGatewayError(error);
    }
  },

  async testCredentials(ctx) {
    try {
      await client(ctx).balance.retrieve();
    } catch (error) {
      throw asGatewayError(error);
    }
  },
};
