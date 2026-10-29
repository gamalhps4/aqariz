/**
 * PropertyPro - Lease lifecycle side effects (Prisma)
 *
 * These helpers replace the Mongoose Lease model hooks:
 *  - pre-save overlap validation ("no two active/pending leases on the same
 *    unit with intersecting date ranges"),
 *  - post-save unit synchronization (active -> unit occupied, terminated/
 *    expired -> unit available unless another contract holds it) followed by
 *    a property derived-state resync,
 *  - the payment cascade that cancels open payments when a lease is
 *    terminated or expires,
 *  - the billing of a contract's installments when it comes into force,
 *  - the hand-over of the unit from a renewed contract to its renewal.
 *
 * Every status change goes through `changeLeaseStatus`, which checks it
 * against the transition table and runs all of the above. The rules
 * themselves — which transitions exist, when a contract is billed, who holds
 * a unit — live in `lib/lease-lifecycle.ts`, where they can be tested without
 * a database.
 */

import {
  db,
  runWithOrgTransaction,
  type OrgTransactionClient,
} from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { LeaseStatus, PaymentStatus } from "@/types";
import {
  billsOnArrival,
  canBillInstallments,
  leaseTransitionRefusal,
  releasesUnit,
  stepsAsideFor,
  withdrawsRenewal,
} from "@/lib/lease-lifecycle";
import type {
  GenerationResult,
  InvoiceGenerationConfig,
} from "@/lib/services/auto-invoice-generation.service";
import { auditLeaseStatusChange, type AuditAction } from "@/lib/audit-domain";
import { startOfBusinessDay } from "@/lib/dates/business-day";

export {
  LEASE_STATUS_TRANSITIONS,
  isValidLeaseStatusTransition,
} from "@/lib/lease-lifecycle";

/** Exact message the old Mongoose pre-save hook produced. */
export const LEASE_OVERLAP_ERROR =
  "Lease dates overlap with existing lease for this unit";

export interface LeaseOverlapParams {
  unitId: string;
  startDate: Date | string;
  endDate: Date | string;
  propertyId?: string;
  excludeLeaseId?: string;
  /** Several contracts to leave out — a renewal and the one it replaces. */
  excludeLeaseIds?: readonly string[];
}

/**
 * Finds another active/pending lease on the same unit whose date range
 * intersects the supplied one (start <= other.end && end >= other.start).
 */
export async function findOverlappingLease(params: LeaseOverlapParams) {
  const excluded = [
    ...(params.excludeLeaseId ? [params.excludeLeaseId] : []),
    ...(params.excludeLeaseIds ?? []),
  ];
  return db.lease.findFirst({
    where: {
      ...(params.propertyId ? { propertyId: params.propertyId } : {}),
      unitId: params.unitId,
      ...(excluded.length > 0 ? { id: { notIn: excluded } } : {}),
      status: { in: [LeaseStatus.ACTIVE, LeaseStatus.PENDING] },
      startDate: { lte: new Date(params.endDate) },
      endDate: { gte: new Date(params.startDate) },
      deletedAt: null,
    },
  });
}

interface LeaseLike {
  id: string;
  status: string;
  unitId: string;
  propertyId: string;
  tenantId: string;
}

/**
 * Transactional core of the status side effects: unit occupancy sync and the
 * payment cascade run on the caller's transaction client and THROW on
 * failure. The old post-save-hook port swallowed every error, so a failed
 * sync left a terminated lease with an occupied unit and open payments while
 * the API reported success.
 */
export async function applyLeaseStatusSideEffectsTx(
  tx: OrgTransactionClient,
  lease: LeaseLike,
  options: {
    statusChanged?: boolean;
    /**
     * When set, only payments due on or after this date are cancelled.
     * Termination passes the termination date so rent the tenant already
     * owes survives as a payable instead of being written off; leaving it
     * undefined keeps the original behaviour of cancelling everything open.
     */
    cancelPaymentsFrom?: Date;
  } = {}
): Promise<void> {
  if (lease.status === LeaseStatus.ACTIVE) {
    await tx.unit.updateMany({
      where: { id: lease.unitId, deletedAt: null },
      data: {
        status: "occupied",
        currentTenantId: lease.tenantId,
        currentLeaseId: lease.id,
      },
    });
  } else if (
    lease.status === LeaseStatus.TERMINATED ||
    lease.status === LeaseStatus.EXPIRED
  ) {
    await releaseUnitIfUnheld(tx, lease);
  }

  const statusChanged = options.statusChanged ?? true;
  if (
    statusChanged &&
    (lease.status === LeaseStatus.TERMINATED ||
      lease.status === LeaseStatus.EXPIRED)
  ) {
    // Payment cascade (was Lease.handlePaymentCascades). PARTIAL is
    // deliberately NOT cancelled: a partial payment holds real captured
    // money, and flipping it to CANCELLED made that money disappear from
    // every follow-up view while its invoice application stood.
    await tx.payment.updateMany({
      where: {
        leaseId: lease.id,
        status: {
          in: [
            PaymentStatus.PENDING,
            PaymentStatus.OVERDUE,
            PaymentStatus.FAILED,
          ],
        },
        ...(options.cancelPaymentsFrom
          ? { dueDate: { gte: options.cancelPaymentsFrom } }
          : {}),
        deletedAt: null,
      },
      data: {
        status: PaymentStatus.CANCELLED,
        notes: `Cancelled due to lease ${lease.status.toLowerCase()}`,
        lastSyncedAt: new Date(),
        syncStatus: "synced",
      },
    });
  }
}

/**
 * Free a contract's unit — unless another contract holds it.
 *
 * Ending a contract used to mark its unit available whatever else was going
 * on there. Cancelling a draft on a unit someone was living in — a renewal
 * withdrawn before it was activated — emptied that tenant's unit on paper.
 * The rule is `releasesUnit` in lib/lease-lifecycle.ts; this reads what it
 * needs, inside the caller's transaction.
 */
async function releaseUnitIfUnheld(
  tx: OrgTransactionClient,
  lease: LeaseLike,
  now: Date = new Date()
): Promise<void> {
  const unit = await tx.unit.findFirst({
    where: { id: lease.unitId, deletedAt: null },
    select: { currentLeaseId: true },
  });
  if (!unit) return;

  const otherActive = await tx.lease.findFirst({
    where: {
      unitId: lease.unitId,
      status: LeaseStatus.ACTIVE,
      id: { not: lease.id },
      deletedAt: null,
    },
    select: { id: true },
  });
  const pointedAt =
    unit.currentLeaseId && unit.currentLeaseId !== lease.id
      ? await tx.lease.findFirst({
          where: { id: unit.currentLeaseId },
          select: { id: true, status: true, endDate: true, deletedAt: true },
        })
      : null;

  if (
    !releasesUnit({
      leaseId: lease.id,
      otherActive: Boolean(otherActive),
      pointedAt,
      now,
    })
  ) {
    return;
  }

  await tx.unit.updateMany({
    where: { id: lease.unitId, deletedAt: null },
    data: {
      status: "available",
      currentTenantId: null,
      currentLeaseId: null,
    },
  });
}

/**
 * A contract in force corrected to another unit or tenant (an amendment
 * before any money came in, lib/lease-amendment.ts): the unit it left is
 * freed unless another contract holds it, and the one it is in now is
 * occupied by its tenant.
 */
export async function moveLeasePlacementTx(
  tx: OrgTransactionClient,
  before: LeaseLike,
  after: LeaseLike
): Promise<void> {
  if (before.unitId !== after.unitId) await releaseUnitIfUnheld(tx, before);
  await applyLeaseStatusSideEffectsTx(tx, after, { statusChanged: false });
}

/**
 * Best-effort resync of the property's derived status/totals. This state is
 * recomputable from the units at any time, so a failure logs rather than
 * failing the request — unlike the unit/payment sync above, which must hold.
 */
export async function resyncPropertyDerivedStatus(
  propertyId: string
): Promise<void> {
  try {
    const { propertyStatusSynchronizer } = await import(
      "@/lib/services/property-status-sync.service"
    );
    await propertyStatusSynchronizer.syncPropertyStatus(propertyId, {
      triggeredBy: "lease-status-sync",
    });
  } catch (error) {
    console.error(
      `Failed to resync property ${propertyId} derived status:`,
      error
    );
  }
}

/**
 * Bill the installments a contract calls for and nothing has invoiced yet.
 *
 * Safe to repeat: the generator bills each period once, so a second run over
 * a fully billed contract creates nothing. Returns null for a contract that
 * is not billable — a draft owes nothing until it comes into force.
 *
 * Failures come back in `errors` rather than being thrown or logged away.
 * Billing runs after the status change has committed (a schedule is too many
 * statements to hold a transaction open for), so by then the contract IS
 * active; what the caller owes its user is the truth about the installments,
 * and the schedule's own "Generate installments" action finishes the job.
 *
 * Rent only, issued, nothing emailed — unless the caller says otherwise. The
 * deposit is billed once, with a brand-new contract; a renewal carries the
 * tenant's existing deposit over and must not charge a second one.
 */
export async function billLeaseInstallments(
  lease: { id: string; status: string },
  config: Partial<InvoiceGenerationConfig> = {}
): Promise<GenerationResult | null> {
  if (!canBillInstallments(lease.status)) return null;

  // An option passed as `undefined` means "not stated", not "unset": spread
  // as it is, it would blank the default beneath it.
  const stated = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined)
  ) as Partial<InvoiceGenerationConfig>;

  const { autoInvoiceGenerationService } = await import(
    "@/lib/services/auto-invoice-generation.service"
  );
  return autoInvoiceGenerationService.generateInvoicesForLease(lease.id, {
    generateSecurityDeposit: false,
    autoIssue: true,
    autoEmail: false,
    ...stated,
  });
}

/**
 * Full status-transition side effects: unit sync + payment cascade run
 * atomically (and throw on failure — callers surface a real error instead of
 * reporting success over divergent state), then the property's derived
 * status is refreshed best-effort.
 *
 * A contract arriving in force is then billed, whichever route brought it
 * here; the outcome is returned for the caller to report (null when nothing
 * was billed — another status, or a contract that was already in force and
 * so did not arrive).
 */
export async function applyLeaseStatusSideEffects(
  lease: LeaseLike,
  options: {
    statusChanged?: boolean;
    billing?: Partial<InvoiceGenerationConfig>;
  } = {}
): Promise<GenerationResult | null> {
  await runWithOrgTransaction((tx) =>
    applyLeaseStatusSideEffectsTx(tx, lease, {
      statusChanged: options.statusChanged,
    })
  );
  await resyncPropertyDerivedStatus(lease.propertyId);

  return billsOnArrival(lease.status, options.statusChanged ?? true)
    ? billLeaseInstallments(lease, options.billing)
    : null;
}

// ============================================================================
// Changing a contract's status
// ============================================================================

/** A status change refused before anything was written. */
export class LeaseStatusChangeError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = "LeaseStatusChangeError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function leaseChangedMeanwhile(): LeaseStatusChangeError {
  return new LeaseStatusChangeError(
    "This contract has just been changed. Reload it and try again.",
    409,
    "LEASE_CHANGED"
  );
}

/** A contract row as a transaction reads it back, money as numbers. */
type LeaseRow = NonNullable<
  Awaited<ReturnType<OrgTransactionClient["lease"]["findFirst"]>>
>;

/** The contract as read by the caller — what a status change needs of it. */
export interface LeaseForStatusChange extends LeaseLike {
  startDate: Date;
  endDate: Date;
  parentLeaseId?: string | null;
}

export interface LeaseStatusChange<L extends LeaseForStatusChange> {
  lease: L;
  to: string;
  /**
   * Columns written in the same statement as the status: a signature, the
   * record of a cancellation, an edit's fields. Scalars only — foreign keys by
   * their id columns.
   */
  data?: Prisma.LeaseUncheckedUpdateManyInput;
  /** Termination: only payments due on or after this day are cancelled. */
  cancelPaymentsFrom?: Date;
  /** Further writes that must commit or fail with the change. */
  alsoInTransaction?: (
    tx: OrgTransactionClient,
    updated: LeaseRow
  ) => Promise<void>;
  /** How a contract arriving in force is billed. */
  billing?: Partial<InvoiceGenerationConfig>;
  /** How the activity log names the change, when the status alone does not. */
  audit?: { action?: AuditAction; details?: Record<string, unknown> };
}

/**
 * Change a contract's status — the one way every route does it.
 *
 * Before, each route wrote the status its own way: the status changer checked
 * the transition table, while "activate", "expire" and "terminate" beside it,
 * a status sent with an edit, and signing did not. So a cancelled contract
 * could be activated again and take its unit back. Here:
 *
 *  1. the change is checked against the transition table;
 *  2. arriving in force (or pending), the dates are checked against the other
 *     contracts on the unit;
 *  3. in one transaction: a renewed contract steps aside for its renewal, the
 *     contract is claimed by the status it was read with (two concurrent
 *     changes cannot both win), its unit and payments follow, and a renewal
 *     withdrawn before it came into force is unhooked from its predecessor;
 *  4. a contract that arrived in force is billed, and the outcome returned.
 */
export async function changeLeaseStatus<L extends LeaseForStatusChange>(
  change: LeaseStatusChange<L>
): Promise<{
  lease: LeaseRow;
  invoiceGeneration: GenerationResult | null;
}> {
  const { lease, to } = change;
  const from = lease.status;

  const refusal = leaseTransitionRefusal(from, to);
  if (refusal) {
    throw new LeaseStatusChangeError(refusal, 409, "INVALID_TRANSITION");
  }
  const arriving = from !== to;

  // The row as it will stand: an edit can move the dates or the unit together
  // with the status.
  const unitId = (change.data?.unitId as string | undefined) ?? lease.unitId;
  const startDate =
    (change.data?.startDate as Date | undefined) ?? lease.startDate;
  const endDate = (change.data?.endDate as Date | undefined) ?? lease.endDate;

  // A renewal coming into force takes over from the contract it renews,
  // which until now stayed as it was — see stepsAsideFor.
  const predecessor =
    arriving && to === LeaseStatus.ACTIVE && lease.parentLeaseId
      ? await db.lease.findFirst({
          where: { id: lease.parentLeaseId },
          select: { id: true, status: true, renewedLeaseId: true, deletedAt: true },
        })
      : null;
  const handover =
    predecessor && stepsAsideFor(predecessor, lease.id) ? predecessor : null;

  // Arriving in an occupying status re-runs the overlap guard: two drafts on
  // one unit both pass their create-time check, since drafts are invisible
  // to it. The contract stepping aside is no obstacle. The database's
  // leases_one_active_per_unit index stays the backstop.
  if (arriving && (to === LeaseStatus.ACTIVE || to === LeaseStatus.PENDING)) {
    const overlap = await findOverlappingLease({
      unitId,
      startDate,
      endDate,
      excludeLeaseIds: [lease.id, ...(handover ? [handover.id] : [])],
    });
    if (overlap) {
      throw new LeaseStatusChangeError(LEASE_OVERLAP_ERROR, 409, "LEASE_OVERLAP");
    }
  }

  const updated = await runWithOrgTransaction(async (tx) => {
    // The predecessor goes first: the one-active-lease-per-unit index would
    // refuse its renewal while it is still active.
    if (handover) {
      const stepped = await tx.lease.updateMany({
        where: {
          id: handover.id,
          status: handover.status,
          renewedLeaseId: lease.id,
          deletedAt: null,
        },
        data: { status: LeaseStatus.RENEWED },
      });
      if (stepped.count === 0) throw leaseChangedMeanwhile();
    }

    const claimed = await tx.lease.updateMany({
      where: { id: lease.id, status: from, deletedAt: null },
      data: { ...change.data, status: to },
    });
    if (claimed.count === 0) throw leaseChangedMeanwhile();

    const row = await tx.lease.findFirst({ where: { id: lease.id } });
    if (!row) throw leaseChangedMeanwhile();

    await applyLeaseStatusSideEffectsTx(tx, row, {
      statusChanged: arriving,
      cancelPaymentsFrom: change.cancelPaymentsFrom,
    });

    // A renewal cancelled before it came into force renews nothing: the
    // contract it was for stops pointing at it and may be renewed again.
    if (
      lease.parentLeaseId &&
      withdrawsRenewal({ from, to, parentLeaseId: lease.parentLeaseId })
    ) {
      await tx.lease.updateMany({
        where: { id: lease.parentLeaseId, renewedLeaseId: lease.id },
        data: { renewedLeaseId: null },
      });
    }

    await change.alsoInTransaction?.(tx, row);
    return row;
  });

  // Property derived status is recomputable — refreshed best-effort, for the
  // building the contract is in now and, after a move, the one it left.
  await resyncPropertyDerivedStatus(updated.propertyId);
  if (updated.propertyId !== lease.propertyId) {
    await resyncPropertyDerivedStatus(lease.propertyId);
  }

  // Billing runs after the change has committed — a schedule is too many
  // statements to hold a transaction open for — so a failure cannot undo the
  // activation; it comes back in `errors` for the caller to report.
  const invoiceGeneration = billsOnArrival(to, arriving)
    ? await billLeaseInstallments(updated, change.billing)
    : null;

  // One activity entry for the change — the status and every field written
  // with it, before and after. The routes that call this record nothing more.
  auditLeaseStatusChange({
    lease: lease as unknown as Record<string, unknown> & { id: string; status: string },
    to,
    data: change.data as Record<string, unknown> | undefined,
    updated,
    action: change.audit?.action,
    details: {
      ...change.audit?.details,
      ...(invoiceGeneration
        ? { installmentsGenerated: invoiceGeneration.invoicesGenerated }
        : {}),
    },
  });

  return { lease: updated, invoiceGeneration };
}

/**
 * Unhook a draft renewal that is being deleted from the contract it was for,
 * so that contract no longer shows a renewal and may be renewed again.
 */
export async function unhookWithdrawnRenewals(
  leaseIds: readonly string[]
): Promise<void> {
  if (leaseIds.length === 0) return;
  await db.lease.updateMany({
    where: { renewedLeaseId: { in: [...leaseIds] } },
    data: { renewedLeaseId: null },
  });
}

/**
 * Free the units still held by renewed contracts whose term is over while
 * their renewal never came into force.
 *
 * Renewals used to mark the contract they renewed RENEWED at once, even when
 * the renewal was only saved as a draft; a draft never activated left the
 * unit occupied by a contract no longer in force, and the daily expiry — which
 * only looks at active contracts — never touched it. New renewals no longer
 * do this (the old contract stays active until its renewal is), so this only
 * sweeps up contracts renewed that way before. Returns how many units it
 * freed.
 */
export async function releaseUnitsOfLapsedRenewals(
  now: Date = new Date()
): Promise<number> {
  const startOfToday = startOfBusinessDay(now);

  const lapsed = await db.lease.findMany({
    where: { status: LeaseStatus.RENEWED, endDate: { lt: startOfToday } },
    select: {
      id: true,
      status: true,
      unitId: true,
      propertyId: true,
      tenantId: true,
      renewedLeaseId: true,
    },
  });
  if (lapsed.length === 0) return 0;

  // Only the ones the unit still points at, and whose renewal is not in force.
  const units = await db.unit.findMany({
    where: {
      id: { in: [...new Set(lapsed.map((lease) => lease.unitId))] },
      currentLeaseId: { in: lapsed.map((lease) => lease.id) },
    },
    select: { id: true, currentLeaseId: true },
  });
  let freed = 0;
  for (const unit of units) {
    const lease = lapsed.find((row) => row.id === unit.currentLeaseId);
    if (!lease) continue;
    const renewal = lease.renewedLeaseId
      ? await db.lease.findFirst({
          where: { id: lease.renewedLeaseId },
          select: { status: true },
        })
      : null;
    if (renewal?.status === LeaseStatus.ACTIVE) continue;

    await runWithOrgTransaction((tx) => releaseUnitIfUnheld(tx, lease, now));
    await resyncPropertyDerivedStatus(lease.propertyId);
    freed += 1;
  }
  return freed;
}
