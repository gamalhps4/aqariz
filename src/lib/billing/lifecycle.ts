/**
 * PropertyPro SaaS - Subscription lifecycle (trials + dunning)
 *
 * Stripe reports *what* happened; this module decides what the platform does
 * about it. Two state machines live here:
 *
 *   Trial:   trial → (T-3 warning email) → expired → status "active" on the
 *            free plan. An expired trial used to just silently collapse to
 *            free entitlements mid-session with no warning.
 *
 *   Dunning: a failed payment stamps `pastDueSince` and mails the customer.
 *            Access continues through a grace window (default 7 days) and is
 *            then withdrawn: `entitlements.getEffectivePlan` stops honouring
 *            past_due once the window has elapsed, and the organization is
 *            suspended after a longer cutoff. Recovery clears both stamps.
 *
 * Every write here targets `organizations`, which is member-readable but
 * platform-writable under RLS, so callers run inside `bypassOrgScope`.
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { emailService } from "@/lib/email-service";
import { recordPlatformAudit, SYSTEM_ACTOR } from "@/lib/platform/audit";

/** Days of continued access after the first failed payment. */
export const DUNNING_GRACE_DAYS = Number(
  process.env.BILLING_DUNNING_GRACE_DAYS ?? 7,
);

/** Days after which an unrecovered past-due organization is suspended. */
export const DUNNING_SUSPEND_DAYS = Number(
  process.env.BILLING_DUNNING_SUSPEND_DAYS ?? 21,
);

/** How many days before trial end the warning email goes out. */
export const TRIAL_WARNING_DAYS = Number(
  process.env.BILLING_TRIAL_WARNING_DAYS ?? 3,
);

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * True while a past-due organization is still inside its grace window.
 * `pastDueSince` being null means the failure was never recorded (e.g. the
 * status arrived through a subscription sync rather than an invoice event),
 * in which case the organization is given the benefit of the grace window.
 */
export function isWithinDunningGrace(
  pastDueSince: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!pastDueSince) return true;
  return daysBetween(pastDueSince, now) < DUNNING_GRACE_DAYS;
}

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.BETTER_AUTH_URL ||
  "http://localhost:3000";

const BILLING_URL = `${APP_URL}/dashboard/settings/billing`;

async function organizationOwnerContact(
  organizationId: string,
): Promise<{ email: string; name: string } | null> {
  const organization = await bypassOrgScope(() =>
    db.organization.findFirst({
      where: { id: organizationId },
      select: { ownerId: true },
    }),
  );
  if (!organization) return null;

  const owner = await bypassOrgScope(() =>
    db.user.findFirst({
      where: { id: organization.ownerId },
      select: { email: true, firstName: true, lastName: true },
    }),
  );
  if (!owner?.email) return null;

  return {
    email: owner.email,
    name:
      [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim() ||
      "there",
  };
}

/** Record the first failed payment for an organization (idempotent). */
export async function markPastDue(
  organizationId: string,
  occurredAt: Date = new Date(),
): Promise<void> {
  await bypassOrgScope(() =>
    db.organization.updateMany({
      // updateMany + a null guard keeps the *first* failure timestamp: a
      // retried invoice must not slide the grace window forward.
      where: { id: organizationId, pastDueSince: null },
      data: { pastDueSince: occurredAt },
    }),
  );
}

/** Clear dunning state after a successful payment. */
export async function clearPastDue(organizationId: string): Promise<void> {
  await bypassOrgScope(() =>
    db.organization.updateMany({
      where: { id: organizationId },
      data: { pastDueSince: null, dunningNotifiedAt: null },
    }),
  );
}

export async function sendPaymentFailedEmail(
  organizationId: string,
  attemptLabel: string,
): Promise<boolean> {
  const contact = await organizationOwnerContact(organizationId);
  if (!contact) return false;

  const sent = await emailService.sendNotification(
    contact.email,
    contact.name,
    "Payment failed — action required",
    `We could not process the payment for your subscription (${attemptLabel}). ` +
      `Your account stays fully available for ${DUNNING_GRACE_DAYS} days while you update your payment details. ` +
      `After that, paid features are paused until the balance is settled.`,
    { text: "Update payment method", url: BILLING_URL },
  );

  if (sent) {
    await bypassOrgScope(() =>
      db.organization.updateMany({
        where: { id: organizationId },
        data: { dunningNotifiedAt: new Date() },
      }),
    );
  }
  return sent;
}

export async function sendTrialEndingEmail(
  organizationId: string,
  trialEndsAt: Date,
): Promise<boolean> {
  const contact = await organizationOwnerContact(organizationId);
  if (!contact) return false;

  const days = Math.max(0, daysBetween(new Date(), trialEndsAt) + 1);
  const sent = await emailService.sendNotification(
    contact.email,
    contact.name,
    days <= 1 ? "Your trial ends tomorrow" : `Your trial ends in ${days} days`,
    `Your PropertyPro trial ends on ${trialEndsAt.toDateString()}. ` +
      `Choose a plan to keep your properties, tenants and reporting features available — ` +
      `nothing is deleted, but the account drops to the Free plan limits when the trial ends.`,
    { text: "Choose a plan", url: BILLING_URL },
  );

  if (sent) {
    await bypassOrgScope(() =>
      db.organization.updateMany({
        where: { id: organizationId },
        data: { trialEndingNotifiedAt: new Date() },
      }),
    );
  }
  return sent;
}

export async function sendTrialExpiredEmail(
  organizationId: string,
): Promise<boolean> {
  const contact = await organizationOwnerContact(organizationId);
  if (!contact) return false;

  return emailService.sendNotification(
    contact.email,
    contact.name,
    "Your trial has ended",
    "Your PropertyPro trial has ended and the account is now on the Free plan. " +
      "Your data is intact — upgrade any time to restore your previous limits and features.",
    { text: "View plans", url: BILLING_URL },
  );
}

export interface BillingSweepResult {
  trialsWarned: number;
  trialsExpired: number;
  dunningEmailsSent: number;
  suspended: number;
  errors: string[];
}

/**
 * One pass of the trial + dunning state machines across every organization.
 * Safe to run repeatedly: each transition is guarded by its own stamp column.
 */
export async function runBillingLifecycleSweep(
  now: Date = new Date(),
): Promise<BillingSweepResult> {
  const result: BillingSweepResult = {
    trialsWarned: 0,
    trialsExpired: 0,
    dunningEmailsSent: 0,
    suspended: 0,
    errors: [],
  };

  // ---- Trials -------------------------------------------------------------
  const warningCutoff = new Date(now.getTime() + TRIAL_WARNING_DAYS * DAY_MS);

  const endingTrials = await bypassOrgScope(() =>
    db.organization.findMany({
      where: {
        deletedAt: null,
        status: "trial",
        trialEndingNotifiedAt: null,
        trialEndsAt: { gt: now, lte: warningCutoff },
      },
      select: { id: true, trialEndsAt: true },
    }),
  );

  for (const organization of endingTrials) {
    try {
      if (
        organization.trialEndsAt &&
        (await sendTrialEndingEmail(organization.id, organization.trialEndsAt))
      ) {
        result.trialsWarned += 1;
      }
    } catch (error) {
      result.errors.push(
        `trial warning ${organization.id}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  const expiredTrials = await bypassOrgScope(() =>
    db.organization.findMany({
      where: {
        deletedAt: null,
        status: "trial",
        trialEndsAt: { lte: now },
        // A trial that converted to a real Stripe subscription is handled by
        // the webhook, not here.
        stripeSubscriptionId: null,
      },
      select: { id: true },
    }),
  );

  for (const organization of expiredTrials) {
    try {
      await bypassOrgScope(() =>
        db.organization.update({
          where: { id: organization.id },
          // The trial is over, but the account stays usable on the Free plan —
          // suspension is reserved for non-payment and manual action.
          data: {
            status: "active",
            plan: "free",
            trialExpiredAt: now,
          },
        }),
      );
      await sendTrialExpiredEmail(organization.id);
      await recordPlatformAudit({
        actor: SYSTEM_ACTOR,
        action: "organization.trial_expired",
        targetType: "organization",
        targetId: organization.id,
        targetName: organization.id,
        organizationId: organization.id,
        summary: "Trial ended — organization moved to the Free plan",
      });
      result.trialsExpired += 1;
    } catch (error) {
      result.errors.push(
        `trial expiry ${organization.id}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  // ---- Dunning ------------------------------------------------------------
  const pastDue = await bypassOrgScope(() =>
    db.organization.findMany({
      where: {
        deletedAt: null,
        status: { not: "suspended" },
        subscriptionStatus: { in: ["past_due", "unpaid"] },
      },
      select: {
        id: true,
        pastDueSince: true,
        dunningNotifiedAt: true,
      },
    }),
  );

  for (const organization of pastDue) {
    try {
      // A status that arrived via subscription sync rather than an invoice
      // event has no stamp yet — start the clock now.
      if (!organization.pastDueSince) {
        await markPastDue(organization.id, now);
      }
      const since = organization.pastDueSince ?? now;

      // Re-mail every 3 days while the balance is outstanding.
      const lastNotified = organization.dunningNotifiedAt;
      if (!lastNotified || daysBetween(lastNotified, now) >= 3) {
        if (
          await sendPaymentFailedEmail(
            organization.id,
            `${daysBetween(since, now)} days overdue`,
          )
        ) {
          result.dunningEmailsSent += 1;
        }
      }

      if (daysBetween(since, now) >= DUNNING_SUSPEND_DAYS) {
        await bypassOrgScope(() =>
          db.organization.update({
            where: { id: organization.id },
            data: { status: "suspended" },
          }),
        );
        await recordPlatformAudit({
          actor: SYSTEM_ACTOR,
          action: "organization.suspended_for_nonpayment",
          targetType: "organization",
          targetId: organization.id,
          targetName: organization.id,
          organizationId: organization.id,
          summary: `Suspended automatically after ${DUNNING_SUSPEND_DAYS} days past due`,
        });
        result.suspended += 1;
      }
    } catch (error) {
      result.errors.push(
        `dunning ${organization.id}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  return result;
}
