/**
 * PropertyPro - The order the payments list is read in
 *
 * The client asked for every column header to sort its table. The Payments
 * page is paged on the server, so a header click has to change the query's
 * order: sorting the twelve rows on screen would look like the whole list
 * was sorted when it was not. GET /api/payments takes `sortBy`/`sortOrder`
 * and reads them through here — only the columns named below, so nothing
 * from the query string reaches Prisma's orderBy unchecked.
 *
 * Without a `sortBy` (or with one not listed) there is no chosen order and
 * the route keeps the one it has always had: the list newest written first,
 * the export by due date.
 *
 * Pure: the route and its test import it.
 */

import type { Prisma } from "@/generated/prisma/client";

/** What `sortBy` may name: the columns the Payments table shows. */
export const PAYMENT_SORT_FIELDS = [
  "dueDate",
  "paidDate",
  "amount",
  "status",
  "createdAt",
  "paymentNumber",
] as const;

export type PaymentSortField = (typeof PAYMENT_SORT_FIELDS)[number];

export function isPaymentSortField(value: unknown): value is PaymentSortField {
  return (PAYMENT_SORT_FIELDS as readonly unknown[]).includes(value);
}

type OrderBy = Prisma.PaymentOrderByWithRelationInput;

/** The order a header click asked for, or null when none was (or may be). */
export function chosenPaymentOrder(
  sortBy: string | null | undefined,
  sortOrder: string | null | undefined,
  options: {
    /** Whether the database has payment numbers yet (paymentNumbersAvailable). */
    withNumber: boolean;
  },
): OrderBy[] | null {
  if (!isPaymentSortField(sortBy)) return null;
  // The number column is left out of reads until its migration has run
  // (prisma.ts); ordering by it then would fail the whole list.
  if (sortBy === "paymentNumber" && !options.withNumber) return null;

  const direction: Prisma.SortOrder = sortOrder === "asc" ? "asc" : "desc";
  // A charge nobody has paid has no paid date and no number: those rows go
  // last both ways, as an empty cell does in every other table's sort.
  const columns: Record<PaymentSortField, OrderBy> = {
    dueDate: { dueDate: direction },
    paidDate: { paidDate: { sort: direction, nulls: "last" } },
    amount: { amount: direction },
    status: { status: direction },
    createdAt: { createdAt: direction },
    paymentNumber: { number: { sort: direction, nulls: "last" } },
  };
  // The stored status is a lifecycle value (pending, paid…), not the badge,
  // which also reads the due date: within one status, the due date orders
  // the rows, so pending ones run overdue, due, upcoming.
  const within: OrderBy[] = sortBy === "status" ? [{ dueDate: direction }] : [];
  // The id last, so a page boundary never falls between equal values
  // differently from one request to the next.
  return [columns[sortBy], ...within, { id: "asc" }];
}
