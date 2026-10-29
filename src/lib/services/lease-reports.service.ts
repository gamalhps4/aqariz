/**
 * PropertyPro - Leasing module reports
 *
 * The three contract registers the leasing area is required to produce:
 * active · expired · terminated.
 *
 * "Expired" is derived from the contract's own end date rather than trusted
 * from its status column. A lease is flipped to EXPIRED by a nightly cron, so
 * a status-only query would report a contract that lapsed this morning as
 * still active — the register would be wrong for up to a day, every day.
 */

import { db } from "@/lib/db/prisma";
import { leaseScope, withScope, type ScopeActor } from "@/lib/db/scopes";
import { LeaseStatus } from "@/types";
import {
  FREQUENCY_LABELS,
  leaseAnnualRent,
  normalizeFrequency,
  type PaymentFrequencyKey,
} from "@/lib/lease-installments";
import {
  APPROACHING_EXPIRY_DAYS,
  EXPIRING_SOON_DAYS,
  leaseReportWhere,
  startOfReportDay,
} from "@/lib/reports/report-where";
import { leaseRegisterWhere } from "@/lib/report-filters/lease-where";
import {
  renewalInfo,
  renewedWithin,
  successorOf,
  type RenewalInfo,
} from "@/lib/reports/renewals";
import { endOfBusinessDay } from "@/lib/dates/business-day";

export type LeaseReportType =
  | "active"
  | "expiring-soon"
  | "expiring"
  | "renewed"
  | "expired"
  | "terminated";

export const LEASE_REPORT_TYPES: readonly LeaseReportType[] = [
  "active",
  "expiring-soon",
  "expiring",
  "renewed",
  "expired",
  "terminated",
] as const;

// The two expiry registers' default windows live beside the query that reads
// them, in lib/reports/report-where.ts.
export { APPROACHING_EXPIRY_DAYS, EXPIRING_SOON_DAYS };
/** Kept for callers of the old single window. */
export const DEFAULT_EXPIRY_WINDOW_DAYS = APPROACHING_EXPIRY_DAYS;

export function isLeaseReportType(value: unknown): value is LeaseReportType {
  return LEASE_REPORT_TYPES.includes(value as LeaseReportType);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export interface LeaseReportRow {
  leaseId: string;
  contractNumber: string | null;
  tenantName: string;
  tenantEmail: string;
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  startDate: string;
  endDate: string;
  status: string;
  frequency: PaymentFrequencyKey;
  frequencyLabel: string;
  rentAmount: number;
  /** Rent annualised from the contract's own frequency. */
  annualValue: number;
  currency: string;
  taxEnabled: boolean;
  taxRate: number;
  /** Active: days left. Expired: days since lapse. Terminated: unused (0). */
  daysRemaining: number;
  terminatedDate: string | null;
  terminationReason: string | null;
  /**
   * True when the end date has passed but the nightly sweep has not yet
   * flipped the status. Surfaced so the register explains itself rather than
   * quietly disagreeing with the contract's own status badge.
   */
  awaitingStatusSweep: boolean;
  /**
   * Renewed register only: the contract that took over, and the day the
   * renewal was made. Null elsewhere, and for a renewed contract whose
   * successor cannot be found.
   */
  renewal: RenewalInfo | null;
}

export interface LeaseReport {
  rows: LeaseReportRow[];
  summary: {
    contractCount: number;
    tenantCount: number;
    propertyCount: number;
    totalRentPerInstallment: number;
    totalAnnualValue: number;
    withContractNumber: number;
    awaitingStatusSweep: number;
    /** Active only: contracts ending within 60 days. */
    endingSoon: number;
  };
}

const LEASE_INCLUDE = {
  tenant: { select: { id: true, firstName: true, lastName: true, email: true } },
  property: { select: { id: true, name: true } },
  unit: { select: { unitNumber: true } },
} as const;

/**
 * Build one contract register.
 *
 * `now` is a parameter so the caller can ask "what was active as at a date",
 * and so the behaviour is testable without moving the clock.
 */
export async function getLeaseReport(
  type: LeaseReportType,
  options: {
    propertyId?: string;
    /**
     * One owner's portfolio. The office leases on behalf of several owners, so
     * "which of my contracts are expiring" is an owner-scoped question —
     * filtered through the property, because ownership lives there.
     */
    ownerId?: string;
    /** One compound's buildings — filtered through the property too. */
    compoundId?: string;
    /** One unit's contracts. */
    unitId?: string;
    /** One tenant's contracts. */
    tenantId?: string;
    /** One contract. */
    leaseId?: string;
    /**
     * Who is asking. Required, not optional: this register used to be built
     * from the query parameters alone, so a caller narrowed to a few
     * buildings still got every contract in the organization — and could
     * export it. Making it a required argument means a new caller cannot
     * forget it the way an optional one would let them.
     */
    actor: ScopeActor;
    /** Only for `expiring`; ignored by the other registers. */
    withinDays?: number;
    /**
     * The date filter the review asks of every leasing report, applied to the
     * date each register is about: when a contract ends (expiry registers,
     * expired), when it was renewed (renewed), when it was cancelled
     * (terminated), when it began (active). Inclusive of the whole `to` day.
     */
    from?: Date;
    to?: Date;
    now?: Date;
  },
): Promise<LeaseReport> {
  const now = options.now ?? new Date();

  // End dates are stored at midnight, so a contract is only past its term
  // once its final day has fully elapsed.
  const endOfToday = endOfBusinessDay(now);
  const startOfToday = startOfReportDay(endOfToday);

  // Which contracts the register lists: its own rule, the filters asked for
  // (owner, compound, building, unit, tenant, contract), and the reader's
  // entitlement — all AND-ed, so none of them can stand in for another. The
  // building used to be spread over the scope, replacing it — see
  // lib/reports/report-where.ts and lib/report-filters/lease-where.ts.
  const scope = leaseScope(options.actor);
  const where = leaseRegisterWhere(
    type,
    {
      ownerId: options.ownerId,
      compoundId: options.compoundId,
      propertyId: options.propertyId,
      unitId: options.unitId,
      tenantId: options.tenantId,
      leaseId: options.leaseId,
    },
    {
      withinDays: options.withinDays,
      from: options.from,
      to: options.to,
      endOfToday,
    },
    scope,
  );

  let leases = await db.lease.findMany({
    where,
    include: LEASE_INCLUDE,
    orderBy:
      type === "terminated"
        ? { terminatedDate: "desc" }
        : type === "expired" || type === "renewed"
          ? { endDate: "desc" }
          // Soonest first: the top of an expiring list is what to chase today.
          : { endDate: "asc" },
  });

  // A renewed contract is shown with the one that took over, and filtered
  // and ordered by the day the renewal was made — see lib/reports/renewals.
  const renewals = new Map<string, RenewalInfo | null>();
  if (type === "renewed" && leases.length > 0) {
    const successors = await db.lease.findMany({
      where: withScope(
        {
          deletedAt: null,
          OR: [
            {
              id: {
                in: leases
                  .map((lease) => lease.renewedLeaseId)
                  .filter((id): id is string => Boolean(id)),
              },
            },
            { parentLeaseId: { in: leases.map((lease) => lease.id) } },
          ],
        },
        scope,
      ),
      select: {
        id: true,
        parentLeaseId: true,
        contractNumber: true,
        startDate: true,
        endDate: true,
        status: true,
        createdAt: true,
      },
    });
    for (const lease of leases) {
      renewals.set(lease.id, renewalInfo(successorOf(lease, successors)));
    }
    const renewedOn = (id: string) => {
      const day = renewals.get(id)?.renewedOn;
      return day ? new Date(day) : null;
    };
    leases = leases
      .filter((lease) =>
        renewedWithin(renewedOn(lease.id), options.from, options.to),
      )
      // Latest renewals first; one whose date is not known goes last.
      .sort(
        (a, b) =>
          (renewedOn(b.id)?.getTime() ?? -Infinity) -
            (renewedOn(a.id)?.getTime() ?? -Infinity) ||
          b.endDate.getTime() - a.endDate.getTime(),
      );
  }

  const tenants = new Set<string>();
  const properties = new Set<string>();
  let totalRentPerInstallment = 0;
  let totalAnnualValue = 0;
  let withContractNumber = 0;
  let awaitingSweep = 0;
  let endingSoon = 0;

  const rows: LeaseReportRow[] = leases.map((lease) => {
    const frequency = normalizeFrequency(lease.paymentFrequency);
    const rent = lease.rentAmount;
    // From the contract total when there is one: the stored rent is only
    // the regular share, rounded down.
    const annual = leaseAnnualRent(lease);
    const endDate = new Date(lease.endDate);
    // Past its term only once its last day is over.
    const lapsed = endDate < startOfToday;
    const pendingSweep = lapsed && lease.status === LeaseStatus.ACTIVE;

    tenants.add(lease.tenantId);
    properties.add(lease.propertyId);
    totalRentPerInstallment = round(totalRentPerInstallment + rent);
    totalAnnualValue = round(totalAnnualValue + annual);
    if (lease.contractNumber) withContractNumber += 1;
    if (pendingSweep) awaitingSweep += 1;

    // Whole days from today, not from this moment: a contract on its last
    // day has 0 days left, where it read -1 by the afternoon.
    const daysRemaining = daysBetween(startOfToday, endDate);
    if (
      (type === "active" || type === "expiring" || type === "expiring-soon") &&
      daysRemaining >= 0 &&
      daysRemaining <= 60
    ) {
      endingSoon += 1;
    }

    return {
      leaseId: lease.id,
      contractNumber: lease.contractNumber,
      tenantName:
        `${lease.tenant?.firstName ?? ""} ${lease.tenant?.lastName ?? ""}`.trim(),
      tenantEmail: lease.tenant?.email ?? "",
      propertyId: lease.propertyId,
      propertyName: lease.property?.name ?? "",
      unitNumber: lease.unit?.unitNumber ?? "",
      startDate: lease.startDate.toISOString(),
      endDate: lease.endDate.toISOString(),
      status: lease.status,
      frequency,
      frequencyLabel: FREQUENCY_LABELS[frequency],
      rentAmount: rent,
      annualValue: annual,
      currency: lease.currency,
      taxEnabled: Boolean(lease.taxEnabled),
      taxRate: Number(lease.taxRate) || 0,
      daysRemaining: type === "terminated" ? 0 : daysRemaining,
      terminatedDate: lease.terminatedDate
        ? lease.terminatedDate.toISOString()
        : null,
      terminationReason: lease.terminationReason,
      awaitingStatusSweep: pendingSweep,
      renewal: renewals.get(lease.id) ?? null,
    };
  });

  return {
    rows,
    summary: {
      contractCount: rows.length,
      tenantCount: tenants.size,
      propertyCount: properties.size,
      totalRentPerInstallment,
      totalAnnualValue,
      withContractNumber,
      awaitingStatusSweep: awaitingSweep,
      endingSoon,
    },
  };
}

/**
 * How many contracts a register lists today, with its own default window —
 * what the dashboard shows on the card that opens it, so the two cannot
 * disagree.
 */
export function countLeaseRegister(
  type: Exclude<LeaseReportType, "renewed">,
  options: { actor: ScopeActor; now?: Date },
): Promise<number> {
  return db.lease.count({
    where: leaseReportWhere(
      type,
      { endOfToday: endOfBusinessDay(options.now) },
      leaseScope(options.actor),
    ),
  });
}
