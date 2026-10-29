/**
 * PropertyPro - Reading accounting phase 0's columns
 *
 * Migration 20261004121500_accounting_phase0 gives invoices their customer,
 * credit-note and line columns, expenses their VAT and supplier, and adds the
 * invoice_lines and suppliers tables. The client leaves the new invoice and
 * expense columns out of every read (src/lib/db/prisma.ts), so a page that
 * does not show them works whether or not the migration has been applied; the
 * screens that do show them ask for them here first.
 *
 * Before the migration they get none of it — an invoice reads as a tenant's,
 * an expense without VAT — and writing a custom invoice, a credit note or a
 * supplier is refused with a clear message instead of failing on a missing
 * column. The answer is remembered once the migration is there; while it is
 * missing it is asked again every minute, so applying it needs no restart.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import type { Expense, Invoice } from "@/generated/prisma/client";

const RECHECK_MISSING_MS = 60_000;

let present = false;
let checkedAt = 0;

/** Whether the database has accounting phase 0's tables and columns yet. */
export async function accountingPhase0Available(): Promise<boolean> {
  if (present) return true;
  if (checkedAt && Date.now() - checkedAt < RECHECK_MISSING_MS) return false;
  try {
    const rows = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'invoices'
           AND column_name = 'documentType'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name = 'invoice_lines'
      ) AS present`;
    present = Boolean(rows[0]?.present);
  } catch {
    present = false;
  }
  checkedAt = Date.now();
  return present;
}

/** What a write that needs the migration answers before it is applied. */
export const PHASE0_MISSING_MESSAGE =
  "Custom invoices, credit notes, expense VAT and suppliers need a database update that has not been applied yet.";

export const INVOICE_PHASE0_COLUMNS = [
  "documentType",
  "originalInvoiceId",
  "creditedAmount",
  "customerType",
  "customerUserId",
  "customerName",
  "customerVatNumber",
  "customerAddress",
] as const;

export const EXPENSE_PHASE0_COLUMNS = [
  "vatAmount",
  "vatCategory",
  "supplierId",
  "supplierInvoiceNumber",
] as const;

/** An invoice as a read returns it when it does not ask for the new columns. */
export type InvoiceReadModel = Omit<Invoice, (typeof INVOICE_PHASE0_COLUMNS)[number]>;

/** The same for an expense. */
export type ExpenseReadModel = Omit<Expense, (typeof EXPENSE_PHASE0_COLUMNS)[number]>;

type OmitOf<K extends string> = { [P in K]: boolean };

/**
 * The `omit` that brings the new invoice columns into a read — or keeps them
 * out while the database does not have them.
 */
export async function invoicePhase0Omit(): Promise<
  OmitOf<(typeof INVOICE_PHASE0_COLUMNS)[number]>
> {
  const hide = !(await accountingPhase0Available());
  return Object.fromEntries(
    INVOICE_PHASE0_COLUMNS.map((column) => [column, hide]),
  ) as OmitOf<(typeof INVOICE_PHASE0_COLUMNS)[number]>;
}

/** The same for expenses. */
export async function expensePhase0Omit(): Promise<
  OmitOf<(typeof EXPENSE_PHASE0_COLUMNS)[number]>
> {
  const hide = !(await accountingPhase0Available());
  return Object.fromEntries(
    EXPENSE_PHASE0_COLUMNS.map((column) => [column, hide]),
  ) as OmitOf<(typeof EXPENSE_PHASE0_COLUMNS)[number]>;
}
