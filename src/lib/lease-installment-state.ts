/**
 * PropertyPro - What state an installment is in
 *
 * Pure classification, deliberately kept out of
 * `services/lease-installments.service.ts`: deciding whether a row reads
 * "overdue" or "partly paid" needs a due date, a balance and a clock, and
 * nothing else. Wedged inside the service it could only be exercised by
 * standing up Prisma, so the one rule the review actually specifies —
 * "Upcoming, Due, Overdue, Paid, or Partially Paid" — had no test.
 *
 * The service imports these; it owns the queries, this owns the judgement.
 */

import {
  addBusinessDays,
  businessDay,
  businessToday,
  isPastDue,
} from "@/lib/dates/business-day";
import { InvoiceStatus } from "@/types";

/** Only the invoice fields the classification actually reads. */
export interface InstallmentStateInput {
  status: string;
  dueDate: Date;
  amountPaid: number;
  balanceRemaining: number;
}

export type InstallmentState =
  | "paid"
  | "partial"
  | "overdue"
  | "due"
  | "upcoming"
  | "cancelled"
  | "planned";

/**
 * How far ahead an installment reads "Due" rather than "Upcoming".
 *
 * A week: the same lead the invoice generator gives an installment before its
 * due date. Earlier than that it is simply coming up.
 */
export const DUE_WINDOW_DAYS = 7;

/**
 * Classify an invoice as an installment state.
 *
 * The invoice's own `status` is authoritative for cancelled only. Everything
 * else is read from the money and the calendar, because stored statuses
 * refresh only when something touches the row — and because "issued" is not
 * "due": the contract form issues every installment the day the contract is
 * signed, so a schedule read off the stored status showed eleven months of
 * future rent as due at once. The review names the statuses it wants —
 * "Upcoming, Due, Overdue, Paid, or Partially Paid" — and they are all
 * questions about dates.
 *
 * Partly paid is reported *ahead of* overdue. Money almost always arrives
 * against an installment after its due date, so testing overdue first hid
 * "Partially Paid" in the one case it exists for — a row with 400 of 1,000
 * collected looked identical to one with nothing paid. The overdue totals do
 * not read this field (see `isOverdue`), so nothing leaves the collections
 * figures by being labelled this way.
 */
export function classifyInstallment(
  invoice: InstallmentStateInput,
  now: Date,
): InstallmentState {
  // The enum, never the literal: its values are lowercase, and a
  // hand-written "CANCELLED" here would never match while compiling
  // cleanly, because `status` is a plain string.
  if (invoice.status === InvoiceStatus.CANCELLED) return "cancelled";
  if (invoice.balanceRemaining <= 0) return "paid";
  if (invoice.amountPaid > 0) return "partial";
  if (isPastDue(invoice.dueDate, now)) return "overdue";
  return isWithinDueWindow(invoice.dueDate, now) ? "due" : "upcoming";
}

/** Falls due today or within the next `DUE_WINDOW_DAYS` days. */
function isWithinDueWindow(dueDate: Date, now: Date): boolean {
  return (
    businessDay(dueDate) <=
    addBusinessDays(businessToday(now), DUE_WINDOW_DAYS)
  );
}

/** The whole day an installment fell due is over. */
export function isPastDueDate(dueDate: string | Date, now: Date): boolean {
  return isPastDue(dueDate, now);
}

/**
 * Past its due date and still owing, whatever the badge calls it.
 *
 * The collections figures ask this rather than reading the state, so a part
 * paid installment still carries its unpaid remainder into the overdue total
 * instead of vanishing from it because of how it is labelled.
 *
 * A planned installment is never overdue, however old its date. It is not a
 * bill yet — nothing has been invoiced, so nothing is owed — and the Due and
 * Overdue registers, which read invoices, never list it. Counting it here
 * made the contract's own overdue figure disagree with those reports; once it
 * is billed it is late in both, by the same date.
 */
export function isOverdue(
  row: { dueDate: string | Date; balanceRemaining: number; state: InstallmentState },
  now: Date,
): boolean {
  if (row.state === "cancelled" || row.state === "planned") return false;
  if (row.balanceRemaining <= 0) return false;
  return isPastDueDate(row.dueDate, now);
}
