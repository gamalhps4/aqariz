"use client";

/**
 * PropertyPro - What the ledger screens share
 *
 * The words (every text is `ledger.*` in the accounting locale files, with
 * the English beside it as the fallback), the reader's rights over the books,
 * and one way to call the ledger API that turns a refusal into a sentence in
 * the reader's language.
 */

import { useCallback, useMemo } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { hasAnyPermission } from "@/lib/permissions-manager";
import {
  LEDGER_CLOSE_PERIOD_PERMISSIONS,
  LEDGER_MANAGE_PERMISSIONS,
  LEDGER_VIEW_PERMISSIONS,
} from "@/lib/finance-permissions";
import type { SystemKey } from "@/lib/accounting/system-keys";
import type { AccountType, BankAccountKind, PartyType, SourceType } from "@/lib/accounting/types";
import { businessToday } from "@/lib/dates/business-day";

export type Text = readonly [key: string, fallback: string];

export function useLedgerText() {
  const { t, language, isRTL, formatCurrency, formatDate } = useLocalizationContext();
  const tx = useCallback(
    (key: string, fallback: string, values?: Record<string, string | number>) =>
      t(key, { defaultValue: fallback, ...(values ? { values } : {}) }),
    [t],
  );
  const text = useCallback(
    (entry: Text, values?: Record<string, string | number>) => tx(entry[0], entry[1], values),
    [tx],
  );
  return { tx, text, language, isRTL, formatCurrency, formatDate };
}

/** An account's name in the reader's language. */
export function accountName(
  account: { nameAr: string; nameEn: string } | null | undefined,
  language: string,
): string {
  if (!account) return "";
  return language === "ar" ? account.nameAr || account.nameEn : account.nameEn || account.nameAr;
}

export function useLedgerAccess() {
  const { accessProfile, isLoading } = useAuthorization();
  return useMemo(() => {
    const permissions = accessProfile.permissions;
    return {
      loading: isLoading,
      canView: hasAnyPermission(permissions, [...LEDGER_VIEW_PERMISSIONS]),
      canManage: hasAnyPermission(permissions, [...LEDGER_MANAGE_PERMISSIONS]),
      canClose: hasAnyPermission(permissions, [...LEDGER_CLOSE_PERIOD_PERMISSIONS]),
    };
  }, [accessProfile.permissions, isLoading]);
}

export const SOURCE_TYPE_TEXT: Record<SourceType, Text> = {
  manual: ["ledger.sourceType.manual", "Manual journal"],
  opening_balance: ["ledger.sourceType.opening_balance", "Opening balances"],
  invoice: ["ledger.sourceType.invoice", "Invoice or installment"],
  invoice_settlement: ["ledger.sourceType.invoice_settlement", "Paid on an invoice"],
  payment: ["ledger.sourceType.payment", "Payment received"],
  payment_refund: ["ledger.sourceType.payment_refund", "Payment refunded"],
  expense: ["ledger.sourceType.expense", "Expense"],
  deposit_receipt: ["ledger.sourceType.deposit_receipt", "Deposit collected"],
  deposit_settlement: ["ledger.sourceType.deposit_settlement", "Deposit settled"],
  bank_transfer: ["ledger.sourceType.bank_transfer", "Bank transfer"],
  owner_settlement: ["ledger.sourceType.owner_settlement", "Owner settlement"],
  owner_payout: ["ledger.sourceType.owner_payout", "Owner payout"],
  purchase_bill: ["ledger.sourceType.purchase_bill", "Purchase bill"],
  payment_voucher: ["ledger.sourceType.payment_voucher", "Payment voucher"],
};

export const ACCOUNT_TYPE_TEXT: Record<AccountType, Text> = {
  asset: ["ledger.accountType.asset", "Asset"],
  liability: ["ledger.accountType.liability", "Liability"],
  equity: ["ledger.accountType.equity", "Equity"],
  income: ["ledger.accountType.income", "Income"],
  expense: ["ledger.accountType.expense", "Expense"],
};

export const NORMAL_SIDE_TEXT: Record<"debit" | "credit", Text> = {
  debit: ["ledger.side.debit", "Debit"],
  credit: ["ledger.side.credit", "Credit"],
};

export const BANK_KIND_TEXT: Record<BankAccountKind, Text> = {
  bank: ["ledger.bankKind.bank", "Bank"],
  cash: ["ledger.bankKind.cash", "Cash"],
  pos: ["ledger.bankKind.pos", "POS (mada)"],
  gateway_clearing: ["ledger.bankKind.gateway_clearing", "Payment gateway"],
};

export const PARTY_TYPE_TEXT: Record<PartyType, Text> = {
  tenant: ["ledger.party.tenant", "Tenant"],
  owner: ["ledger.party.owner", "Owner"],
  supplier: ["ledger.party.supplier", "Supplier"],
  customer: ["ledger.party.customer", "Customer"],
};

export const SYSTEM_KEY_TEXT: Record<SystemKey, Text> = {
  cash_on_hand: ["ledger.systemKey.cash_on_hand", "Cash received"],
  bank: ["ledger.systemKey.bank", "Transfers and cheques received"],
  pos_clearing: ["ledger.systemKey.pos_clearing", "POS (mada) receipts"],
  gateway_clearing: ["ledger.systemKey.gateway_clearing", "Online gateway receipts"],
  tenant_receivables: ["ledger.systemKey.tenant_receivables", "Tenants' receivable"],
  customer_receivables: ["ledger.systemKey.customer_receivables", "Customers' receivable"],
  input_vat: ["ledger.systemKey.input_vat", "VAT on purchases"],
  owner_uncollected_rent: ["ledger.systemKey.owner_uncollected_rent", "Owners' rent not yet collected"],
  owner_payable: ["ledger.systemKey.owner_payable", "What the office owes owners"],
  security_deposits: ["ledger.systemKey.security_deposits", "Security deposits held"],
  output_vat: ["ledger.systemKey.output_vat", "VAT on sales"],
  supplier_payables: ["ledger.systemKey.supplier_payables", "Suppliers' payable"],
  accrued_expenses: ["ledger.systemKey.accrued_expenses", "Approved expenses not yet paid"],
  opening_balance_equity: ["ledger.systemKey.opening_balance_equity", "Opening balance difference"],
  retained_earnings: ["ledger.systemKey.retained_earnings", "Retained earnings"],
  commission_income: ["ledger.systemKey.commission_income", "Management commission"],
  management_fee_income: ["ledger.systemKey.management_fee_income", "Fixed management fees"],
  rent_income: ["ledger.systemKey.rent_income", "Rent of the office's own buildings"],
  investment_rent_income: ["ledger.systemKey.investment_rent_income", "Rent of buildings under investment"],
  other_income: ["ledger.systemKey.other_income", "Other income"],
  investment_rent_expense: ["ledger.systemKey.investment_rent_expense", "Investment rent owed to owners"],
  expense_maintenance: ["ledger.systemKey.expense_maintenance", "Expenses: maintenance"],
  expense_repair: ["ledger.systemKey.expense_repair", "Expenses: repairs"],
  expense_utilities: ["ledger.systemKey.expense_utilities", "Expenses: utilities"],
  expense_insurance: ["ledger.systemKey.expense_insurance", "Expenses: insurance"],
  expense_taxes: ["ledger.systemKey.expense_taxes", "Expenses: government fees and taxes"],
  expense_management_fee: ["ledger.systemKey.expense_management_fee", "Expenses: management fees"],
  expense_advertising: ["ledger.systemKey.expense_advertising", "Expenses: advertising"],
  expense_legal: ["ledger.systemKey.expense_legal", "Expenses: legal and professional"],
  expense_supplies: ["ledger.systemKey.expense_supplies", "Expenses: supplies"],
  expense_landscaping: ["ledger.systemKey.expense_landscaping", "Expenses: landscaping"],
  expense_cleaning: ["ledger.systemKey.expense_cleaning", "Expenses: cleaning"],
  expense_capital_improvement: ["ledger.systemKey.expense_capital_improvement", "Capital improvements"],
  expense_other: ["ledger.systemKey.expense_other", "Expenses: other"],
};

/** The refusals the screens can meet, in the reader's language. */
export const ERROR_TEXT: Record<string, Text> = {
  LEDGER_NOT_SET_UP: ["ledger.errors.LEDGER_NOT_SET_UP", "Accounting is not set up for this office yet."],
  LEDGER_PERIOD_LOCKED: ["ledger.errors.LEDGER_PERIOD_LOCKED", "The books are closed through that date. Choose a later date."],
  LEDGER_BEFORE_CUTOVER: ["ledger.errors.LEDGER_BEFORE_CUTOVER", "The books start on the cut-over date. Choose that day or later."],
  LEDGER_UNBALANCED: ["ledger.errors.LEDGER_UNBALANCED", "Debits and credits must be equal."],
  LEDGER_LINE_NO_ACCOUNT: ["ledger.errors.LEDGER_LINE_NO_ACCOUNT", "Choose an account for every line."],
  LEDGER_LINE_BAD_AMOUNT: ["ledger.errors.LEDGER_LINE_BAD_AMOUNT", "Amounts must be numbers with at most two decimals."],
  LEDGER_LINE_BOTH_SIDES: ["ledger.errors.LEDGER_LINE_BOTH_SIDES", "A line takes a debit or a credit, not both."],
  LEDGER_LINE_NO_AMOUNT: ["ledger.errors.LEDGER_LINE_NO_AMOUNT", "Every line needs an amount."],
  LEDGER_TOO_FEW_LINES: ["ledger.errors.LEDGER_TOO_FEW_LINES", "A journal needs at least two lines."],
  LEDGER_ZERO_TOTAL: ["ledger.errors.LEDGER_ZERO_TOTAL", "A journal must move an amount above zero."],
  LEDGER_ACCOUNT_SYSTEM: ["ledger.errors.LEDGER_ACCOUNT_SYSTEM", "This account is used by the automatic postings. Rename or move it instead."],
  LEDGER_ACCOUNT_MAPPED: ["ledger.errors.LEDGER_ACCOUNT_MAPPED", "The account map points at this account. Choose another account in the setup first."],
  LEDGER_ACCOUNT_HAS_POSTINGS: ["ledger.errors.LEDGER_ACCOUNT_HAS_POSTINGS", "This account has postings. Deactivate it instead of deleting it."],
  LEDGER_ACCOUNT_HAS_CHILDREN: ["ledger.errors.LEDGER_ACCOUNT_HAS_CHILDREN", "Move or remove the accounts under this heading first."],
  LEDGER_ACCOUNT_HAS_ACTIVE_CHILDREN: ["ledger.errors.LEDGER_ACCOUNT_HAS_ACTIVE_CHILDREN", "Deactivate the accounts under this heading first."],
  LEDGER_ACCOUNT_BANK_LINKED: ["ledger.errors.LEDGER_ACCOUNT_BANK_LINKED", "A bank or cash account is kept in this account."],
  LEDGER_ACCOUNT_CODE_INVALID: ["ledger.errors.LEDGER_ACCOUNT_CODE_INVALID", "An account code is up to 20 letters, digits, dots or dashes."],
  LEDGER_ACCOUNT_CODE_TAKEN: ["ledger.errors.LEDGER_ACCOUNT_CODE_TAKEN", "That code is already used by another account."],
  LEDGER_ACCOUNT_NAME_REQUIRED: ["ledger.errors.LEDGER_ACCOUNT_NAME_REQUIRED", "Give the account an Arabic and an English name."],
  LEDGER_ACCOUNT_TYPE_LOCKED: ["ledger.errors.LEDGER_ACCOUNT_TYPE_LOCKED", "This account's type cannot change."],
  LEDGER_PARENT_POSTABLE: ["ledger.errors.LEDGER_PARENT_POSTABLE", "Accounts can only sit under a heading account."],
  LEDGER_PARENT_TYPE: ["ledger.errors.LEDGER_PARENT_TYPE", "An account must sit under a heading of its own type."],
  LEDGER_PARENT_CYCLE: ["ledger.errors.LEDGER_PARENT_CYCLE", "An account cannot sit under itself or its own sub-accounts."],
  LEDGER_PARENT_INACTIVE: ["ledger.errors.LEDGER_PARENT_INACTIVE", "The parent heading is inactive."],
  LEDGER_TOO_DEEP: ["ledger.errors.LEDGER_TOO_DEEP", "The chart cannot go that many levels deep."],
  LEDGER_ACCOUNT_INACTIVE: ["ledger.errors.LEDGER_ACCOUNT_INACTIVE", "One of the accounts is inactive."],
  LEDGER_ACCOUNT_NOT_POSTABLE: ["ledger.errors.LEDGER_ACCOUNT_NOT_POSTABLE", "Headings take no postings. Choose a sub-account."],
  LEDGER_ACCOUNT_UNMAPPED: ["ledger.errors.LEDGER_ACCOUNT_UNMAPPED", "A posting job has no account. Check the account map."],
  LEDGER_MAP_TYPE: ["ledger.errors.LEDGER_MAP_TYPE", "That account is the wrong kind for this job."],
  LEDGER_CUTOVER_LOCKED: ["ledger.errors.LEDGER_CUTOVER_LOCKED", "The cut-over date cannot change once the books have entries."],
  LEDGER_CUTOVER_REQUIRED: ["ledger.errors.LEDGER_CUTOVER_REQUIRED", "Set the cut-over date first."],
  LEDGER_VAT_NUMBER_INVALID: ["ledger.errors.LEDGER_VAT_NUMBER_INVALID", "A VAT number is 15 digits and begins and ends with 3."],
  LEDGER_CLOSE_FUTURE: ["ledger.errors.LEDGER_CLOSE_FUTURE", "A period can only be closed through a day that has passed."],
  LEDGER_REVERSE_DOCUMENT: ["ledger.errors.LEDGER_REVERSE_DOCUMENT", "This entry follows a document. Cancel or correct the document instead."],
  LEDGER_ALREADY_REVERSED: ["ledger.errors.LEDGER_ALREADY_REVERSED", "This has already been reversed."],
  LEDGER_REVERSE_BEFORE_ENTRY: ["ledger.errors.LEDGER_REVERSE_BEFORE_ENTRY", "A reversal cannot be dated before the entry it reverses."],
  LEDGER_SETTLEMENT_OVERLAP: ["ledger.errors.LEDGER_SETTLEMENT_OVERLAP", "Part of this period is already settled for this owner."],
  LEDGER_PERIOD_FUTURE: ["ledger.errors.LEDGER_PERIOD_FUTURE", "A period can only be settled once it has ended."],
  LEDGER_PERIOD_INVALID: ["ledger.errors.LEDGER_PERIOD_INVALID", "The period ends before it starts."],
  LEDGER_INVALID_AMOUNT: ["ledger.errors.LEDGER_INVALID_AMOUNT", "The amount must be above zero, with at most two decimals."],
  LEDGER_SAME_ACCOUNT: ["ledger.errors.LEDGER_SAME_ACCOUNT", "Choose two different accounts."],
  LEDGER_BANK_INACTIVE: ["ledger.errors.LEDGER_BANK_INACTIVE", "That account is inactive."],
  LEDGER_BANK_NAME_REQUIRED: ["ledger.errors.LEDGER_BANK_NAME_REQUIRED", "Give the account a name."],
  LEDGER_IBAN_INVALID: ["ledger.errors.LEDGER_IBAN_INVALID", "The IBAN does not look right."],
  LEDGER_DATE_INVALID: ["ledger.errors.LEDGER_DATE_INVALID", "Choose a valid date."],
  LEDGER_SCOPED_EMPLOYEE: ["ledger.errors.LEDGER_SCOPED_EMPLOYEE", "Your access is limited to some buildings, so the books are not open to you."],
  LEDGER_CSV_PROBLEMS: ["ledger.errors.LEDGER_CSV_PROBLEMS", "The file has problems; nothing was posted."],
  LEDGER_ACCOUNT_NOT_FOUND: ["ledger.errors.LEDGER_ACCOUNT_NOT_FOUND", "An account on this document does not exist."],
  LEDGER_BANK_NOT_FOUND: ["ledger.errors.LEDGER_BANK_NOT_FOUND", "That bank or cash account does not exist."],
  LEDGER_PERIOD_REVERSED: ["ledger.errors.LEDGER_PERIOD_REVERSED", "The start date cannot be after the end date."],
  LEDGER_STAFF_ONLY: ["ledger.errors.LEDGER_STAFF_ONLY", "The books are open to the office's staff only."],
  LEDGER_BAD_REQUEST: ["ledger.errors.LEDGER_BAD_REQUEST", "The request could not be read. Reload the page and try again."],
  PURCHASES_UNAVAILABLE: ["ledger.errors.PURCHASES_UNAVAILABLE", "Purchases and payments need a database update that has not been applied yet."],
  PURCHASE_NUMBER_FAILED: ["ledger.errors.PURCHASE_NUMBER_FAILED", "A number could not be taken for the document. Try again."],
  PURCHASE_SUPPLIER_NOT_FOUND: ["ledger.errors.PURCHASE_SUPPLIER_NOT_FOUND", "That supplier does not exist."],
  PURCHASE_SUPPLIER_INACTIVE: ["ledger.errors.PURCHASE_SUPPLIER_INACTIVE", "This supplier is inactive. Reactivate it to enter a bill."],
  PURCHASE_SUPPLIER_IN_USE: ["ledger.errors.PURCHASE_SUPPLIER_IN_USE", "This supplier has bills, payments or expenses. Deactivate it instead of deleting it."],
  PURCHASE_SUPPLIER_VAT_TAKEN: ["ledger.errors.PURCHASE_SUPPLIER_VAT_TAKEN", "Another supplier already has this VAT number."],
  PURCHASE_BILL_NOT_FOUND: ["ledger.errors.PURCHASE_BILL_NOT_FOUND", "That bill does not exist."],
  PURCHASE_BILL_DUPLICATE: ["ledger.errors.PURCHASE_BILL_DUPLICATE", "This supplier's invoice number has already been entered."],
  PURCHASE_BILL_NOT_EDITABLE: ["ledger.errors.PURCHASE_BILL_NOT_EDITABLE", "Only a bill waiting for approval can be changed. Send it back first."],
  PURCHASE_BILL_NOT_PENDING: ["ledger.errors.PURCHASE_BILL_NOT_PENDING", "Only a bill waiting for approval can be approved."],
  PURCHASE_BILL_NOT_REOPENABLE: ["ledger.errors.PURCHASE_BILL_NOT_REOPENABLE", "Only an approved bill with nothing paid on it can be sent back."],
  PURCHASE_BILL_NOT_CANCELLABLE: ["ledger.errors.PURCHASE_BILL_NOT_CANCELLABLE", "A bill with payments on it cannot be cancelled. Cancel its payments first."],
  PURCHASE_BILL_CHANGED: ["ledger.errors.PURCHASE_BILL_CHANGED", "This bill was changed by someone else a moment ago. Refresh and try again."],
  PURCHASE_BILL_EMPTY: ["ledger.errors.PURCHASE_BILL_EMPTY", "A bill must come to more than zero."],
  PURCHASE_DUE_BEFORE_BILL: ["ledger.errors.PURCHASE_DUE_BEFORE_BILL", "The due date cannot be before the bill's date."],
  PURCHASE_LINE_ACCOUNT_INVALID: ["ledger.errors.PURCHASE_LINE_ACCOUNT_INVALID", "A line is charged to an account a purchase cannot be charged to. Choose an expense account."],
  PURCHASE_LINE_BUILDING_INVALID: ["ledger.errors.PURCHASE_LINE_BUILDING_INVALID", "A building or unit on a line does not exist or does not belong together."],
  PURCHASE_VOUCHER_NOT_FOUND: ["ledger.errors.PURCHASE_VOUCHER_NOT_FOUND", "That payment voucher does not exist."],
  PURCHASE_VOUCHER_CANCELLED: ["ledger.errors.PURCHASE_VOUCHER_CANCELLED", "This voucher has been cancelled."],
  PURCHASE_VOUCHER_RECONCILED: ["ledger.errors.PURCHASE_VOUCHER_RECONCILED", "This payment has been reconciled with the bank statement. Un-reconcile it first."],
  PURCHASE_ALLOCATION_AMOUNT: ["ledger.errors.PURCHASE_ALLOCATION_AMOUNT", "Each payment to a bill must be above zero, with at most two decimals."],
  PURCHASE_ALLOCATION_DUPLICATE: ["ledger.errors.PURCHASE_ALLOCATION_DUPLICATE", "A bill can be paid once on a voucher."],
  PURCHASE_ALLOCATION_EXCEEDS_VOUCHER: ["ledger.errors.PURCHASE_ALLOCATION_EXCEEDS_VOUCHER", "The bills paid add up to more than the voucher."],
  PURCHASE_ALLOCATION_BILL_MISSING: ["ledger.errors.PURCHASE_ALLOCATION_BILL_MISSING", "A bill on this voucher does not exist."],
  PURCHASE_ALLOCATION_WRONG_SUPPLIER: ["ledger.errors.PURCHASE_ALLOCATION_WRONG_SUPPLIER", "A voucher can only pay its own supplier's bills."],
  PURCHASE_ALLOCATION_NOT_PAYABLE: ["ledger.errors.PURCHASE_ALLOCATION_NOT_PAYABLE", "Only an approved bill with something left to pay can be paid."],
  PURCHASE_ALLOCATION_EXCEEDS_BALANCE: ["ledger.errors.PURCHASE_ALLOCATION_EXCEEDS_BALANCE", "A payment is more than what is left on its bill."],
  RECONCILE_BANK_REQUIRED: ["ledger.errors.RECONCILE_BANK_REQUIRED", "Choose an account first."],
  RECONCILE_NO_LINES: ["ledger.errors.RECONCILE_NO_LINES", "Choose the lines first."],
  RECONCILE_TOO_MANY: ["ledger.errors.RECONCILE_TOO_MANY", "Reconcile at most 1,000 lines at a time."],
  RECONCILE_LINE_INVALID: ["ledger.errors.RECONCILE_LINE_INVALID", "A line does not belong to this account."],
  RECONCILE_DATE_FUTURE: ["ledger.errors.RECONCILE_DATE_FUTURE", "A line cannot be reconciled on a day that has not come."],
  REGISTER_TOO_DEEP: ["ledger.errors.REGISTER_TOO_DEEP", "That page is too far down the list. Narrow the period or the filters."],
};

export interface LedgerResponse<T> {
  ok: boolean;
  data: T | null;
  message: string | null;
  code: string | null;
  pagination?: { page: number; limit: number; total: number; totalPages: number } | null;
  raw?: unknown;
}

/**
 * Call an accounting API route by its full path; never throws. Every
 * accounting screen — the ledger's, purchases, the registers — answers
 * refusals through the same shape, so one function reads them all.
 */
export async function apiRequest<T>(
  url: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<LedgerResponse<T>> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
    });
    const json = (await response.json().catch(() => null)) as
      | { success?: boolean; data?: T; error?: string; message?: string; code?: string; pagination?: LedgerResponse<T>["pagination"]; summary?: unknown }
      | null;
    if (!response.ok || !json?.success) {
      return {
        ok: false,
        data: (json?.data as T) ?? null,
        message: json?.error ?? json?.message ?? `HTTP ${response.status}`,
        code: json?.code ?? null,
        raw: json,
      };
    }
    return {
      ok: true,
      data: (json.data as T) ?? null,
      message: json.message ?? null,
      code: null,
      pagination: json.pagination ?? null,
      raw: json,
    };
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      return { ok: false, data: null, message: null, code: "ABORTED" };
    }
    return { ok: false, data: null, message: error instanceof Error ? error.message : String(error), code: null };
  }
}

/** Call a ledger API route; never throws. */
export function ledgerRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<LedgerResponse<T>> {
  return apiRequest<T>(`/api/accounting/ledger${path}`, init);
}

/** A refusal as a sentence in the reader's language. */
export function useLedgerError() {
  const { text, tx } = useLedgerText();
  return useCallback(
    (response: Pick<LedgerResponse<unknown>, "code" | "message">) => {
      const known = response.code ? ERROR_TEXT[response.code] : undefined;
      if (known) return text(known);
      return response.message || tx("ledger.errors.generic", "Something went wrong. Try again.");
    },
    [text, tx],
  );
}

/** Today in the office's calendar, as YYYY-MM-DD, for date inputs. */
export function todayInput(): string {
  return businessToday();
}
