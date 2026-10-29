/**
 * PropertyPro - Per-organization gateway webhooks
 *
 *   POST /api/payments/webhook/<gateway>/<org-slug>
 *   (stripe, paypal, moyasar, paytabs, tap)
 *
 * Each organization collects with its OWN merchant account at each gateway,
 * so each has its own signing secret. A single shared webhook URL could never
 * work: the handler cannot know which organization an event belongs to until
 * it has verified the signature, and it cannot pick a secret to verify with
 * until it knows the organization. The old shared routes resolved credentials
 * with no organization bound at all, silently fell back to the platform's env
 * secret, and so rejected every event from an organization using its own keys.
 *
 * Putting the organization in the path breaks that circle. The slug is not a
 * secret and is not trusted for anything: it only selects which stored secret
 * to verify against. An event whose signature does not match that
 * organization's secret is rejected exactly as it should be. How each gateway
 * signs is its adapter's business (lib/payments/adapters/); what the event
 * then does to a payment is the same for all of them
 * (lib/payments/gateway-settle.ts).
 *
 * Everything after resolution runs inside `runWithOrgContext`, so row-level
 * security still applies. A webhook for organization A that names a payment
 * belonging to organization B finds nothing — the previous handlers ran under
 * a full RLS bypass and would have settled it.
 *
 * Verified with the credentials the office STORED, switched on or not: money
 * taken before an office (or its package) switched a gateway off still has to
 * be recorded.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import { isGatewayId, type GatewayId } from "@/lib/payments/gateway-registry";
import { getGatewayAdapter } from "@/lib/payments/adapters";
import type { AdapterContext, VerifiedWebhook } from "@/lib/payments/gateway-adapter";
import { applyGatewayState, findPaymentForState } from "@/lib/payments/gateway-settle";
import { isGatewayFinal } from "@/lib/payments/settlement-plan";
import { getStoredGatewayCredentials } from "@/lib/services/payment-config.service";
import { claimWebhookEvent, releaseWebhookEvent } from "@/lib/payments/webhook-claims";

/** What a verified event does to the payment it concerns. */
async function dispatch(
  gateway: GatewayId,
  ctx: AdapterContext,
  event: VerifiedWebhook,
): Promise<void> {
  let state = event.payment;
  if (!state) return;
  if (event.confirmWithApi) {
    // Ask the gateway rather than trust the body (or capture the approved
    // order). A payment already settled — paid at the desk meanwhile — is
    // only asked about: an approved PayPal order on it is left uncaptured, so
    // the tenant is not charged a second time.
    const known = await findPaymentForState(gateway, state);
    const adapter = getGatewayAdapter(gateway);
    state =
      known && isGatewayFinal(known.status)
        ? await adapter.fetchPayment(ctx, state.reference)
        : await adapter.confirmPayment(ctx, state.reference);
    if (!state) {
      console.warn(`${gateway} knows no payment ${event.payment?.reference} (event ${event.eventId})`);
      return;
    }
  }
  const payment = await findPaymentForState(gateway, state);
  if (!payment) {
    console.warn(`${gateway} event ${event.eventId}: no payment for ${state.reference}`);
    return;
  }
  await applyGatewayState(gateway, payment, state);
}

/**
 * Verify, claim, dispatch. Runs with this organization's context already bound.
 */
async function processDelivery(
  gateway: GatewayId,
  organizationId: string,
  orgSlug: string,
  request: NextRequest,
  rawBody: string,
): Promise<NextResponse> {
  const ctx: AdapterContext = { credentials: {} };
  let event: VerifiedWebhook | null;
  try {
    ctx.credentials = await getStoredGatewayCredentials(gateway);
    event = await getGatewayAdapter(gateway).verifyWebhook(ctx, {
      headers: request.headers,
      rawBody,
    });
  } catch (error) {
    // Misconfiguration, not a bad delivery. 400 keeps the gateway retrying
    // without a redelivery storm; the log names the organization.
    console.error(
      `${gateway} webhook could not be verified for ${orgSlug}:`,
      error,
    );
    return NextResponse.json(
      { error: "Webhook verification unavailable" },
      { status: 400 },
    );
  }

  if (!event) {
    console.error(`Invalid ${gateway} webhook signature for ${orgSlug}`);
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 },
    );
  }

  // This office's claim on the event: another office cannot take it first
  // (lib/payments/webhook-claim-key.ts).
  const claim = { gateway, organizationId, eventId: event.eventId };
  if (!(await claimWebhookEvent(claim, event.type))) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await dispatch(gateway, ctx, event);
    return NextResponse.json({ received: true });
  } catch (error) {
    // Give the claim back so the gateway's retry runs: without it a handler
    // that threw once left the money captured and never recorded here.
    await releaseWebhookEvent(claim).catch((releaseError) => {
      console.error(
        `Failed to release ${gateway} webhook claim ${event!.eventId}:`,
        releaseError,
      );
    });
    console.error(`${gateway} webhook failed for ${orgSlug}:`, error);
    // 500 so the gateway retries; the claim is back, so the retry runs.
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ gateway: string; orgSlug: string }> },
) {
  const { gateway, orgSlug } = await context.params;

  if (!isGatewayId(gateway)) {
    return NextResponse.json({ error: "Unknown gateway" }, { status: 404 });
  }

  // Resolving the organization needs a bypass: no context is bound yet, and
  // the slug is what establishes one.
  const organization = await bypassOrgScope(() =>
    db.organization.findFirst({
      where: { slug: orgSlug, deletedAt: null },
      select: { id: true },
    }),
  );
  if (!organization) {
    return NextResponse.json({ error: "Unknown organization" }, { status: 404 });
  }

  const rawBody = await request.text();

  // Explicitly NOT a platform admin: the handler stays inside this
  // organization's rows, so a webhook naming another tenant's payment finds
  // nothing instead of settling it.
  return runWithOrgContext(
    { organizationId: organization.id, isPlatformAdmin: false },
    () => processDelivery(gateway, organization.id, orgSlug, request, rawBody),
  );
}
