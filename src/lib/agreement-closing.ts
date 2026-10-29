/**
 * PropertyPro - The day an agreement closed
 *
 * An agreement earns for its term: from its start date to its end date, or to
 * the day it was terminated where that came first (`agreementTerm` in
 * lib/agreement-math.ts). One marked expired or terminated with neither date
 * on record is over without anything saying since when — and earns nothing
 * at all, not even for the months it was in force.
 *
 * Closing an agreement recorded a date on one path only: an edit to
 * "terminated". Marking it expired, creating it already closed, and archiving
 * it (which terminates it) left it with none. Every path that closes one now
 * asks this for the date to record. Pure, so agreement-closing.test.ts pins it.
 */

export const CLOSED_AGREEMENT_STATUSES = ["expired", "terminated"] as const;

export function isClosedAgreementStatus(status: string | null | undefined): boolean {
  return CLOSED_AGREEMENT_STATUSES.some((closed) => closed === status);
}

/** What says when an agreement stopped being in force. */
export interface ClosingFacts {
  status: string;
  endDate: Date | null;
  terminatedDate: Date | null;
}

/**
 * The termination date to record for an agreement in `status`, or null when
 * nothing needs recording:
 *
 *   - not closed, or a termination date already on record: nothing;
 *   - expired on or after its end date: nothing — it ran its term, and the
 *     end date says when;
 *   - otherwise — terminated, or closed before its end date, or with no end
 *     date at all — the day it was closed.
 */
export function closingDate(agreement: ClosingFacts, now: Date): Date | null {
  if (!isClosedAgreementStatus(agreement.status)) return null;
  if (agreement.terminatedDate) return null;
  if (
    agreement.status === "expired" &&
    agreement.endDate &&
    agreement.endDate.getTime() <= now.getTime()
  ) {
    return null;
  }
  return now;
}
