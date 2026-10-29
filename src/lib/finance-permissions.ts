/**
 * PropertyPro - Which rights open each finance action
 *
 * Invoices, expenses and the ledger each have View, Add, Edit, Delete and
 * Export now (the ledger only View and Export). Every list below is the
 * action's own right plus the rights that already opened it, so nobody who
 * could do something yesterday is refused today: `financial_management` is
 * all of finance, and `payment_processing` has always reached a single
 * invoice, which is where a payment is recorded.
 *
 * Kept in one place so the routes, the screens and the menu ask the same
 * question. No database here; the screens import it too.
 */

/** The invoice list, and the figures over it. */
export const INVOICE_LIST_PERMISSIONS = [
  "invoice_view",
  "financial_management",
] as const;

/** One invoice, opened or printed. */
export const INVOICE_READ_PERMISSIONS = [
  "invoice_view",
  "financial_management",
  "payment_processing",
] as const;

export const INVOICE_CREATE_PERMISSIONS = [
  "invoice_create",
  "financial_management",
] as const;

/** Changing an invoice list at once. */
export const INVOICE_BULK_EDIT_PERMISSIONS = [
  "invoice_edit",
  "financial_management",
] as const;

/** Changing one invoice, marking it sent, reminding the tenant. */
export const INVOICE_EDIT_PERMISSIONS = [
  "invoice_edit",
  "financial_management",
  "payment_processing",
] as const;

export const INVOICE_BULK_DELETE_PERMISSIONS = [
  "invoice_delete",
  "financial_management",
] as const;

export const INVOICE_DELETE_PERMISSIONS = [
  "invoice_delete",
  "financial_management",
  "payment_processing",
] as const;

/** Recording a payment against an installment is the Add of payments. */
export const INVOICE_PAYMENT_PERMISSIONS = [
  "payment_create",
  "payment_processing",
  "financial_management",
] as const;

export const EXPENSE_READ_PERMISSIONS = [
  "expense_view",
  "financial_management",
] as const;

export const EXPENSE_CREATE_PERMISSIONS = [
  "expense_create",
  "financial_management",
] as const;

export const EXPENSE_EDIT_PERMISSIONS = [
  "expense_edit",
  "financial_management",
] as const;

export const EXPENSE_DELETE_PERMISSIONS = [
  "expense_delete",
  "financial_management",
] as const;

/**
 * The ledger, revenue and the income-and-expense reports. Financial reports
 * has always opened revenue and the reports, and keeps doing so.
 */
export const ACCOUNTING_READ_PERMISSIONS = [
  "accounting_view",
  "financial_reports",
  "financial_management",
] as const;

/**
 * The double-entry books (lib/accounting): the chart of accounts, the
 * journal, the bank accounts and what the office owes each owner. Seeing
 * them is one right; keeping them — setting up, editing the chart, posting
 * journals, transfers, settlements and payouts — is another. Full finance
 * access opens both, as it opens all of finance.
 *
 * Closing a period is a third right, held apart on purpose: once the books
 * are closed through a date nothing can be posted on or before it, and only
 * someone trusted with that decision should take it. It is a new power
 * nobody held before, so it asks for its own right alone.
 */
export const LEDGER_VIEW_PERMISSIONS = [
  "ledger_view",
  "ledger_manage",
  "financial_management",
] as const;

export const LEDGER_MANAGE_PERMISSIONS = [
  "ledger_manage",
  "financial_management",
] as const;

export const LEDGER_CLOSE_PERIOD_PERMISSIONS = ["ledger_close_period"] as const;

/**
 * Purchases and payments (lib/accounting/purchases): suppliers, the bills they
 * send and the vouchers that pay them. Each action is its own right plus
 * `financial_management`, which is all of finance. Approving a bill and
 * paying a supplier are held apart: one makes a bill owed, the other takes
 * money out of an account.
 */
export const PURCHASE_VIEW_PERMISSIONS = ["purchase_view", "financial_management"] as const;

export const PURCHASE_CREATE_PERMISSIONS = ["purchase_create", "financial_management"] as const;

export const PURCHASE_EDIT_PERMISSIONS = ["purchase_edit", "financial_management"] as const;

/** Cancelling a bill, removing a supplier. */
export const PURCHASE_DELETE_PERMISSIONS = ["purchase_delete", "financial_management"] as const;

export const PURCHASE_APPROVE_PERMISSIONS = ["purchase_approve", "financial_management"] as const;

/** Writing a payment voucher, cancelling one, setting a payment on account against a bill. */
export const PURCHASE_PAY_PERMISSIONS = ["purchase_pay", "financial_management"] as const;
