/**
 * PropertyPro - The payment report: money received in a period, and money
 * sent back
 *
 * The client asked for "a dedicated Payment Report that displays and
 * summarizes payment transactions". Its lines are the payments received in
 * the period, each on the day the money arrived, and the refunds made in the
 * period, each as its own line with the amount taken off. A payment received
 * in September and refunded in October is +X in September and −X in
 * October; read over both months it nets to nothing. It used to vanish from
 * every period once refunded, as if the money had never come in.
 *
 * The totals and every breakdown — by method, by who received the money, by
 * month, by building, by tenant, by kind of payment — are taken over all the
 * lines the filters match, not over the page on screen.
 *
 * No database here, so the arithmetic is pinned by tests.
 */

import { PaymentStatus } from "@/types";
import { businessMonth } from "@/lib/dates/business-day";
import { paymentReceiver, receivedAmount, reportMethod } from "./report-lines";
import type {
  PaymentReceiver,
  PaymentRegisterGroup,
  PaymentRegisterLineType,
  PaymentRegisterSummary,
} from "@/types/payment-report";

/** What a line is placed and added up from. */
export interface RegisterSource {
  id: string;
  status: string;
  paidDate: Date | null;
  createdAt: Date;
  updatedAt?: Date | null;
  amount: number;
  amountPaid: number | null;
  paymentMethod: string | null;
  type: string;
  propertyId: string;
  tenantId: string;
  /** Read for a refunded payment, to find when the money went back. */
  paymentHistory?: unknown;
  /** For the by-building breakdown. */
  propertyName?: string | null;
  /** For the by-tenant breakdown. */
  tenantName?: string | null;
}

/** One line of the report. */
export interface RegisterLine {
  type: PaymentRegisterLineType;
  paymentId: string;
  /** When the money came in, or went back. */
  date: Date;
  /** Positive for money received, negative for a refund. */
  amount: number;
}

/** The period, both ends inclusive. */
export interface RegisterWindow {
  start: Date;
  end: Date;
}

/** Statuses of a payment that money was received on. */
const RECEIVED: ReadonlySet<string> = new Set([
  PaymentStatus.PAID,
  PaymentStatus.PARTIAL,
  PaymentStatus.REFUNDED,
]);

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Where a history entry says when it happened. */
const ENTRY_DATE_FIELDS = ["at", "date", "timestamp", "processedAt", "createdAt"];

/**
 * When a refunded payment's money went back: its "refunded" history entry
 * (the refund dialog and the reversal write one), else the latest entry with
 * a negative amount (how older paths and gateway refunds recorded it), else
 * the last time the row changed.
 */
export function refundDate(
  payment: Pick<RegisterSource, "paymentHistory" | "updatedAt" | "paidDate" | "createdAt">,
): Date {
  const history = Array.isArray(payment.paymentHistory) ? payment.paymentHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index] as Record<string, unknown> | null;
    if (!entry || typeof entry !== "object") continue;
    const isRefund =
      entry.event === "refunded" || entry.event === "refund" || Number(entry.amount) < 0;
    if (!isRefund) continue;
    for (const field of ENTRY_DATE_FIELDS) {
      const date = asDate(entry[field]);
      if (date) return date;
    }
  }
  return (
    asDate(payment.updatedAt) ?? payment.paidDate ?? payment.createdAt
  );
}

/** The day the money arrived, as the receipt line is dated. */
export function receiptDate(payment: Pick<RegisterSource, "paidDate" | "createdAt">): Date {
  return payment.paidDate ?? payment.createdAt;
}

function within(date: Date, window: RegisterWindow): boolean {
  const time = date.getTime();
  return time >= window.start.getTime() && time <= window.end.getTime();
}

/**
 * The report's lines, newest first: a line for each payment whose money
 * arrived in the period, and a negative one for each refund made in it.
 * `receipts` are read for money received, `refunds` for money sent back; a
 * refunded payment may be in both.
 */
export function registerLines(
  receipts: readonly RegisterSource[],
  refunds: readonly RegisterSource[],
  window: RegisterWindow,
): RegisterLine[] {
  const lines: RegisterLine[] = [];
  for (const payment of receipts) {
    if (!RECEIVED.has(payment.status)) continue;
    const date = receiptDate(payment);
    if (!within(date, window)) continue;
    lines.push({
      type: "receipt",
      paymentId: payment.id,
      date,
      amount: round(receivedAmount(payment)),
    });
  }
  for (const payment of refunds) {
    if (payment.status !== PaymentStatus.REFUNDED) continue;
    const date = refundDate(payment);
    if (!within(date, window)) continue;
    lines.push({
      type: "refund",
      paymentId: payment.id,
      date,
      amount: -round(receivedAmount(payment)),
    });
  }
  // Newest first. On the same moment the refund comes first, being the later
  // of the two; then by payment, so a page boundary always falls in the same
  // place.
  return lines.sort(
    (a, b) =>
      b.date.getTime() - a.date.getTime() ||
      (a.type === b.type ? 0 : a.type === "refund" ? -1 : 1) ||
      (a.paymentId < b.paymentId ? 1 : a.paymentId > b.paymentId ? -1 : 0),
  );
}

/**
 * "2026-09" — the month a line falls in, on the office's calendar (Riyadh),
 * whatever zone the server runs in: money that arrives at 01:00 on the 1st
 * belongs to the new month, not to the old one in UTC.
 */
export function monthKey(date: Date): string {
  return businessMonth(date);
}

class GroupTotals {
  private readonly groups = new Map<string, PaymentRegisterGroup>();

  add(key: string, label: string, line: RegisterLine): void {
    const group =
      this.groups.get(key) ??
      ({ key, label, count: 0, received: 0, refunded: 0, net: 0 } satisfies PaymentRegisterGroup);
    if (line.type === "receipt") {
      group.count += 1;
      group.received = round(group.received + line.amount);
    } else {
      group.refunded = round(group.refunded - line.amount);
    }
    group.net = round(group.received - group.refunded);
    this.groups.set(key, group);
  }

  /** Largest net first; ties by label, so the order is stable. */
  byNet(): PaymentRegisterGroup[] {
    return [...this.groups.values()].sort(
      (a, b) => b.net - a.net || a.label.localeCompare(b.label),
    );
  }

  /** In key order — the months, oldest first. */
  byKey(): PaymentRegisterGroup[] {
    return [...this.groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
}

/**
 * The report's totals and breakdowns over every line. `count` is the number
 * of payments received; refunds are summed apart and taken off in `net`.
 */
export function summarizeRegister(
  lines: readonly RegisterLine[],
  sources: ReadonlyMap<string, RegisterSource>,
): PaymentRegisterSummary {
  const method = new GroupTotals();
  const receiver = new GroupTotals();
  const month = new GroupTotals();
  const building = new GroupTotals();
  const tenant = new GroupTotals();
  const type = new GroupTotals();

  let paymentCount = 0;
  let refundCount = 0;
  let totalReceived = 0;
  let totalRefunded = 0;

  for (const line of lines) {
    const payment = sources.get(line.paymentId);
    if (!payment) continue;
    if (line.type === "receipt") {
      paymentCount += 1;
      totalReceived = round(totalReceived + line.amount);
    } else {
      refundCount += 1;
      totalRefunded = round(totalRefunded - line.amount);
    }

    const methodCode = reportMethod(payment.paymentMethod);
    method.add(methodCode, methodCode, line);
    const who: PaymentReceiver = paymentReceiver(payment.paymentMethod);
    receiver.add(who, who, line);
    const monthOf = monthKey(line.date);
    month.add(monthOf, monthOf, line);
    building.add(payment.propertyId, payment.propertyName?.trim() || "—", line);
    tenant.add(payment.tenantId, payment.tenantName?.trim() || "—", line);
    type.add(payment.type, payment.type, line);
  }

  return {
    paymentCount,
    refundCount,
    totalReceived,
    totalRefunded,
    // What the office is left holding — the figure "Total collected" has
    // always meant on this report.
    totalCollected: round(totalReceived - totalRefunded),
    byMethod: method.byNet(),
    byReceiver: receiver.byNet(),
    byMonth: month.byKey(),
    byBuilding: building.byNet(),
    byTenant: tenant.byNet(),
    byType: type.byNet(),
  };
}

/** Page `page` (from 1) of `limit` lines, and how many pages there are. */
export function registerPage<T>(
  lines: readonly T[],
  page: number,
  limit: number,
): { lines: T[]; page: number; limit: number; total: number; totalPages: number } {
  const size = Math.max(1, Math.floor(limit));
  const totalPages = Math.max(1, Math.ceil(lines.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  return {
    lines: lines.slice((current - 1) * size, current * size),
    page: current,
    limit: size,
    total: lines.length,
    totalPages,
  };
}
