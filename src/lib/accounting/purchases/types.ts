/**
 * PropertyPro - Purchases and payments vocabulary
 *
 * The closed sets the purchase tables store as strings (the schema keeps
 * status and method columns as String), and the shapes the purchases routes
 * hand to the screens. Pure — no database, nothing server-only — so the
 * screens import it too.
 */

import type { AccountType, BankAccountKind } from "../types";

/**
 * A bill is entered `pending` and waits for someone holding the approval
 * right; approved, it is owed (and posted to the books). Payments move it
 * through `partially_paid` to `paid`; `cancelled` is a bill that never was.
 */
export const BILL_STATUSES = ["pending", "approved", "partially_paid", "paid", "cancelled"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

/** The statuses in which a bill is owed — and so posted to the books. */
export const OWED_BILL_STATUSES: readonly BillStatus[] = ["approved", "partially_paid", "paid"];

/** The statuses in which a bill still has something left to pay. */
export const PAYABLE_BILL_STATUSES: readonly BillStatus[] = ["approved", "partially_paid"];

export function isBillStatus(value: unknown): value is BillStatus {
  return typeof value === "string" && (BILL_STATUSES as readonly string[]).includes(value);
}

export const VOUCHER_STATUSES = ["posted", "cancelled"] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

export function isVoucherStatus(value: unknown): value is VoucherStatus {
  return typeof value === "string" && (VOUCHER_STATUSES as readonly string[]).includes(value);
}

/** How money left the office; informational — the account it left is the voucher's own. */
export const VOUCHER_METHODS = ["bank_transfer", "cheque", "cash", "card", "other"] as const;
export type VoucherMethod = (typeof VOUCHER_METHODS)[number];

export function isVoucherMethod(value: unknown): value is VoucherMethod {
  return typeof value === "string" && (VOUCHER_METHODS as readonly string[]).includes(value);
}

/** The aging report's columns: not yet due, then how long overdue. */
export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** What the screens read of a supplier. */
export interface SupplierView {
  id: string;
  name: string;
  vatNumber: string | null;
  phone: string | null;
  isActive: boolean;
  contactName: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  crNumber: string | null;
  bankName: string | null;
  iban: string | null;
  paymentTermsDays: number | null;
  notes: string | null;
  /**
   * What the office owes them, from the books (the supplier's lines on the
   * suppliers' payable account); null before accounting is set up. Negative:
   * the supplier owes the office (an advance).
   */
  balance: number | null;
  /** Bills not yet paid in full. */
  openBills: number;
  createdAt: string;
}

export interface BillLineView {
  id: string;
  position: number;
  description: string;
  accountId: string;
  account: { id: string; code: string; nameAr: string; nameEn: string } | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  netAmount: number;
  vatCategory: "S" | "Z" | "E" | "O";
  vatRate: number;
  vatAmount: number;
  totalAmount: number;
  propertyId: string | null;
  propertyName: string | null;
  unitId: string | null;
  unitName: string | null;
}

export interface BillView {
  id: string;
  number: number;
  /** BILL-000123 */
  displayNumber: string;
  /** `paymentTermsDays` lets an edit judge the due date against the supplier's terms. */
  supplier: { id: string; name: string; vatNumber: string | null; paymentTermsDays: number | null } | null;
  supplierInvoiceNumber: string | null;
  billDate: string;
  dueDate: string;
  status: BillStatus;
  /** Unpaid and past its due date today. */
  overdue: boolean;
  currency: string;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  amountPaid: number;
  balance: number;
  notes: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  approvedByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  version: number;
  /** What can be done to it now, by its state alone (the person's rights are checked apart). */
  can: { edit: boolean; approve: boolean; reopen: boolean; cancel: boolean; pay: boolean };
  lines?: BillLineView[];
  /** The vouchers that paid it (detail only). */
  payments?: Array<{
    voucherId: string;
    voucherNumber: number;
    voucherDisplayNumber: string;
    voucherDate: string;
    amount: number;
    status: VoucherStatus;
  }>;
}

export interface VoucherView {
  id: string;
  number: number;
  /** PV-000045 */
  displayNumber: string;
  supplier: { id: string; name: string; vatNumber: string | null } | null;
  voucherDate: string;
  /**
   * The bank or cash account it was drawn on. `name` is empty on the accounts
   * accounting set-up opened: show `name || the ledger account's name` in the
   * reader's language (see `bankDisplayName`).
   */
  bankAccount: {
    id: string;
    name: string;
    kind: string;
    ledgerAccountId: string;
    ledgerAccount: { code: string; nameAr: string; nameEn: string };
  } | null;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  notes: string | null;
  status: VoucherStatus;
  /** What the allocations cover; the rest is on account with the supplier. */
  allocated: number;
  onAccount: number;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  allocations?: Array<{
    billId: string;
    billNumber: number;
    billDisplayNumber: string;
    supplierInvoiceNumber: string | null;
    amount: number;
  }>;
}

/** A page of a list, as every purchases list answers. */
export interface PagedResult<T> {
  rows: T[];
  total: number;
}

/**
 * The name a bank or cash account is shown by: its own, or — on the accounts
 * accounting set-up opened, which have none — its ledger account's, in the
 * reader's language.
 */
export function bankDisplayName(
  bank: { name: string; ledgerAccount: { nameAr: string; nameEn: string } } | null | undefined,
  language: string,
): string {
  if (!bank) return "";
  if (bank.name?.trim()) return bank.name.trim();
  const { nameAr, nameEn } = bank.ledgerAccount;
  return language === "ar" ? nameAr || nameEn : nameEn || nameAr;
}

/** An account a bill line can be charged to, as the lookups list it. */
export interface CostAccountOption {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  postable: boolean;
  active: boolean;
  /**
   * Whether a purchase can be charged to it. false: listed only because a saved
   * bill already uses it, so the screen can still show it (the server says why
   * it no longer qualifies when the bill is saved).
   */
  qualifies: boolean;
}

/**
 * A bank or cash account, as the lookups list it: every one, the inactive
 * too (a voucher list filters by an account long closed), and `active` says
 * which a new voucher may be drawn on — the account and the ledger account it
 * is kept in both.
 */
export interface PayingAccountOption {
  id: string;
  kind: BankAccountKind;
  /** Empty on the accounts accounting set-up opened (see `bankDisplayName`). */
  name: string;
  currency: string;
  active: boolean;
  ledgerAccount: { id: string; code: string; nameAr: string; nameEn: string; active: boolean };
  /** From the books; null for a reader who may not see them. */
  balance: number | null;
}

/**
 * What the purchases screens need from the books without holding the books'
 * own rights: whether accounting is set up, the accounts a purchase can be
 * charged to, and the accounts a payment can be drawn on.
 */
export interface PurchaseLookups {
  setUp: boolean;
  accounts?: CostAccountOption[];
  banks?: PayingAccountOption[];
}
