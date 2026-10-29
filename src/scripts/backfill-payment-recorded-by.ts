/**
 * PropertyPro - Backfill who recorded each payment
 *
 * Dry run (reads only):
 *   NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
 *     --env-file=.env.local --tsconfig tsconfig.json \
 *     src/scripts/backfill-payment-recorded-by.ts
 * Write: the same command with `--apply`.
 *
 * `payments.recordedById` (migration 20260929130000_payment_recorded_by)
 * starts empty on every existing row. This recovers the recorder where the
 * database already knows it, in this order:
 *
 *   1. `by` on the payment's last "recorded" history entry — written by
 *      recordInstallmentPayment (the record dialog, "mark as paid", bulk);
 *   2. the user on the payment's latest "create" audit entry. The record
 *      dialog writes one, but so does "create payment" for a row with no
 *      money yet, which is why the history is asked first.
 *
 * A candidate is accepted only if that user exists, belongs to the payment's
 * organization, and is staff — not a tenant or an owner. Online payments are
 * skipped (the gateway recorded them; they read "Online"), as are payments
 * with no money on them. A payment with no evidence stays empty and shows
 * "—": guessing would put a name against money that person never handled.
 *
 * Only `recordedById` is written, only where it is still empty, and only if
 * the row has not changed since it was read. `updatedAt` keeps its value, so
 * the payment's "last updated" still means a change someone made.
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { recordPlatformAudit, SYSTEM_ACTOR } from "@/lib/platform/audit";
import { isOnlinePayment } from "@/lib/payments/recorder";
import { PaymentStatus, UserRole } from "@/types";
import { businessDay } from "@/lib/dates/business-day";

const APPLY = process.argv.includes("--apply");

/** Statuses that mean money was recorded on the row at some point. */
const RECORDED_STATUSES: readonly string[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIAL,
  PaymentStatus.REFUNDED,
];

/** The office's clients: never the person who recorded its money. */
const NOT_STAFF: readonly string[] = [UserRole.TENANT, UserRole.OWNER];

type Source = "history" | "audit";

/** The user id on the last "recorded" entry of a payment's history. */
function lastRecordedBy(history: unknown): string | undefined {
  if (!Array.isArray(history)) return undefined;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] as { event?: unknown; by?: unknown } | null;
    if (entry?.event === "recorded" && typeof entry.by === "string" && entry.by) {
      return entry.by;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  await bypassOrgScope(async () => {
    const payments = await db.payment.findMany({
      where: {
        recordedById: null,
        // Named so the soft-delete filter lets archived payments through: one
        // restored later should still say who recorded it.
        deletedAt: undefined,
      },
      select: {
        id: true,
        organizationId: true,
        status: true,
        amount: true,
        amountPaid: true,
        paidDate: true,
        paymentHistory: true,
        updatedAt: true,
        deletedAt: true,
        stripePaymentIntentId: true,
        stripeCheckoutSessionId: true,
        paypalCaptureId: true,
        razorpayPaymentId: true,
        paystackReference: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const hasMoney = (payment: (typeof payments)[number]) =>
      RECORDED_STATUSES.includes(payment.status) ||
      Number(payment.amountPaid ?? 0) > 0;
    const manual = payments.filter(
      (payment) => hasMoney(payment) && !isOnlinePayment(payment),
    );

    // Oldest first, so the map ends up holding each payment's latest entry.
    const audits = manual.length
      ? await db.auditLog.findMany({
          where: {
            resourceType: "payment",
            resourceId: { in: manual.map((payment) => payment.id) },
            action: "create",
            userId: { not: null },
          },
          select: { resourceId: true, userId: true },
          orderBy: { timestamp: "asc" },
        })
      : [];
    const auditUser = new Map<string, string>();
    for (const entry of audits) {
      if (entry.resourceId && entry.userId) {
        auditUser.set(entry.resourceId, entry.userId);
      }
    }

    const found = manual.map((payment) => {
      const fromHistory = lastRecordedBy(payment.paymentHistory);
      if (fromHistory) {
        return { payment, userId: fromHistory, source: "history" as Source };
      }
      const fromAudit = auditUser.get(payment.id);
      if (fromAudit) {
        return { payment, userId: fromAudit, source: "audit" as Source };
      }
      return { payment, userId: undefined, source: undefined };
    });

    const userIds = [
      ...new Set(found.flatMap((item) => (item.userId ? [item.userId] : []))),
    ];
    const users = userIds.length
      ? await db.user.findMany({
          // Deactivated staff still recorded what they recorded.
          where: { id: { in: userIds }, deletedAt: undefined },
          select: {
            id: true,
            organizationId: true,
            role: true,
            firstName: true,
            lastName: true,
          },
        })
      : [];
    const userById = new Map(users.map((user) => [user.id, user]));

    const orgIds = [...new Set(payments.map((payment) => payment.organizationId))];
    const organizations = orgIds.length
      ? await db.organization.findMany({
          where: { id: { in: orgIds }, deletedAt: undefined },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const orgName = new Map(
      organizations.map((org) => [org.id, `${org.name} (${org.slug})`]),
    );

    interface Tally {
      organization: string;
      empty: number;
      online: number;
      noMoney: number;
      fromHistory: number;
      fromAudit: number;
      rejected: number;
      noEvidence: number;
    }
    const tallies = new Map<string, Tally>();
    const tally = (orgId: string): Tally => {
      let entry = tallies.get(orgId);
      if (!entry) {
        entry = {
          organization: orgName.get(orgId) ?? orgId,
          empty: 0,
          online: 0,
          noMoney: 0,
          fromHistory: 0,
          fromAudit: 0,
          rejected: 0,
          noEvidence: 0,
        };
        tallies.set(orgId, entry);
      }
      return entry;
    };

    for (const payment of payments) {
      const counts = tally(payment.organizationId);
      counts.empty += 1;
      if (!hasMoney(payment)) counts.noMoney += 1;
      else if (isOnlinePayment(payment)) counts.online += 1;
    }

    const accepted: Array<{
      payment: (typeof manual)[number];
      userId: string;
      source: Source;
      name: string;
    }> = [];
    const rejected: string[] = [];

    for (const item of found) {
      const counts = tally(item.payment.organizationId);
      if (!item.userId || !item.source) {
        counts.noEvidence += 1;
        continue;
      }
      const user = userById.get(item.userId);
      const reason = !user
        ? "that user no longer exists"
        : user.organizationId !== item.payment.organizationId
          ? "that user is in another organization"
          : NOT_STAFF.includes(user.role)
            ? `that user is a ${user.role}, not staff`
            : null;
      if (reason || !user) {
        counts.rejected += 1;
        rejected.push(`${item.payment.id}: ${item.source} names ${item.userId} — ${reason}`);
        continue;
      }
      if (item.source === "history") counts.fromHistory += 1;
      else counts.fromAudit += 1;
      accepted.push({
        payment: item.payment,
        userId: user.id,
        source: item.source,
        name: `${user.firstName} ${user.lastName}`.trim(),
      });
    }

    console.log(`Payments with no recorder: ${payments.length}`);
    console.table([...tallies.values()]);
    if (accepted.length > 0) {
      console.log("Recoverable:");
      console.table(
        accepted.map(({ payment, source, name }) => ({
          payment: payment.id,
          paid: businessDay(payment.paidDate),
          amount: Number(payment.amountPaid ?? 0) || Number(payment.amount),
          archived: payment.deletedAt ? "yes" : "",
          source,
          recordedBy: name,
        })),
      );
    }
    for (const line of rejected) console.log(`Not used: ${line}`);

    if (!APPLY) {
      console.log(
        `Dry run — nothing written. ${accepted.length} payment(s) would be filled; re-run with --apply to write.`,
      );
      return;
    }

    const writtenByOrg = new Map<string, { history: string[]; audit: string[] }>();
    let changedSinceRead = 0;
    for (const { payment, userId, source } of accepted) {
      const result = await db.payment.updateMany({
        where: {
          id: payment.id,
          recordedById: null,
          // Untouched since it was read — and naming deletedAt also lets an
          // archived row through the soft-delete filter.
          updatedAt: payment.updatedAt,
          deletedAt: payment.deletedAt,
        },
        data: { recordedById: userId, updatedAt: payment.updatedAt },
      });
      if (result.count !== 1) {
        changedSinceRead += 1;
        continue;
      }
      const written = writtenByOrg.get(payment.organizationId) ?? {
        history: [],
        audit: [],
      };
      written[source].push(payment.id);
      writtenByOrg.set(payment.organizationId, written);
    }

    let total = 0;
    for (const [orgId, written] of writtenByOrg) {
      const count = written.history.length + written.audit.length;
      total += count;
      await recordPlatformAudit({
        actor: SYSTEM_ACTOR,
        action: "payment.recorders_backfilled",
        targetType: "organization",
        targetId: orgId,
        targetName: orgName.get(orgId) ?? orgId,
        organizationId: orgId,
        summary: `Filled "recorded by" on ${count} payment(s) from their history and audit trail`,
        metadata: {
          script: "src/scripts/backfill-payment-recorded-by.ts",
          fromHistory: written.history,
          fromAudit: written.audit,
        },
      });
    }

    console.log(
      `Wrote ${total} payment(s).` +
        (changedSinceRead
          ? ` ${changedSinceRead} changed since they were read and were left alone — run again to pick them up.`
          : ""),
    );
  });
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
