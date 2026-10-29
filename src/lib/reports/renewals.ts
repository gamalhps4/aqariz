/**
 * PropertyPro - A renewed contract and the one that took over
 *
 * The renewed register listed the old contracts and nothing else: no column
 * or link for the new contract, a date filter that read the OLD contract's
 * end date under a label saying "renewed", and a "days since end" that went
 * negative for every contract renewed before its term was out.
 *
 * Renewing writes the link both ways — the old contract's `renewedLeaseId`,
 * the new one's `parentLeaseId` — but neither is a relation a query can
 * follow, so the successors are read separately and matched here. The day a
 * renewal was made is the day its successor was created.
 *
 * No database here, so the matching is pinned by renewals.test.ts.
 */

import { businessDay, businessDayEnd } from "@/lib/dates/business-day";

export interface RenewedContract {
  id: string;
  renewedLeaseId: string | null;
}

export interface SuccessorContract {
  id: string;
  parentLeaseId: string | null;
  contractNumber: string | null;
  startDate: Date;
  endDate: Date;
  status: string;
  createdAt: Date;
}

/** The contract that took over, as the register shows it. */
export interface RenewalInfo {
  leaseId: string;
  contractNumber: string | null;
  startDate: string;
  endDate: string;
  status: string;
  /** The day the renewal was made — when the new contract was created. */
  renewedOn: string;
}

/**
 * The contract that took over from `lease`: the one it names, else one that
 * names it back. Null for a contract marked renewed with neither link — an
 * older row, or one whose successor has since been deleted.
 */
export function successorOf(
  lease: RenewedContract,
  successors: readonly SuccessorContract[],
): SuccessorContract | null {
  if (lease.renewedLeaseId) {
    const named = successors.find(
      (successor) => successor.id === lease.renewedLeaseId,
    );
    if (named) return named;
  }
  const naming = successors
    .filter((successor) => successor.parentLeaseId === lease.id)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return naming[0] ?? null;
}

export function renewalInfo(successor: SuccessorContract | null): RenewalInfo | null {
  if (!successor) return null;
  return {
    leaseId: successor.id,
    contractNumber: successor.contractNumber,
    startDate: successor.startDate.toISOString(),
    endDate: successor.endDate.toISOString(),
    status: successor.status,
    renewedOn: successor.createdAt.toISOString(),
  };
}

/**
 * Whether a renewal made on `renewedOn` falls inside the date filter —
 * inclusive of the whole `to` day on the office's calendar, as every
 * register's filter is. With a filter set, a renewal whose date is not known
 * cannot be placed in it.
 */
export function renewedWithin(
  renewedOn: Date | null,
  from?: Date,
  to?: Date,
): boolean {
  if (!from && !to) return true;
  if (!renewedOn) return false;
  if (from && renewedOn < from) return false;
  if (to && renewedOn > businessDayEnd(businessDay(to))) return false;
  return true;
}
