/**
 * PropertyPro - Keeping an entry in step with its document
 *
 * Every entry posted from a document (an installment, a payment, an expense,
 * a deposit) is the document's for as long as the document lives, and the
 * posting service is asked again whenever the document may have changed.
 * This decides what to do, given the entry the books hold now and the one
 * the document calls for:
 *
 *  - nothing held, nothing wanted            → nothing
 *  - nothing held, an entry wanted           → post it
 *  - the same entry held as is wanted        → nothing (posting is
 *                                              idempotent; the fingerprint
 *                                              says "the same")
 *  - a different entry wanted, the held one
 *    in an open period                       → replace it where it stands:
 *                                              same entry, same number
 *  - a different entry wanted, the held one
 *    in a closed period                      → reverse it in the first open
 *                                              day and post the new one
 *  - an entry held, none wanted (cancelled,
 *    deleted, refunded away)                 → reverse it — on its own day
 *                                              while that is open, else in
 *                                              the first open day
 *
 * Nothing is ever dated inside a closed period: a document dated there is
 * posted on the first open day instead.
 *
 * Pure, so the period lock and the idempotency are pinned by tests.
 */

import { firstOpenDay, isLockedDay, openDayFor } from "./dates";

export interface LiveEntry {
  id: string;
  number: number;
  date: Date;
  fingerprint: string | null;
}

export interface DesiredEntry {
  /** The day the document calls for. */
  date: Date;
  fingerprint: string;
}

export type PostingAction =
  | { kind: "noop" }
  | { kind: "create"; date: Date }
  | { kind: "replace"; entry: LiveEntry; date: Date }
  | { kind: "reverse"; entry: LiveEntry; date: Date }
  | {
      kind: "reverse_and_create";
      entry: LiveEntry;
      reverseDate: Date;
      createDate: Date;
    };

export function decidePostingAction(input: {
  live: LiveEntry | null;
  desired: DesiredEntry | null;
  closedThrough: Date | null;
}): PostingAction {
  const { live, desired, closedThrough } = input;

  if (!live && !desired) return { kind: "noop" };
  if (!live) {
    return { kind: "create", date: openDayFor(desired!.date, closedThrough) };
  }

  const liveLocked = isLockedDay(live.date, closedThrough);

  if (!desired) {
    return {
      kind: "reverse",
      entry: live,
      date: liveLocked ? firstOpenDay(closedThrough)! : live.date,
    };
  }

  if (live.fingerprint === desired.fingerprint) return { kind: "noop" };

  if (!liveLocked) {
    return {
      kind: "replace",
      entry: live,
      date: openDayFor(desired.date, closedThrough),
    };
  }

  return {
    kind: "reverse_and_create",
    entry: live,
    reverseDate: firstOpenDay(closedThrough)!,
    createDate: openDayFor(desired.date, closedThrough),
  };
}

/** How many new journal numbers an action takes. */
export function numbersNeeded(action: PostingAction): number {
  switch (action.kind) {
    case "create":
    case "reverse":
      return 1;
    case "reverse_and_create":
      return 2;
    default:
      return 0;
  }
}
