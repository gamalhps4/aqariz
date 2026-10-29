/**
 * PropertyPro - Posting an expense
 *
 * An expense is posted on its date once it is approved or paid — the same
 * two statuses the owner statement deducts (DEDUCTED_EXPENSE_STATUSES); a
 * pending request and a cancelled one post nothing.
 *
 * Spent on an owner's building, it is the owner's cost: it comes off what
 * the office holds for them, VAT and all (the input VAT is the owner's, not
 * the office's to reclaim):
 *     Dr owners' payable / Cr bank
 * Spent on the office itself (no building), or on its own buildings and
 * those it holds under investment, it is the office's cost, by category, and
 * VAT it can reclaim is input VAT:
 *     Dr expense (by category) + input VAT / Cr bank
 *
 * Paid, the credit is the cash box or the bank by payment method. Approved
 * but not paid yet, it is owed: to the supplier when one is named, else as an
 * accrued expense. When it is later marked paid, the posting service replaces
 * the entry (or, in a closed period, corrects it in the next open one). A
 * paid expense with a supplier passes through the supplier's account — owed,
 * then paid, in the one entry — so the supplier's statement shows both.
 *
 * The cost line carries the expense's VAT category for the VAT return
 * (purchases standard-rated, zero-rated or exempt) when the office is
 * VAT-registered; VAT spent on an owner's building is the owner's and is not
 * the office's purchase.
 */

import { toHalalas } from "../money";
import { expenseKeyForCategory } from "../system-keys";
import type { Ownership, PartyType, PostingPlan, VatCode } from "../types";
import { credit, debit, finishPlan } from "./common";
import { disbursementAccountKey } from "./methods";

export const POSTED_EXPENSE_STATUSES: readonly string[] = ["approved", "paid"];

export interface ExpenseDoc {
  id: string;
  number?: string | null;
  date: Date;
  /** What it cost, VAT included. */
  amount: number;
  /** VAT within `amount`; 0 when none was recorded. */
  vatAmount?: number;
  /** Whether the office may reclaim the VAT (it is VAT-registered). */
  vatRecoverable: boolean;
  /** S, Z, E or O as recorded on the expense; null when none was. */
  vatCategory?: VatCode | null;
  category: string | null;
  status: string;
  method: string | null;
  supplierId?: string | null;
  propertyId: string | null;
  unitId?: string | null;
  /** The building's owner, when the expense is on a building. */
  ownerId: string | null;
  /** Whose building; null for the office's own overheads (no building). */
  ownership: Ownership | null;
}

export function planExpense(doc: ExpenseDoc): PostingPlan | null {
  if (!POSTED_EXPENSE_STATUSES.includes(doc.status)) return null;
  const amount = toHalalas(doc.amount);
  if (amount <= 0) return null;

  const dims = {
    propertyId: doc.propertyId ?? null,
    unitId: doc.unitId ?? null,
  };
  const supplierParty = doc.supplierId
    ? { partyType: "supplier" as PartyType, partyId: doc.supplierId }
    : {};

  const paid = doc.status === "paid";
  const creditLines = doc.supplierId
    ? [
        credit("supplier_payables", amount, { ...supplierParty, ...dims }),
        ...(paid
          ? [
              debit("supplier_payables", amount, { ...supplierParty, ...dims }),
              credit(disbursementAccountKey(doc.method), amount, dims),
            ]
          : []),
      ]
    : [
        paid
          ? credit(disbursementAccountKey(doc.method), amount, dims)
          : credit("accrued_expenses", amount, dims),
      ];

  const base = {
    sourceType: "expense" as const,
    sourceId: doc.id,
    sourceRef: doc.number ?? null,
    date: doc.date,
  };

  if (doc.ownership === "owner") {
    return finishPlan({
      ...base,
      lines: [
        debit("owner_payable", amount, {
          ...(doc.ownerId ? { partyType: "owner" as PartyType, partyId: doc.ownerId } : {}),
          ...dims,
        }),
        ...creditLines,
      ],
    });
  }

  const vat = doc.vatRecoverable
    ? Math.min(Math.max(toHalalas(doc.vatAmount ?? 0), 0), amount)
    : 0;
  const vatCode: VatCode | null = !doc.vatRecoverable
    ? null
    : vat > 0
      ? "S"
      : (doc.vatCategory ?? null);

  return finishPlan({
    ...base,
    lines: [
      debit(expenseKeyForCategory(doc.category), amount - vat, { ...dims, vatCode }),
      debit("input_vat", vat, { ...dims, vatCode: "S" }),
      ...creditLines,
    ],
  });
}
