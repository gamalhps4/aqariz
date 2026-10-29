import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { getBillingStripe } from "@/lib/billing/stripe";
import {
  clearCanceledSubscription,
  findOrganizationForSubscription,
  syncOrganizationSubscription,
} from "@/lib/billing/service";
import {
  clearPastDue,
  markPastDue,
  sendPaymentFailedEmail,
  sendTrialEndingEmail,
} from "@/lib/billing/lifecycle";

const GATEWAY = "stripe_billing";

/** Claim the event in the shared webhook-idempotency ledger.
 * Returns false when another delivery already processed it. */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  try {
    await db.webhookEvent.create({
      data: { gateway: GATEWAY, eventId: event.id, eventType: event.type },
    });
    return true;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false;
    }
    throw error;
  }
}

async function releaseEvent(eventId: string): Promise<void> {
  await db.webhookEvent.deleteMany({
    where: { gateway: GATEWAY, eventId },
  });
}

/** Resolve the organization behind a billing invoice event. Subscription
 * invoices carry the subscription id; falling back to the customer covers
 * one-off charges raised against the same customer record. */
async function organizationForInvoice(
  invoice: Stripe.Invoice,
): Promise<{ id: string } | null> {
  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  if (!customerId) return null;
  return db.organization.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
}

async function processBillingEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (
        session.metadata?.purpose !== "saas_subscription" ||
        typeof session.subscription !== "string"
      ) {
        return;
      }
      const subscription = await getBillingStripe().subscriptions.retrieve(
        session.subscription,
      );
      await syncOrganizationSubscription(subscription);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await syncOrganizationSubscription(
        event.data.object as Stripe.Subscription,
      );
      return;
    case "customer.subscription.deleted":
      await clearCanceledSubscription(
        event.data.object as Stripe.Subscription,
      );
      return;
    case "customer.subscription.trial_will_end": {
      // Stripe fires this 3 days out for trials it manages. Trials started at
      // signup (no Stripe subscription yet) are warned by the billing cron.
      const subscription = event.data.object as Stripe.Subscription;
      const organization = await findOrganizationForSubscription(subscription);
      if (organization && subscription.trial_end) {
        await sendTrialEndingEmail(
          organization.id,
          new Date(subscription.trial_end * 1000),
        );
      }
      return;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const organization = await organizationForInvoice(invoice);
      if (!organization) return;
      // Stamp the grace-window start, then tell the customer. Entitlements
      // keep working until the window elapses (billing/lifecycle).
      await markPastDue(organization.id, new Date(event.created * 1000));
      await sendPaymentFailedEmail(
        organization.id,
        invoice.number ?? invoice.id ?? "latest invoice",
      );
      return;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const organization = await organizationForInvoice(invoice);
      if (!organization) return;
      // Recovery: drop the dunning stamps so the next sweep leaves them alone
      // and a future failure starts a fresh grace window.
      await clearPastDue(organization.id);
      return;
    }
    default:
      return;
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Billing webhook secret is not configured" },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const payload = await request.text();
    event = getBillingStripe().webhooks.constructEvent(
      payload,
      signature,
      secret,
    );
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  // Webhooks arrive with no request/org context; the idempotency ledger and
  // the organization billing columns are only writable with RLS bypassed.
  return bypassOrgScope(async () => {
    if (!(await claimEvent(event))) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    try {
      await processBillingEvent(event);
      return NextResponse.json({ received: true });
    } catch (error) {
      await releaseEvent(event.id);
      console.error("Billing webhook failed:", error);
      return NextResponse.json({ error: "Billing webhook failed" }, { status: 500 });
    }
  });
}
