/**
 * PropertyPro - Reading the purchases tables
 *
 * Migration 20261004190000_purchases adds the bill, voucher and reconciliation
 * tables, gives suppliers their contact, bank details and payment terms, and
 * lets the ledger take the two new source types. The client leaves the new
 * supplier columns out of every read (src/lib/db/prisma.ts), so a page that
 * does not show them works whether or not the migration has been applied; the
 * purchases screens ask for them here.
 *
 * Before the migration there is nothing to read and nothing to write: the
 * routes answer with a clear message instead of failing on a missing table,
 * and the sweep skips bills and vouchers. The answer is remembered once the
 * migration is there; while it is missing it is asked again every minute, so
 * applying it needs no restart.
 */

import "server-only";

import { db } from "@/lib/db/prisma";

const RECHECK_MISSING_MS = 60_000;

let present = false;
let checkedAt = 0;

/** Whether the database has the purchases migration yet. */
export async function purchasesAvailable(): Promise<boolean> {
  if (present) return true;
  if (checkedAt && Date.now() - checkedAt < RECHECK_MISSING_MS) return false;
  try {
    const rows = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT (
        SELECT COUNT(*) FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name IN (
             'purchase_bills', 'purchase_bill_lines', 'payment_vouchers',
             'payment_voucher_allocations', 'purchase_counters', 'bank_reconciled_lines'
           )
      ) = 6
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'suppliers'
           AND column_name = 'paymentTermsDays'
      )
      AND COALESCE((
        SELECT bool_or(pg_get_constraintdef(c.oid) LIKE '%purchase_bill%')
          FROM pg_constraint c
         WHERE c.conname = 'journal_entries_source_type_check'
      ), FALSE) AS present`;
    present = Boolean(rows[0]?.present);
  } catch {
    present = false;
  }
  checkedAt = Date.now();
  return present;
}

/** What a write that needs the migration answers before it is applied. */
export const PURCHASES_MISSING_MESSAGE =
  "Purchases and payments need a database update that has not been applied yet.";

export const SUPPLIER_PURCHASE_COLUMNS = [
  "contactName",
  "email",
  "address",
  "city",
  "crNumber",
  "bankName",
  "iban",
  "paymentTermsDays",
  "notes",
] as const;

type OmitOf<K extends string> = { [P in K]: boolean };

/**
 * The `omit` that brings the new supplier columns into a read — or keeps them
 * out while the database does not have them.
 */
export async function supplierPurchasesOmit(): Promise<OmitOf<(typeof SUPPLIER_PURCHASE_COLUMNS)[number]>> {
  const hide = !(await purchasesAvailable());
  return Object.fromEntries(SUPPLIER_PURCHASE_COLUMNS.map((column) => [column, hide])) as OmitOf<
    (typeof SUPPLIER_PURCHASE_COLUMNS)[number]
  >;
}
