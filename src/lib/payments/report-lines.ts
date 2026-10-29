/**
 * PropertyPro - A payment as the reports show it
 *
 * The client review, item 11: "In arrears or any financial reports, each
 * payment should appear separately, with the payment date clearly shown."
 * The arrears registers are lists of installments, so each installment now
 * carries the payments applied to it, and the collections list says which
 * installment each payment paid, who received the money and who recorded it.
 *
 * No database here, so how a payment is read is pinned by tests.
 */

import { PaymentStatus } from "@/types";
import { isReceivedByOwner } from "./methods";
import { formatPaymentNumber } from "./receipt-number";
import {
  isOnlinePayment,
  PAYMENT_RECORDER_SELECT,
  recorderName,
  type PaymentRecorderFields,
} from "./recorder";
import type {
  InstallmentPayment,
  PaymentReceiver,
  ReceivableRow,
} from "@/types/payment-report";

/** What a report line reads from a payment row. */
export interface ReportPaymentSource extends PaymentRecorderFields {
  id: string;
  /**
   * The payment number. Selected only once the database has the column —
   * spread `REPORT_PAYMENT_SELECT` with `number: await
   * paymentNumbersAvailable()`.
   */
  number?: number | null;
  status: string;
  paidDate: Date | null;
  createdAt: Date;
  amount: number;
  amountPaid: number | null;
  paymentMethod: string | null;
  allocations?: unknown;
  paymentHistory?: unknown;
}

/**
 * What a query selects for a payment to be shown as a report line — plus
 * `number`, which the caller adds when the database has it (see
 * lib/payments/payment-number.ts).
 */
export const REPORT_PAYMENT_SELECT = {
  id: true,
  status: true,
  paidDate: true,
  createdAt: true,
  amount: true,
  amountPaid: true,
  paymentMethod: true,
  allocations: true,
  paymentHistory: true,
  stripePaymentIntentId: true,
  stripeCheckoutSessionId: true,
  paypalCaptureId: true,
  razorpayPaymentId: true,
  paystackReference: true,
  recordedBy: { select: PAYMENT_RECORDER_SELECT },
} as const;

/**
 * Money actually received — the statuses the collections report counts. An
 * installment can list a charge nobody has paid yet (the demo data links
 * each installment's scheduled payment row to it), and that is not a payment.
 */
const RECEIVED_STATUSES: ReadonlySet<string> = new Set([
  PaymentStatus.PAID,
  PaymentStatus.PARTIAL,
]);

/** The method column's value; the collections report groups on it too. */
export function reportMethod(method: string | null | undefined): string {
  return method || "unspecified";
}

/**
 * What a payment actually brought in: `amountPaid`, or `amount` on an older
 * row that never had the column filled. The payments-received register, the
 * by-building roll-up and the dashboard's revenue all add money up this one
 * way, so the three cannot disagree about the same payments.
 */
export function receivedAmount(payment: {
  amount: number;
  amountPaid: number | null;
}): number {
  return payment.amountPaid || payment.amount;
}

interface HistoryEntry {
  amount?: unknown;
  reference?: unknown;
  transactionId?: unknown;
}

/** The latest history entry's non-empty `field`, among those `keep` accepts. */
function latestInHistory(
  history: readonly unknown[],
  field: "reference" | "transactionId",
  keep: (entry: HistoryEntry) => boolean = () => true,
): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] as HistoryEntry | null;
    const value = entry?.[field];
    if (entry && typeof value === "string" && value.trim() && keep(entry)) {
      return value.trim();
    }
  }
  return null;
}

/**
 * The reference that proves a payment, in order of trust:
 *
 * 1. what the office typed when it recorded the money against the
 *    installment — a transfer number, a cheque number, an Ejar receipt. It
 *    lives in the payment's history; the latest one wins, as on the
 *    contract's Payments tab;
 * 2. the gateway's own reference, for a payment taken online — any
 *    gateway's (selected with lib/payments/gateway-columns.ts), else
 *    Stripe's or PayPal's own column on an older row;
 * 3. the transaction id an older recording path, or the demo data, wrote
 *    into the history instead. A refund's entry (a negative amount) carries
 *    the refund's id, not the payment's, so it is passed over.
 */
export function paymentReference(
  payment: Pick<
    ReportPaymentSource,
    | "paymentHistory"
    | "stripePaymentIntentId"
    | "paypalCaptureId"
    | "razorpayPaymentId"
    | "paystackReference"
  > & { gatewayPaymentId?: string | null },
): string | null {
  const history = Array.isArray(payment.paymentHistory)
    ? payment.paymentHistory
    : [];
  return (
    latestInHistory(history, "reference") ||
    payment.gatewayPaymentId ||
    payment.stripePaymentIntentId ||
    payment.paypalCaptureId ||
    payment.razorpayPaymentId ||
    payment.paystackReference ||
    latestInHistory(history, "transactionId", (entry) => !(Number(entry.amount) < 0)) ||
    null
  );
}

/** Who received the money — see OWNER_RECEIVED_METHODS. */
export function paymentReceiver(
  method: string | null | undefined,
): PaymentReceiver {
  return isReceivedByOwner(method) ? "owner" : "office";
}

/**
 * What a payment put on one installment. A payment spread over several
 * installments records an allocation for each, and only this one's share
 * belongs under it; otherwise the payment paid this installment alone. The
 * receipt reads the amount applied the same way.
 */
function amountOnInstallment(
  payment: ReportPaymentSource,
  invoiceId: string,
): number {
  const allocations = Array.isArray(payment.allocations)
    ? payment.allocations
    : [];
  const share = allocations.find(
    (entry) =>
      String((entry as { invoiceId?: unknown } | null)?.invoiceId) ===
      invoiceId,
  ) as { amount?: unknown } | undefined;
  const allocated = Number(share?.amount);
  if (share && Number.isFinite(allocated)) return allocated;
  return payment.amountPaid || payment.amount;
}

/**
 * The payments applied to one installment, oldest first.
 *
 * Read from the installment's own `paymentIds` — the list the invoice page
 * and the receipt read, and the one deleting or refunding a payment takes it
 * back off — so the lines add up to what the installment says is paid. An id
 * with no live payment behind it is skipped, and so is a charge nobody has
 * paid yet (see RECEIVED_STATUSES).
 */
export function installmentPayments(
  invoice: { id: string; paymentIds?: readonly string[] | null },
  paymentsById: ReadonlyMap<string, ReportPaymentSource>,
): InstallmentPayment[] {
  const lines: InstallmentPayment[] = [];
  for (const paymentId of new Set(invoice.paymentIds ?? [])) {
    const payment = paymentsById.get(paymentId);
    if (!payment || !RECEIVED_STATUSES.has(payment.status)) continue;
    lines.push({
      paymentId: payment.id,
      paymentNumber: formatPaymentNumber(payment.number),
      paidDate: (payment.paidDate ?? payment.createdAt).toISOString(),
      amount: amountOnInstallment(payment, invoice.id),
      method: reportMethod(payment.paymentMethod),
      reference: paymentReference(payment),
      recordedBy: recorderName(payment),
      online: isOnlinePayment(payment),
    });
  }
  // ISO strings in one zone sort as dates; ties keep the order applied.
  return lines.sort((a, b) =>
    a.paidDate < b.paidDate ? -1 : a.paidDate > b.paidDate ? 1 : 0,
  );
}

/**
 * When the installment was last paid: the latest payment's own date.
 *
 * `Invoice.lastPaymentDate` is stamped with the moment the payment was
 * applied, so a transfer recorded a week after it landed would read a week
 * late. It is only the fallback, for money on the installment that no listed
 * payment accounts for — and only while there is money on it, because
 * taking a payment back off leaves the stamp behind.
 */
export function lastPaymentDate(
  lines: readonly InstallmentPayment[],
  invoice: { amountPaid: number; lastPaymentDate: Date | null },
): string | null {
  if (lines.length > 0) {
    return lines.reduce(
      (latest, line) => (line.paidDate > latest ? line.paidDate : latest),
      lines[0].paidDate,
    );
  }
  return invoice.amountPaid > 0 && invoice.lastPaymentDate
    ? invoice.lastPaymentDate.toISOString()
    : null;
}

/** What `installmentAsAt` reads from an installment. */
export interface InstallmentBalanceSource {
  amountPaid: number;
  balanceRemaining: number;
  lastPaymentDate: Date | null;
}

/** An installment's money as it stood at a moment. */
export interface InstallmentAsAt {
  amountPaid: number;
  balance: number;
  /** The payments made by that moment, oldest first. */
  payments: InstallmentPayment[];
  lastPaymentDate: string | null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * An installment as it stood at a moment — the "as at" of the arrears
 * registers.
 *
 * An installment only records what it holds now. Read as at a date already
 * past, that made the registers a list of today's arrears with an old date
 * on top: an installment paid off last week had vanished from a report about
 * last month, and a part payment made since had already shrunk what was owed
 * then. So every payment dated after the moment is taken back off, and what
 * is left is what was owed at that moment.
 *
 * Money on the installment that none of its listed payments accounts for
 * (older rows, written before payments were listed) is judged by when it was
 * applied. Nothing is ever taken back beyond what the installment holds.
 *
 * `at` null reads the installment as it is now.
 */
export function installmentAsAt(
  invoice: InstallmentBalanceSource,
  lines: readonly InstallmentPayment[],
  at: Date | null,
): InstallmentAsAt {
  if (!at) {
    return {
      amountPaid: invoice.amountPaid,
      balance: invoice.balanceRemaining,
      payments: [...lines],
      lastPaymentDate: lastPaymentDate(lines, invoice),
    };
  }

  const cutoff = at.getTime();
  const madeBy = (line: InstallmentPayment) =>
    new Date(line.paidDate).getTime() <= cutoff;
  const made = lines.filter(madeBy);
  const sum = (entries: readonly InstallmentPayment[]) =>
    entries.reduce((total, line) => total + line.amount, 0);

  let since = sum(lines.filter((line) => !madeBy(line)));
  const unlisted = invoice.amountPaid - sum(lines);
  const stampedAfter =
    invoice.lastPaymentDate !== null &&
    invoice.lastPaymentDate.getTime() > cutoff;
  if (unlisted > 0.005 && stampedAfter) since += unlisted;
  since = Math.min(Math.max(since, 0), Math.max(invoice.amountPaid, 0));

  const amountPaid = round(invoice.amountPaid - since);
  return {
    amountPaid,
    balance: round(invoice.balanceRemaining + since),
    payments: made,
    lastPaymentDate: lastPaymentDate(made, {
      amountPaid,
      lastPaymentDate: stampedAfter ? null : invoice.lastPaymentDate,
    }),
  };
}

/** An installment row, or one of its payments directly beneath it. */
export interface ReceivableLine<T = ReceivableRow> {
  installment: T;
  payment?: InstallmentPayment;
}

/**
 * A register flattened for a spreadsheet: each installment, then one row
 * per payment on it. The export fills a payment row with who and which
 * installment, so a filtered or sorted sheet still says what it belongs to,
 * and leaves the installment's money blank, so a column still adds up.
 */
export function receivableLines<
  T extends { payments: readonly InstallmentPayment[] },
>(rows: readonly T[]): ReceivableLine<T>[] {
  return rows.flatMap((installment) => [
    { installment },
    ...installment.payments.map((payment) => ({ installment, payment })),
  ]);
}
