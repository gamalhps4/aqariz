/**
 * PropertyPro - Checking an expense's VAT and supplier before it is written
 *
 * Shared by the expense routes: the fields need migration
 * 20261004121500_accounting_phase0, VAT belongs to a standard-rated expense
 * and never exceeds its amount, and the supplier must be one of the office's.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import { expenseVatProblem } from "@/lib/invoice/expense-vat";
import type { VatCategory } from "@/lib/invoice/vat";
import {
  accountingPhase0Available,
  PHASE0_MISSING_MESSAGE,
} from "@/lib/invoice/phase0-columns";

export interface ExpenseVatInput {
  amount?: number;
  vatAmount?: number;
  vatCategory?: VatCategory | null;
  supplierId?: string | null;
  supplierInvoiceNumber?: string | null;
}

export type ExpenseVatCheck =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string; status: number };

const PHASE0_KEYS = ["vatAmount", "vatCategory", "supplierId", "supplierInvoiceNumber"] as const;

/**
 * The body as it should be written, or why it cannot be. `existing` is the
 * expense being edited, for an edit that changes only some of the fields.
 */
export async function checkExpenseVat<T extends ExpenseVatInput>(
  body: T,
  existing?: { amount?: number | null; vatAmount?: number | null; vatCategory?: string | null } | null,
): Promise<ExpenseVatCheck> {
  const data: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  const touched = PHASE0_KEYS.some((key) => body[key] !== undefined);
  if (!touched) return { ok: true, data };

  if (!(await accountingPhase0Available())) {
    const meaningful =
      Number(body.vatAmount ?? 0) > 0 ||
      Boolean(body.vatCategory) ||
      Boolean(body.supplierId) ||
      Boolean(body.supplierInvoiceNumber);
    if (meaningful) return { ok: false, message: PHASE0_MISSING_MESSAGE, status: 503 };
    for (const key of PHASE0_KEYS) delete data[key];
    return { ok: true, data };
  }

  // VAT typed without a category is standard-rated VAT.
  if (Number(body.vatAmount ?? 0) > 0 && !body.vatCategory && !existing?.vatCategory) {
    data.vatCategory = "S";
  }
  // A category other than standard carries no VAT.
  if (body.vatCategory && body.vatCategory !== "S" && body.vatAmount === undefined) {
    data.vatAmount = 0;
  }
  const problem = expenseVatProblem({
    amount: body.amount ?? existing?.amount ?? null,
    vatAmount:
      (data.vatAmount as number | undefined) ?? existing?.vatAmount ?? 0,
    vatCategory:
      ((data.vatCategory as VatCategory | null | undefined) ??
        (existing?.vatCategory as VatCategory | null | undefined)) ||
      null,
  });
  if (problem) return { ok: false, message: problem, status: 400 };

  if (body.supplierId) {
    const supplier = await db.supplier.findFirst({
      where: { id: body.supplierId },
      select: { id: true },
    });
    if (!supplier) return { ok: false, message: "Supplier not found", status: 404 };
  }
  if (body.supplierId === "") data.supplierId = null;
  if (typeof body.supplierInvoiceNumber === "string") {
    data.supplierInvoiceNumber = body.supplierInvoiceNumber.trim() || null;
  }
  return { ok: true, data };
}
