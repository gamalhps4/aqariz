/**
 * PropertyPro - Posting a purchase bill and a payment voucher
 *
 * A purchase bill is a supplier's invoice to the office. Once it is approved
 * it is owed, and it is posted on its date:
 *     Dr the cost account of each line (+ input VAT) / Cr suppliers' payable
 * A bill still waiting for approval, and a cancelled one, post nothing. The
 * bill stays posted through its payments (`partially_paid`, `paid`) — what a
 * voucher pays is the voucher's own entry, so a bill's entry only changes when
 * the bill itself does.
 *
 * Each line is charged to the account it names — an expense account, or an
 * asset for something the office capitalises — and carries its building and
 * unit as the cost centre, so the profit and loss can be read by building.
 * A bill is the office's own purchase: when the office is VAT-registered the
 * VAT on its standard-rated lines is input VAT, and the cost line carries its
 * VAT category for the VAT return (purchases standard-rated, zero-rated or
 * exempt); an office that is not VAT-registered cannot reclaim VAT, so the VAT
 * stays in the cost.
 *
 * What an owner bears is not a bill. A cost on an owner's building that comes
 * off what the office holds for them is an Expense (posting/expense.ts): that
 * is what the owner's statement, the commission base and the agreement reports
 * read, and a bill the statements do not read must not move the owner's
 * balance in the books or the statement and the books would part.
 *
 * A payment voucher is money paid out. Posted, it is posted on its date:
 *     Dr suppliers' payable / Cr the bank or cash account it was drawn on
 * A cancelled voucher posts nothing, which reverses what was posted. What the
 * voucher paid on which bill does not change the entry: the supplier's account
 * simply goes down by the amount.
 *
 * Pure: no database, no clock.
 */

import { toHalalas } from "../money";
import type { PartyType, PostingPlan, VatCode } from "../types";
import { credit, debit, finishPlan } from "./common";

/** The statuses in which a bill is owed — the same as OWED_BILL_STATUSES. */
export const POSTED_BILL_STATUSES: readonly string[] = ["approved", "partially_paid", "paid"];

export interface PurchaseBillLineDoc {
  /** The ledger account the line is charged to. */
  accountId: string;
  /** Net of VAT and after the line's share of the discount, riyals. */
  net: number;
  /** The VAT on it, riyals. */
  vat: number;
  vatCategory: VatCode;
  /** The cost centre: the building and unit the cost belongs to. */
  propertyId?: string | null;
  unitId?: string | null;
  /** What was bought: the journal line's memo. */
  description?: string | null;
}

export interface PurchaseBillDoc {
  id: string;
  /** BILL-000123 */
  number?: string | null;
  date: Date;
  status: string;
  supplierId: string;
  lines: PurchaseBillLineDoc[];
  /** Whether the office may reclaim VAT (it is VAT-registered). */
  vatRecoverable: boolean;
}

const MEMO_LIMIT = 200;

function memoOf(text: string | null | undefined): string | null {
  const clean = (text ?? "").trim().replace(/\s+/g, " ");
  return clean ? clean.slice(0, MEMO_LIMIT) : null;
}

export function planPurchaseBill(doc: PurchaseBillDoc): PostingPlan | null {
  if (!POSTED_BILL_STATUSES.includes(doc.status)) return null;

  const supplier = { partyType: "supplier" as PartyType, partyId: doc.supplierId };
  const lines = [];
  let owed = 0;

  for (const line of doc.lines) {
    const net = toHalalas(line.net);
    const vat = Math.max(toHalalas(line.vat), 0);
    const gross = net + vat;
    if (gross <= 0) continue;
    owed += gross;

    const dims = { propertyId: line.propertyId ?? null, unitId: line.unitId ?? null };
    const memo = memoOf(line.description);

    if (doc.vatRecoverable) {
      lines.push(
        debit({ id: line.accountId }, net, { ...dims, vatCode: line.vatCategory, memo }),
        debit("input_vat", vat, { ...dims, vatCode: "S", memo }),
      );
    } else {
      lines.push(debit({ id: line.accountId }, gross, { ...dims, memo }));
    }
  }

  if (owed <= 0) return null;
  lines.push(credit("supplier_payables", owed, supplier));

  return finishPlan({
    sourceType: "purchase_bill",
    sourceId: doc.id,
    sourceRef: doc.number ?? null,
    date: doc.date,
    lines,
  });
}

export interface PaymentVoucherDoc {
  id: string;
  /** PV-000045 */
  number?: string | null;
  date: Date;
  status: string;
  supplierId: string;
  /** What was paid, riyals. */
  amount: number;
  /** The ledger account of the bank or cash account it was drawn on. */
  bankLedgerAccountId: string;
  /** The cheque or transfer number. */
  reference?: string | null;
}

export function planPaymentVoucher(doc: PaymentVoucherDoc): PostingPlan | null {
  if (doc.status !== "posted") return null;
  const amount = toHalalas(doc.amount);
  if (amount <= 0) return null;
  return finishPlan({
    sourceType: "payment_voucher",
    sourceId: doc.id,
    sourceRef: doc.number ?? null,
    date: doc.date,
    memo: memoOf(doc.reference),
    lines: [
      debit("supplier_payables", amount, {
        partyType: "supplier" as PartyType,
        partyId: doc.supplierId,
      }),
      credit({ id: doc.bankLedgerAccountId }, amount),
    ],
  });
}
