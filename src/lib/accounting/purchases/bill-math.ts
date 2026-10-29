/**
 * PropertyPro - The arithmetic of a purchase bill and of paying it
 *
 * A bill's lines are worked out exactly as the office's own invoices are
 * (lib/invoice/vat.ts): net = quantity × unit price less the line's share of
 * the bill's discount, VAT charged on that net at the line's rate (standard-
 * rated lines only), everything in halalas underneath so the lines always add
 * up to the totals. What is left to pay on a bill, which status the payments
 * leave it in, and whether a voucher's allocations can stand are decided here
 * too, so the form shows the same refusals the route gives.
 *
 * Pure: no database, no clock.
 */

import {
  computeVatInvoice,
  type ComputedVatLine,
  type VatCategory,
  type VatTotals,
} from "@/lib/invoice/vat";
import { toHalalas } from "../money";
import { PAYABLE_BILL_STATUSES, type BillStatus } from "./types";

export const MAX_BILL_LINES = 100;
const DAY_MS = 86_400_000;

export interface BillLineInput {
  description: string;
  accountId: string;
  quantity?: number | null;
  unitPrice: number;
  vatCategory: VatCategory;
  vatRate?: number | null;
  propertyId?: string | null;
  unitId?: string | null;
}

export interface ComputedBillLine extends ComputedVatLine {
  accountId: string;
  propertyId: string | null;
  unitId: string | null;
}

export interface ComputedBill {
  lines: ComputedBillLine[];
  totals: VatTotals;
}

/**
 * The lines with their discount share, VAT and totals, and the bill's totals.
 * `discount` is one amount off the whole bill, taken before VAT. Throws
 * `VatInputError` for a line the arithmetic cannot take (a quantity of zero, a
 * discount above the lines' value).
 */
export function computeBill(inputs: readonly BillLineInput[], discount = 0): ComputedBill {
  const computed = computeVatInvoice(
    inputs.map((line) => ({
      description: line.description,
      quantity: line.quantity ?? 1,
      unitPrice: line.unitPrice,
      vatCategory: line.vatCategory,
      vatRate: line.vatRate ?? null,
    })),
    discount,
  );
  return {
    lines: computed.lines.map((line, index) => ({
      ...line,
      accountId: inputs[index].accountId,
      propertyId: inputs[index].propertyId?.trim() || null,
      unitId: inputs[index].unitId?.trim() || null,
    })),
    totals: computed.totals,
  };
}

/**
 * The day a bill falls due: its date plus the supplier's payment terms (none
 * recorded: due on its date). Days are midnight UTC, as everywhere in the
 * ledger.
 */
export function dueDateFor(billDate: Date, termsDays: number | null | undefined): Date {
  const days = Number.isFinite(termsDays) ? Math.max(0, Math.trunc(termsDays as number)) : 0;
  return new Date(billDate.getTime() + days * DAY_MS);
}

/** What is left to pay, in riyals, never below zero. */
export function balanceOf(total: number, paid: number): number {
  return Math.max(0, toHalalas(total) - toHalalas(paid)) / 100;
}

/** The status an owed bill is in once `paid` of `total` has been paid. */
export function statusAfterPayment(total: number, paid: number): "approved" | "partially_paid" | "paid" {
  const totalHalalas = toHalalas(total);
  const paidHalalas = toHalalas(paid);
  if (paidHalalas >= totalHalalas) return "paid";
  return paidHalalas > 0 ? "partially_paid" : "approved";
}

/** A bill can be rewritten only while it waits for approval. */
export function canEditBill(status: string): boolean {
  return status === "pending";
}

export function canApproveBill(status: string): boolean {
  return status === "pending";
}

/** An approved bill nobody has paid on can be sent back to be corrected. */
export function canReopenBill(status: string, amountPaid: number): boolean {
  return status === "approved" && toHalalas(amountPaid) === 0;
}

/** A bill with money paid on it cannot be cancelled until the payments are. */
export function canCancelBill(status: string, amountPaid: number): boolean {
  return (status === "pending" || status === "approved") && toHalalas(amountPaid) === 0;
}

export function canPayBill(status: string): boolean {
  return (PAYABLE_BILL_STATUSES as readonly string[]).includes(status);
}

/** Unpaid and past its due day. */
export function isOverdue(
  bill: { status: string; dueDate: Date; totalAmount: number; amountPaid: number },
  today: Date,
): boolean {
  return (
    canPayBill(bill.status) &&
    toHalalas(bill.totalAmount) > toHalalas(bill.amountPaid) &&
    bill.dueDate.getTime() < today.getTime()
  );
}

// ---------------------------------------------------------------------------
// Allocating a voucher to bills
// ---------------------------------------------------------------------------

export interface AllocationInput {
  billId: string;
  amount: number;
}

export interface AllocatableBill {
  id: string;
  supplierId: string;
  status: BillStatus | string;
  totalAmount: number;
  amountPaid: number;
}

export interface AllocationProblem {
  /** A machine code the screens translate (`ledger.errors.<code>`). */
  code:
    | "PURCHASE_ALLOCATION_AMOUNT"
    | "PURCHASE_ALLOCATION_DUPLICATE"
    | "PURCHASE_ALLOCATION_EXCEEDS_VOUCHER"
    | "PURCHASE_ALLOCATION_BILL_MISSING"
    | "PURCHASE_ALLOCATION_WRONG_SUPPLIER"
    | "PURCHASE_ALLOCATION_NOT_PAYABLE"
    | "PURCHASE_ALLOCATION_EXCEEDS_BALANCE";
  message: string;
  billId?: string;
}

/**
 * Whether a voucher of `voucherAmount` to `supplierId` can pay these bills in
 * these amounts. A voucher may pay less than it is worth (the rest is on
 * account with the supplier) and may pay no bill at all (an advance), never
 * more than it is worth; and each bill must be the supplier's, owed, and
 * paid no more than what is left on it.
 */
export function checkAllocations(args: {
  voucherAmount: number;
  supplierId: string;
  allocations: readonly AllocationInput[];
  bills: readonly AllocatableBill[];
}): AllocationProblem | null {
  const byId = new Map(args.bills.map((bill) => [bill.id, bill]));
  const seen = new Set<string>();
  let allocated = 0;
  for (const allocation of args.allocations) {
    const amount = toHalalas(allocation.amount);
    if (
      !Number.isFinite(allocation.amount) ||
      amount <= 0 ||
      Math.abs(amount - allocation.amount * 100) > 1e-6
    ) {
      return {
        code: "PURCHASE_ALLOCATION_AMOUNT",
        message: "Each payment to a bill must be above zero, with at most two decimals",
        billId: allocation.billId,
      };
    }
    if (seen.has(allocation.billId)) {
      return {
        code: "PURCHASE_ALLOCATION_DUPLICATE",
        message: "A bill can be paid once on a voucher",
        billId: allocation.billId,
      };
    }
    seen.add(allocation.billId);
    const bill = byId.get(allocation.billId);
    if (!bill) {
      return {
        code: "PURCHASE_ALLOCATION_BILL_MISSING",
        message: "A bill on this voucher does not exist",
        billId: allocation.billId,
      };
    }
    if (bill.supplierId !== args.supplierId) {
      return {
        code: "PURCHASE_ALLOCATION_WRONG_SUPPLIER",
        message: "A voucher can only pay its own supplier's bills",
        billId: bill.id,
      };
    }
    if (!canPayBill(bill.status)) {
      return {
        code: "PURCHASE_ALLOCATION_NOT_PAYABLE",
        message: "Only an approved bill with something left to pay can be paid",
        billId: bill.id,
      };
    }
    if (amount > toHalalas(bill.totalAmount) - toHalalas(bill.amountPaid)) {
      return {
        code: "PURCHASE_ALLOCATION_EXCEEDS_BALANCE",
        message: "A payment is more than what is left on its bill",
        billId: bill.id,
      };
    }
    allocated += amount;
  }
  if (allocated > toHalalas(args.voucherAmount)) {
    return {
      code: "PURCHASE_ALLOCATION_EXCEEDS_VOUCHER",
      message: "The bills paid add up to more than the voucher",
    };
  }
  return null;
}

/**
 * How `amount` pays down these bills, oldest due day first: each bill takes
 * up to what is left on it until the amount runs out. What the form offers to
 * start from; the person can change every figure.
 */
export function suggestAllocations(
  amount: number,
  bills: ReadonlyArray<{ id: string; dueDate: Date | string; totalAmount: number; amountPaid: number }>,
): AllocationInput[] {
  let left = toHalalas(amount);
  const ordered = [...bills].sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime() || a.id.localeCompare(b.id),
  );
  const out: AllocationInput[] = [];
  for (const bill of ordered) {
    if (left <= 0) break;
    const owed = toHalalas(bill.totalAmount) - toHalalas(bill.amountPaid);
    if (owed <= 0) continue;
    const take = Math.min(owed, left);
    out.push({ billId: bill.id, amount: take / 100 });
    left -= take;
  }
  return out;
}
