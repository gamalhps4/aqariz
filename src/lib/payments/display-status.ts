/**
 * PropertyPro - What a payment's status actually reads as
 *
 * The stored `status` is a lifecycle value — pending, paid, failed. It is not
 * what the office needs to see, and showing it raw was the bug the review
 * reported: a payment three weeks past its due date still displayed "Pending",
 * because nothing had relabelled it yet. A tenant chasing that payment is
 * being told one thing while the screen says another.
 *
 * The scope names four states — Paid, Due, Overdue, Upcoming — and every one
 * of them is a function of the stored status AND the due date together. So the
 * display status is derived here, once, and both the payments list and the
 * contract's installment schedule read it, which is what keeps the two screens
 * from disagreeing about the same money.
 */

import {
  addBusinessDays,
  businessDay,
  businessDayStart,
  businessDaysOverdue,
  businessToday,
  isPastDue,
} from "@/lib/dates/business-day";
import { PaymentStatus } from "@/types";

export type PaymentDisplayStatus =
  | "paid"
  | "partial"
  | "overdue"
  | "due"
  | "upcoming"
  | "refunded"
  | "failed"
  | "cancelled";

export interface PaymentDisplayInput {
  status: string;
  dueDate: string | Date | null | undefined;
  /** Present for a partial payment; absent is treated as nothing received. */
  amountPaid?: number | null;
  amount?: number | null;
}

/**
 * Terminal states, in the sense that the due date no longer says anything
 * about them: money that has arrived, been sent back, or been written off is
 * not "overdue" however old the invoice is.
 */
const TERMINAL: Record<string, PaymentDisplayStatus> = {
  [PaymentStatus.PAID]: "paid",
  [PaymentStatus.REFUNDED]: "refunded",
  [PaymentStatus.CANCELLED]: "cancelled",
};

export function paymentDisplayStatus(
  payment: PaymentDisplayInput,
  now: Date = new Date(),
): PaymentDisplayStatus {
  const terminal = TERMINAL[payment.status];
  if (terminal) return terminal;

  // A failed charge is a fact about the attempt, not about the calendar, and
  // it needs its own colour so nobody reads it as merely late.
  if (payment.status === PaymentStatus.FAILED) return "failed";

  const due = payment.dueDate ? new Date(payment.dueDate) : null;
  const hasDue = due !== null && Number.isFinite(due.getTime());

  // Due dates are calendar days stored at midnight, so a payment is only late
  // once its due day has fully passed — on Riyadh's clock, which is the same
  // moment on the server and in the browser — otherwise rent shows as overdue
  // on the morning it falls due.
  const isLate = hasDue && isPastDue(due, now);

  const paid = Number(payment.amountPaid ?? 0);
  const asked = Number(payment.amount ?? 0);
  const partlyPaid = paid > 0 && (asked === 0 || paid < asked);

  if (isLate) return partlyPaid ? "partial" : "overdue";
  if (partlyPaid) return "partial";

  if (!hasDue) return "due";

  // Due today counts as due, not upcoming: it is actionable now.
  return businessDay(due) <= businessToday(now) ? "due" : "upcoming";
}

/** Whole days a payment is past due; 0 when it is not late. */
export function daysOverdue(
  payment: PaymentDisplayInput,
  now: Date = new Date(),
): number {
  const state = paymentDisplayStatus(payment, now);
  if (state !== "overdue" && state !== "partial") return 0;
  if (!payment.dueDate) return 0;

  const due = new Date(payment.dueDate);
  if (!Number.isFinite(due.getTime())) return 0;

  // Calendar days: 1 from the first minute after the due day, 2 the day
  // after, whatever hour it is asked.
  return businessDaysOverdue(due, now);
}

/**
 * Every state the badge can show, in the order the list's status filter
 * offers them: what needs chasing first, then what is settled.
 */
export const PAYMENT_DISPLAY_STATUSES: readonly PaymentDisplayStatus[] = [
  "overdue",
  "due",
  "upcoming",
  "partial",
  "paid",
  "failed",
  "refunded",
  "cancelled",
];

export function isPaymentDisplayStatus(
  value: unknown,
): value is PaymentDisplayStatus {
  return (
    typeof value === "string" &&
    (PAYMENT_DISPLAY_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * The rows `paymentDisplayStatus` gives a state, as a query fragment.
 *
 * The status filter used to send stored statuses — Pending twice, once
 * labelled "Processing" — while the badges read the due date as well, so
 * picking a status could list rows whose badge said something else. This is
 * the same rule turned round, so a filter and the badges it lists agree.
 *
 * Stored OVERDUE and PARTIAL are lifecycle labels like PENDING: the badge
 * decides from the money and the calendar, and so does this. Assumes what the
 * recording paths guarantee — money on a row never exceeds its amount, since
 * the full amount settles it as PAID.
 */
export function displayStatusWhere(
  state: PaymentDisplayStatus,
  now: Date = new Date(),
): Record<string, unknown> {
  // The bounds are Riyadh's midnights, which is where a due day (stored at
  // midnight UTC) is first late or first due — see the badge rule above.
  const today = businessToday(now);
  const startOfToday = businessDayStart(today);
  const startOfTomorrow = businessDayStart(addBusinessDays(today, 1));

  const open = {
    in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE, PaymentStatus.PARTIAL],
  };
  const nothingPaid = { lte: 0 };

  switch (state) {
    case "paid":
      return { status: PaymentStatus.PAID };
    case "refunded":
      return { status: PaymentStatus.REFUNDED };
    case "cancelled":
      return { status: PaymentStatus.CANCELLED };
    case "failed":
      return { status: PaymentStatus.FAILED };
    case "partial":
      return { status: open, amountPaid: { gt: 0 } };
    case "overdue":
      return {
        status: open,
        amountPaid: nothingPaid,
        dueDate: { lt: startOfToday },
      };
    case "due":
      return {
        status: open,
        amountPaid: nothingPaid,
        dueDate: { gte: startOfToday, lt: startOfTomorrow },
      };
    case "upcoming":
      return {
        status: open,
        amountPaid: nothingPaid,
        dueDate: { gte: startOfTomorrow },
      };
  }
}

/** Translation key and English fallback for each state. */
export const PAYMENT_STATUS_LABELS: Record<
  PaymentDisplayStatus,
  { key: string; fallback: string }
> = {
  paid: { key: "payments.status.paid", fallback: "Paid" },
  partial: { key: "payments.status.partial", fallback: "Partly paid" },
  overdue: { key: "payments.status.overdue", fallback: "Overdue" },
  due: { key: "payments.status.due", fallback: "Due" },
  upcoming: { key: "payments.status.upcoming", fallback: "Upcoming" },
  refunded: { key: "payments.status.refunded", fallback: "Refunded" },
  failed: { key: "payments.status.failed", fallback: "Failed" },
  cancelled: { key: "payments.status.cancelled", fallback: "Cancelled" },
};

/** Badge styling per state, matching the installment schedule's palette. */
export const PAYMENT_STATUS_STYLES: Record<PaymentDisplayStatus, string> = {
  paid: "bg-success/10 text-success border-success/20",
  partial: "bg-info/10 text-info border-info/20",
  overdue: "bg-error/10 text-error border-error/20",
  due: "bg-warning/10 text-warning border-warning/20",
  upcoming: "bg-muted text-muted-foreground border-muted",
  refunded: "bg-muted text-muted-foreground border-muted",
  failed: "bg-error/10 text-error border-error/20",
  cancelled: "bg-muted text-muted-foreground border-muted line-through",
};
