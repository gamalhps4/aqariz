/**
 * PropertyPro - Lease lifecycle rules
 *
 * What a contract's status obliges the system to do, as plain judgement.
 * Deliberately kept out of `services/lease-lifecycle.service.ts`, the way
 * `lease-installment-state.ts` is kept out of its own service: these rules
 * need a status, a schedule and a clock, and wedged beside Prisma they could
 * only be exercised against a database.
 *
 * The service owns the writes; this owns the rules:
 *  - which status changes are allowed at all;
 *  - a contract in force has its installments billed, whichever path brought
 *    it into force, and billing it twice bills nothing twice;
 *  - a cancelled contract says when it ended, who ended it and why.
 */

import { LeaseStatus } from "@/types";

// ============================================================================
// Status transitions
// ============================================================================

/**
 * Valid lease status transitions. Ended leases stay ended: reviving a
 * TERMINATED/EXPIRED lease means creating a renewal, not flipping status.
 */
export const LEASE_STATUS_TRANSITIONS: Record<LeaseStatus, LeaseStatus[]> = {
  [LeaseStatus.DRAFT]: [
    LeaseStatus.PENDING,
    LeaseStatus.PENDING_SIGNATURE,
    LeaseStatus.ACTIVE,
    LeaseStatus.TERMINATED,
  ],
  [LeaseStatus.PENDING]: [
    LeaseStatus.PENDING_SIGNATURE,
    LeaseStatus.ACTIVE,
    LeaseStatus.TERMINATED,
    LeaseStatus.DRAFT,
  ],
  [LeaseStatus.PENDING_SIGNATURE]: [
    LeaseStatus.ACTIVE,
    LeaseStatus.TERMINATED,
    LeaseStatus.DRAFT,
  ],
  [LeaseStatus.ACTIVE]: [
    LeaseStatus.EXPIRED,
    LeaseStatus.TERMINATED,
    LeaseStatus.RENEWED,
  ],
  [LeaseStatus.EXPIRED]: [LeaseStatus.RENEWED],
  [LeaseStatus.TERMINATED]: [],
  [LeaseStatus.RENEWED]: [],
};

export function isValidLeaseStatusTransition(
  from: LeaseStatus,
  to: LeaseStatus
): boolean {
  if (from === to) return true;
  return (LEASE_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

const KNOWN_STATUSES: readonly unknown[] = Object.values(LeaseStatus);

/**
 * Why a status change is refused, or null when the table allows it.
 *
 * The table used to be consulted by one route alone. Activating, expiring and
 * terminating through the same endpoint, and a status sent with an edit, went
 * around it — a cancelled contract could be activated again and re-occupy its
 * unit. Every write of a status now asks this first (see `changeLeaseStatus`
 * in services/lease-lifecycle.service.ts).
 */
export function leaseTransitionRefusal(
  from: unknown,
  to: unknown
): string | null {
  if (!KNOWN_STATUSES.includes(to)) {
    return `Unknown contract status "${String(to)}"`;
  }
  if (from === to) return null;
  if (!KNOWN_STATUSES.includes(from)) {
    return `Invalid status transition from ${String(from)} to ${String(to)}`;
  }
  return isValidLeaseStatusTransition(from as LeaseStatus, to as LeaseStatus)
    ? null
    : `Invalid status transition from ${String(from)} to ${String(to)}`;
}

// ============================================================================
// Renewal and the unit
// ============================================================================

/** What these rules need to know about a contract. */
export interface LeaseStanding {
  id: string;
  status: unknown;
  endDate: Date | string;
  renewedLeaseId?: string | null;
  deletedAt?: Date | string | null;
}

/** The states a renewed contract can hand its unit over from. */
const HANDS_OVER_FROM: readonly unknown[] = [
  LeaseStatus.ACTIVE,
  LeaseStatus.EXPIRED,
];

/**
 * Whether bringing `successorId` into force makes the contract it renews step
 * aside — become RENEWED, in the same write as the successor's activation.
 *
 * A renewal saved as a draft leaves the contract it renews as it was: in
 * force and holding the unit, or lapsed if its term has already run out. It
 * used to be marked RENEWED at once instead, and a draft that was never
 * activated then left the unit occupied by a contract that was no longer in
 * force, with nothing due to ever free it. Only a renewal that comes into
 * force has renewed anything.
 *
 * Only the contract that names this successor steps aside, and only from a
 * state the table lets become RENEWED.
 */
export function stepsAsideFor(
  predecessor: Pick<LeaseStanding, "status" | "renewedLeaseId" | "deletedAt"> | null | undefined,
  successorId: string
): boolean {
  return Boolean(
    predecessor &&
      !predecessor.deletedAt &&
      predecessor.renewedLeaseId === successorId &&
      HANDS_OVER_FROM.includes(predecessor.status)
  );
}

/**
 * Whether a renewal still stands — waiting to be activated, or in force.
 *
 * One that was cancelled before it came into force, or deleted as a draft,
 * renews nothing: the contract it was for may be renewed again.
 */
export function isLiveRenewal(
  successor: Pick<LeaseStanding, "status" | "deletedAt"> | null | undefined
): boolean {
  return Boolean(
    successor &&
      !successor.deletedAt &&
      successor.status !== LeaseStatus.TERMINATED
  );
}

/** Statuses of a contract that has not yet come into force. */
const NOT_YET_IN_FORCE: readonly unknown[] = [
  LeaseStatus.DRAFT,
  LeaseStatus.PENDING,
  LeaseStatus.PENDING_SIGNATURE,
];

/**
 * Whether cancelling this contract withdraws a renewal that never came into
 * force. The contract it was meant to renew then no longer points at it.
 */
export function withdrawsRenewal(input: {
  from: unknown;
  to: unknown;
  parentLeaseId?: string | null;
}): boolean {
  return (
    Boolean(input.parentLeaseId) &&
    input.to === LeaseStatus.TERMINATED &&
    NOT_YET_IN_FORCE.includes(input.from)
  );
}

/**
 * Whether a contract still has a claim on its unit.
 *
 * A contract in force does. So does a RENEWED one within its term whose unit
 * still points at it: renewals used to be marked RENEWED while their
 * successor was only a draft, and the tenant of such a contract is still in
 * the unit until its last day. Nothing else holds a unit.
 */
export function holdsUnit(
  lease: Pick<LeaseStanding, "status" | "endDate" | "deletedAt">,
  now: Date
): boolean {
  if (lease.deletedAt) return false;
  if (lease.status === LeaseStatus.ACTIVE) return true;
  if (lease.status === LeaseStatus.RENEWED) {
    return !isPastCalendarDay(new Date(lease.endDate), now);
  }
  return false;
}

/**
 * Whether a contract that ends frees its unit.
 *
 * It used to, always. So cancelling a draft on a unit another contract was
 * living in — a renewal withdrawn before it was activated, say — turned that
 * tenant's unit "available". A unit is freed only when nobody else holds it:
 * no other contract on it is in force, and the contract the unit points at,
 * if it is another one, has no claim left either.
 */
export function releasesUnit(input: {
  leaseId: string;
  /** Another contract on the unit is ACTIVE. */
  otherActive: boolean;
  /** The contract the unit currently points at, when there is one. */
  pointedAt?: Pick<LeaseStanding, "id" | "status" | "endDate" | "deletedAt"> | null;
  now: Date;
}): boolean {
  if (input.otherActive) return false;
  const pointed = input.pointedAt;
  if (pointed && pointed.id !== input.leaseId && holdsUnit(pointed, input.now)) {
    return false;
  }
  return true;
}

// ============================================================================
// Billing
// ============================================================================

/**
 * Whether arriving in a status bills the contract.
 *
 * Coming into force is the only such moment, and every road into it counts —
 * created active, signed, activated by a status change, renewed. Installments
 * used to be generated on the first of those alone, so a renewal or a contract
 * activated later showed a schedule nobody could collect against.
 *
 * `arrived` is false for a write that finds the contract already in that
 * status (a repeated "activate"). That bills nothing: automatic billing
 * happens once, at the moment of arrival. A contract in force that is still
 * missing installments is a matter for the deliberate "Generate installments"
 * action, where the office sees what it is about to bill.
 */
export function billsOnArrival(status: unknown, arrived = true): boolean {
  return arrived && status === LeaseStatus.ACTIVE;
}

/**
 * Statuses in which a contract's installments may be billed at all.
 *
 * A contract owes rent once it is in force, and goes on owing what it ran up
 * after it lapses or is renewed. A draft owes nothing yet — it is billed the
 * moment it becomes active — and a cancelled contract's unbilled periods were
 * cancelled with it.
 */
const BILLABLE_STATUSES: readonly unknown[] = [
  LeaseStatus.ACTIVE,
  LeaseStatus.EXPIRED,
  LeaseStatus.RENEWED,
];

export function canBillInstallments(status: unknown): boolean {
  return BILLABLE_STATUSES.includes(status);
}

/** Not in force yet, but still able to be: draft, pending, awaiting signature. */
export function awaitsActivation(status: unknown): boolean {
  return (
    LEASE_STATUS_TRANSITIONS[status as LeaseStatus] ?? []
  ).includes(LeaseStatus.ACTIVE);
}

/**
 * Who may bill a contract's installments by hand.
 *
 * Whoever can already act on them: the staff who add, change and remove
 * installments, and the staff who record payments against them — a collector
 * facing an unbilled contract could otherwise do nothing at all.
 */
export const INSTALLMENT_GENERATION_PERMISSIONS = [
  "lease_management",
  "lease_edit",
  "financial_management",
  "payment_processing",
  "payment_create",
] as const;

/**
 * The installments a contract calls for that nothing has billed yet.
 *
 * An installment is billed under the first day of its period: that date is
 * the invoice's `periodStart`, and the database keeps it unique per contract.
 * So "what is left to bill" is the plan minus the periods already invoiced —
 * which is what makes generation safe to repeat. Billed once, a period is
 * never returned again, whether its invoice was paid, edited or cancelled: an
 * installment the office removed stays removed.
 *
 * Invoices with no period (one-off charges added by hand) cover no part of the
 * plan and are ignored.
 */
export function unbilledInstallments<T extends { periodStart: Date }>(
  plan: readonly T[],
  billedPeriodStarts: Iterable<Date | string | null | undefined>,
): T[] {
  const billed = new Set<number>();
  for (const periodStart of billedPeriodStarts) {
    if (periodStart === null || periodStart === undefined) continue;
    const time = new Date(periodStart).getTime();
    if (Number.isFinite(time)) billed.add(time);
  }
  return plan.filter(
    (installment) => !billed.has(installment.periodStart.getTime()),
  );
}

// ============================================================================
// Cancellation
// ============================================================================

/** What the contract row keeps about its own cancellation. */
export interface CancellationRecord {
  terminatedDate: Date;
  terminatedById: string;
  terminationReason?: string;
}

/** The longest reason the terminate form accepts. */
const MAX_REASON_LENGTH = 1000;

/**
 * What a contract records when it is cancelled: the day, the person, and the
 * reason when one was given.
 *
 * Only the terminate form used to write these. Every other way of cancelling
 * set the status alone, so the contract reached the Cancelled register with
 * no date — and dropped out of it as soon as a date range was chosen.
 *
 * Returns null for a contract that is already cancelled: the record describes
 * the moment it ended, and a repeated request must not move that moment.
 */
export function cancellationRecord(input: {
  /** The contract's status before this write. */
  previousStatus: unknown;
  userId: string;
  /** The day the tenancy ends; the moment of cancelling when none is named. */
  date?: Date | null;
  reason?: unknown;
  now?: Date;
}): CancellationRecord | null {
  if (input.previousStatus === LeaseStatus.TERMINATED) return null;

  const named =
    input.date && Number.isFinite(input.date.getTime()) ? input.date : null;
  const reason =
    typeof input.reason === "string"
      ? input.reason.trim().slice(0, MAX_REASON_LENGTH)
      : "";

  return {
    terminatedDate: named ?? input.now ?? new Date(),
    terminatedById: input.userId,
    ...(reason ? { terminationReason: reason } : {}),
  };
}

/**
 * Whether a termination date lies before today.
 *
 * A termination date is a calendar day and arrives as UTC midnight, the way a
 * date input's value parses (see lease-installments.ts). Compared with the
 * clock as an instant, today's own date was "in the past" from the first
 * second of the day — so the terminate form refused the date it opens with.
 * Day against day, in UTC like every other contract date.
 */
export function isPastCalendarDay(day: Date, now: Date): boolean {
  const startOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return day.getTime() < startOfToday;
}

/**
 * The cancellation date to give a contract that was cancelled without one.
 *
 * The audit trail knows the moment when it recorded the change. Failing that,
 * the row's last update is the closest thing the database still holds: the
 * cancellation was a write to the row, so it cannot be later than that.
 */
export function backfilledCancellationDate(evidence: {
  auditedAt?: Date | null;
  updatedAt: Date;
}): { date: Date; source: "audit" | "updatedAt" } {
  return evidence.auditedAt
    ? { date: evidence.auditedAt, source: "audit" }
    : { date: evidence.updatedAt, source: "updatedAt" };
}
