/**
 * PropertyPro - Backfill the date on contracts cancelled without one
 *
 * Dry run (reads only):
 *   NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
 *     --env-file=.env.local --tsconfig tsconfig.json \
 *     src/scripts/backfill-lease-cancellation-dates.ts
 * Write: the same command with `--apply`.
 *
 * Only the terminate form used to record when a contract was cancelled. The
 * contracts list, the contract card and the status changer set the status
 * alone, so those contracts sit in the Cancelled register with no date — and
 * drop out of it as soon as a date range is chosen, because the register
 * filters on `terminatedDate`. Every cancel path records the date now; this
 * gives the rows cancelled before that a date to be found by:
 *
 *   1. the moment the audit trail recorded the contract becoming cancelled,
 *      when it did — and the person, if the contract names nobody and that
 *      user still belongs to the same organization;
 *   2. otherwise the row's `updatedAt`. Cancelling was a write to the row, so
 *      this is the latest the cancellation can have happened; a contract
 *      touched again afterwards (archived, say) gets that later moment.
 *
 * The reason is left empty. Nobody recorded one, and a blank says so; an
 * invented reason would read as something a person once wrote.
 *
 * Only `terminatedDate` (and, from the audit trail, `terminatedById`) is
 * written, only where the date is still empty, and only if the row has not
 * changed since it was read. `updatedAt` keeps its value, so the contract's
 * "last updated" still means a change someone made.
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { recordPlatformAudit, SYSTEM_ACTOR } from "@/lib/platform/audit";
import { backfilledCancellationDate } from "@/lib/lease-lifecycle";
import { LeaseStatus } from "@/types";
import { businessDay } from "@/lib/dates/business-day";

const APPLY = process.argv.includes("--apply");

interface AuditEvidence {
  at: Date;
  organizationId: string;
  userId: string | null;
}

async function main(): Promise<void> {
  await bypassOrgScope(async () => {
    const leases = await db.lease.findMany({
      where: {
        status: LeaseStatus.TERMINATED,
        terminatedDate: null,
        // Named so the soft-delete filter lets archived contracts through:
        // one restored later should still say when it was cancelled.
        deletedAt: undefined,
      },
      select: {
        id: true,
        organizationId: true,
        contractNumber: true,
        terminatedById: true,
        updatedAt: true,
        archivedAt: true,
        deletedAt: true,
      },
      orderBy: { updatedAt: "asc" },
    });

    // Every lease audit entry whose change set the status to cancelled.
    // Oldest first, and the first entry for a contract wins: that is when it
    // became cancelled. A bulk update is audited once for all its contracts,
    // their ids comma-joined in `resourceId`.
    const audits = leases.length
      ? await db.auditLog.findMany({
          where: {
            resourceType: "lease",
            newValues: { path: ["status"], equals: LeaseStatus.TERMINATED },
          },
          select: {
            organizationId: true,
            resourceId: true,
            userId: true,
            timestamp: true,
          },
          orderBy: { timestamp: "asc" },
        })
      : [];
    const evidence = new Map<string, AuditEvidence>();
    for (const entry of audits) {
      for (const leaseId of (entry.resourceId ?? "").split(",")) {
        const id = leaseId.trim();
        if (id && !evidence.has(id)) {
          evidence.set(id, {
            at: entry.timestamp,
            organizationId: entry.organizationId,
            userId: entry.userId,
          });
        }
      }
    }

    const userIds = [
      ...new Set(
        [...evidence.values()].flatMap((entry) =>
          entry.userId ? [entry.userId] : [],
        ),
      ),
    ];
    const users = userIds.length
      ? await db.user.findMany({
          // Staff who have since left still cancelled what they cancelled.
          where: { id: { in: userIds }, deletedAt: undefined },
          select: { id: true, organizationId: true },
        })
      : [];
    const userOrg = new Map(users.map((user) => [user.id, user.organizationId]));

    const orgIds = [...new Set(leases.map((lease) => lease.organizationId))];
    const organizations = orgIds.length
      ? await db.organization.findMany({
          where: { id: { in: orgIds }, deletedAt: undefined },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const orgName = new Map(
      organizations.map((org) => [org.id, `${org.name} (${org.slug})`]),
    );

    const planned = leases.map((lease) => {
      // An audit entry filed under another organization is not evidence about
      // this contract, whatever id it carries.
      const found = evidence.get(lease.id);
      const audit =
        found && found.organizationId === lease.organizationId ? found : null;
      const { date, source } = backfilledCancellationDate({
        auditedAt: audit?.at,
        updatedAt: lease.updatedAt,
      });
      // The person is filled only where the contract names nobody and the
      // audit trail's user is one of this organization's own.
      const terminatedById =
        !lease.terminatedById &&
        audit?.userId &&
        userOrg.get(audit.userId) === lease.organizationId
          ? audit.userId
          : null;
      return { lease, date, source, terminatedById };
    });

    interface Tally {
      organization: string;
      withoutDate: number;
      fromAudit: number;
      fromUpdatedAt: number;
    }
    const tallies = new Map<string, Tally>();
    for (const { lease, source } of planned) {
      const entry = tallies.get(lease.organizationId) ?? {
        organization: orgName.get(lease.organizationId) ?? lease.organizationId,
        withoutDate: 0,
        fromAudit: 0,
        fromUpdatedAt: 0,
      };
      entry.withoutDate += 1;
      if (source === "audit") entry.fromAudit += 1;
      else entry.fromUpdatedAt += 1;
      tallies.set(lease.organizationId, entry);
    }

    console.log(`Cancelled contracts with no date: ${leases.length}`);
    if (planned.length > 0) {
      console.table([...tallies.values()]);
      console.table(
        planned.map(({ lease, date, source, terminatedById }) => ({
          contract: lease.contractNumber ?? lease.id,
          cancelledOn: businessDay(date),
          source,
          cancelledBy: terminatedById ?? "",
          archived: lease.archivedAt || lease.deletedAt ? "yes" : "",
        })),
      );
    }

    if (!APPLY) {
      console.log(
        `Dry run — nothing written. ${planned.length} contract(s) would be dated; re-run with --apply to write.`,
      );
      return;
    }

    const writtenByOrg = new Map<
      string,
      { audit: string[]; updatedAt: string[] }
    >();
    let changedSinceRead = 0;
    for (const { lease, date, source, terminatedById } of planned) {
      const result = await db.lease.updateMany({
        where: {
          id: lease.id,
          status: LeaseStatus.TERMINATED,
          terminatedDate: null,
          // Untouched since it was read — and naming deletedAt also lets an
          // archived row through the soft-delete filter.
          updatedAt: lease.updatedAt,
          deletedAt: lease.deletedAt,
        },
        data: {
          terminatedDate: date,
          ...(terminatedById ? { terminatedById } : {}),
          updatedAt: lease.updatedAt,
        },
      });
      if (result.count !== 1) {
        changedSinceRead += 1;
        continue;
      }
      const written = writtenByOrg.get(lease.organizationId) ?? {
        audit: [],
        updatedAt: [],
      };
      written[source].push(lease.id);
      writtenByOrg.set(lease.organizationId, written);
    }

    let total = 0;
    for (const [orgId, written] of writtenByOrg) {
      const count = written.audit.length + written.updatedAt.length;
      total += count;
      await recordPlatformAudit({
        actor: SYSTEM_ACTOR,
        action: "lease.cancellation_dates_backfilled",
        targetType: "organization",
        targetId: orgId,
        targetName: orgName.get(orgId) ?? orgId,
        organizationId: orgId,
        summary: `Dated ${count} cancelled contract(s) from the audit trail and their last update`,
        metadata: {
          script: "src/scripts/backfill-lease-cancellation-dates.ts",
          fromAudit: written.audit,
          fromUpdatedAt: written.updatedAt,
        },
      });
    }

    console.log(
      `Wrote ${total} contract(s).` +
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
