/**
 * PropertyPro - An expense as an activity entry holds it
 *
 * The expense service answers with the row as the screens read it: the
 * building as `{ id, name }` in place of its id, the supplier as `{ name }`.
 * The entry keeps the names, not the ids, and only the fields an office is
 * asked about — what it was for, how much, when, to whom, on which building,
 * paid how, and where it stands. The receipt's address, the recurrence
 * settings and the books' own columns stay out.
 *
 * Pure: no database, nothing server-only.
 */

import {
  clip,
  dateOf,
  numberOf,
  type Row,
} from "./shared";

/** The fields compared when an expense is edited. */
export const EXPENSE_CHANGE_KEYS = [
  "expenseNumber",
  "category",
  "description",
  "amount",
  "date",
  "supplierName",
  "supplierInvoiceNumber",
  "propertyName",
  "paymentMethod",
  "referenceNumber",
  "status",
  "vatAmount",
  "taxDeductible",
  "isRecurring",
  "notes",
] as const;

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildingName(row: Row): string | null {
  const building = row.propertyId ?? row.property;
  if (building && typeof building === "object") {
    return textOf((building as { name?: unknown }).name);
  }
  return null;
}

function supplierName(row: Row): string | null {
  const supplier = row.supplier;
  if (supplier && typeof supplier === "object") {
    return textOf((supplier as { name?: unknown }).name);
  }
  return null;
}

/**
 * The expense as an entry stores it. Every field is always present (null when
 * the row has no value), so a before and an after built the same way compare
 * field for field. `status: false` leaves the status out — a deleted expense's
 * row already reads "cancelled", which is not what it was.
 */
export function expenseSnapshot(
  row: Row | null | undefined,
  options: { status?: boolean } = {},
): Row {
  if (!row) return {};
  const snapshot: Row = {
    expenseNumber: textOf(row.expenseNumber),
    category: textOf(row.category),
    description: clip(row.description, 200),
    amount: numberOf(row.amount),
    date: dateOf(row.date),
    supplierName: supplierName(row),
    supplierInvoiceNumber: textOf(row.supplierInvoiceNumber),
    propertyName: buildingName(row),
    paymentMethod: textOf(row.paymentMethod),
    referenceNumber: textOf(row.referenceNumber),
    status: textOf(row.status),
    vatAmount: numberOf(row.vatAmount),
    taxDeductible: typeof row.taxDeductible === "boolean" ? row.taxDeductible : null,
    isRecurring: typeof row.isRecurring === "boolean" ? row.isRecurring : null,
    notes: clip(row.notes, 300),
  };
  if (options.status === false) delete snapshot.status;
  return snapshot;
}

/** What a reader knows an expense by: its number, else what it was for. */
export function expenseName(row: Row | null | undefined): string | null {
  if (!row) return null;
  return textOf(row.expenseNumber) ?? clip(row.description, 80);
}
