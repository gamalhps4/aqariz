/**
 * PropertyPro - Sending a payer to a gateway's hosted payment page
 *
 * Shared by the two ways a payment is started online:
 *   POST /api/payments/[id]/checkout   a tenant (or staff) paying a payment
 *   POST /api/invoices/[id]/checkout   staff collecting an invoice online
 *
 * Before a new page is opened the attempt already on the payment is asked
 * about: a payer who paid and closed the tab before coming back must not be
 * charged twice. Then the gateway's page is opened with our payment id on it,
 * its reference is stored on the payment, and the payer is sent there. They
 * come back through /api/payments/return/<gateway>/<office>/<payment>, which
 * asks the gateway and records the money; the webhook does the same if they
 * never come back.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import { PaymentStatus } from "@/types";
import { getGatewayDef, isGatewayId, type GatewayId } from "@/lib/payments/gateway-registry";
import { getGatewayAdapter } from "@/lib/payments/adapters";
import { chargeCurrency } from "@/lib/payments/gateway-currency";
import { gatewayReferenceOf } from "@/lib/payments/gateway-reference";
import { requireGatewayColumns } from "@/lib/payments/gateway-columns";
import { requireUsableGateway } from "@/lib/payments/gateway-availability";
import { applyGatewayState, findPaymentForState } from "@/lib/payments/gateway-settle";
import { getStoredGatewayCredentials } from "@/lib/services/payment-config.service";
import { resolveApplicationOrigin } from "@/lib/billing/origin";
import { describeCharge } from "@/lib/i18n/charge-description";
import { LOCALE_COOKIE } from "@/lib/i18n/locale-cookie";

/** A checkout that could not be started; carries the HTTP status to answer with. */
export class CheckoutRefusedError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "CheckoutRefusedError";
    this.statusCode = statusCode;
  }
}

export interface CheckoutPayment {
  id: string;
  organizationId: string;
  status: string;
  amount: number;
  currency: string | null;
  type: string;
  description: string | null;
  gatewayProvider?: string | null;
  gatewayPaymentId?: string | null;
  stripePaymentIntentId?: string | null;
  tenant: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  property: { name: string | null } | null;
}

export type CheckoutResult =
  | { url: string; gateway: GatewayId; reference: string }
  | { alreadyPaid: true };

/**
 * Where the payer lands afterwards: a dashboard path, nothing else. Whatever a
 * gateway appends to the return address cannot widen it.
 */
export function safeReturnPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const path = value.split(/[?#]/)[0];
  return /^\/dashboard(\/[A-Za-z0-9_-]+)*$/.test(path) ? path : fallback;
}

/** The payer's language on the hosted page: Arabic unless they read English. */
function payerLocale(request: Request): "ar" | "en" {
  const cookie = request.headers.get("cookie") ?? "";
  const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`).exec(cookie);
  return match?.[1] === "en" ? "en" : "ar";
}

/**
 * Ask the gateway about the attempt already on this payment. True when it
 * turns out paid (now recorded). Throws when the gateway cannot be asked —
 * it may hold the money, so no second page is opened.
 */
export async function settledByEarlierAttempt(payment: CheckoutPayment): Promise<boolean> {
  const earlier = gatewayReferenceOf(payment);
  if (!earlier || !isGatewayId(earlier.provider)) return false;
  const gateway = earlier.provider;
  const credentials = await getStoredGatewayCredentials(gateway);
  if (Object.keys(credentials).length === 0) return false;

  let state;
  try {
    state = await getGatewayAdapter(gateway).fetchPayment({ credentials }, earlier.id);
  } catch (error) {
    console.error(`Could not ask ${gateway} about the earlier attempt on payment ${payment.id}`, error);
    throw new CheckoutRefusedError(
      "The payment service could not be reached to check an earlier attempt on this payment. Try again in a moment.",
      502,
    );
  }
  if (!state || state.status !== "paid") return false;

  const row = await findPaymentForState(gateway, { ...state, paymentId: state.paymentId ?? payment.id });
  if (!row || row.id !== payment.id) return false;
  const applied = await applyGatewayState(gateway, row, state);
  if (applied.outcome.action === "review") {
    // Held as the tenant's credit, and the office told (./gateway-review.ts).
    throw new CheckoutRefusedError(
      "A payment already went through for this charge. It is held as your credit and the office has been told.",
      409,
    );
  }
  return true;
}

export async function startGatewayCheckout(params: {
  request: Request;
  payment: CheckoutPayment;
  gateway: GatewayId;
  /** The dashboard page to come back to. */
  returnPath: string;
}): Promise<CheckoutResult> {
  const { request, payment, gateway, returnPath } = params;
  const def = getGatewayDef(gateway)!;

  const config = await requireUsableGateway(payment.organizationId, gateway, payment.currency);
  await requireGatewayColumns();

  if (await settledByEarlierAttempt(payment)) return { alreadyPaid: true };

  const tenant = payment.tenant;
  // Tap opens a charge only for a customer it can reach.
  if (gateway === "tap" && !tenant?.email) {
    throw new CheckoutRefusedError(
      "This tenant has no email address. Add one before collecting through Tap.",
      400,
    );
  }

  const organization = await db.organization.findFirst({ select: { slug: true } });
  if (!organization?.slug) throw new CheckoutRefusedError("Office not found.", 404);

  const origin = resolveApplicationOrigin(request);
  const slug = encodeURIComponent(organization.slug);
  const back = `${origin}/api/payments/return/${gateway}/${slug}/${encodeURIComponent(payment.id)}?to=${encodeURIComponent(returnPath)}`;
  const locale = payerLocale(request);
  const currency = chargeCurrency(payment.currency);
  const name = [tenant?.firstName, tenant?.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
  const what = describeCharge({ description: payment.description, type: payment.type }, locale);
  const description = [what, payment.property?.name].filter(Boolean).join(" — ") || def.name;

  let session;
  try {
    session = await getGatewayAdapter(gateway).createCheckout(
      { credentials: config.credentials },
      {
        paymentId: payment.id,
        organizationId: payment.organizationId,
        amount: payment.amount,
        currency,
        description,
        customer: {
          name: name || tenant?.email || "Tenant",
          email: tenant?.email ?? null,
          phone: tenant?.phone ?? null,
        },
        returnUrl: back,
        cancelUrl: `${back}&outcome=cancel`,
        webhookUrl: `${origin}/api/payments/webhook/${gateway}/${slug}`,
        locale,
        // Repeated within the minute (a double click), the same page.
        idempotencyKey: `checkout-${payment.id}-${gateway}-${Math.floor(Date.now() / 60_000)}`,
      },
    );
  } catch (error) {
    console.error(`${def.name} checkout could not be opened for payment ${payment.id}`, error);
    const reason = error instanceof Error && error.message ? `: ${error.message.replace(/\.$/, "")}` : "";
    throw new CheckoutRefusedError(`${def.name} could not open its payment page${reason}.`, 502);
  }

  // The reference is how the payer's return, and a webhook that names no
  // payment, find this payment again. Only a payment still waiting for its
  // money takes it: one settled meanwhile keeps its own.
  await db.payment.updateMany({
    where: {
      id: payment.id,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE, PaymentStatus.FAILED] },
    },
    data: {
      gatewayProvider: gateway,
      gatewayPaymentId: session.reference,
      version: { increment: 1 },
    },
  });

  return { url: session.redirectUrl, gateway, reference: session.reference };
}
