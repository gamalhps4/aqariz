/**
 * PropertyPro - The two registers as files
 *
 * Sales & Receipts and Purchases & Payments as a ReportSheet for
 * buildReportResponse: English headings the export catalogue translates
 * (`exports.label.*`), stored codes it translates as values (a document's
 * status, how a receipt was paid, who the customer is), and the block under
 * the title saying what the file covers. Days are ISO days.
 *
 * Pure: the routes hand in what the registers read.
 */

import type { ReportColumn, ReportFiltersSummary, ReportSheet } from "@/lib/reports/export";
import { bankDisplayName } from "./purchases/types";
import type {
  PurchaseRegisterRow,
  PurchaseRegisterTotals,
  SalesRegisterRow,
  SalesRegisterTotals,
} from "./registers";

interface RegisterOptions {
  filters: ReportFiltersSummary["filters"];
  period?: ReportFiltersSummary["period"];
  truncated?: boolean;
  limit?: number;
}

function summaryOf(options: RegisterOptions): ReportFiltersSummary {
  return {
    period: options.period ?? { from: null, to: null },
    filters: options.filters,
    ...(options.limit ? { limit: options.limit } : {}),
    ...(options.truncated !== undefined ? { truncated: options.truncated } : {}),
  };
}

/** What kind of document a sales row is, as a stored value the catalogue translates. */
const SALES_KIND_VALUE: Record<SalesRegisterRow["kind"], string> = {
  invoice: "invoice",
  credit_note: "credit_note",
  receipt: "receipt_voucher",
};

const PURCHASE_KIND_VALUE: Record<PurchaseRegisterRow["kind"], string> = {
  bill: "purchase_bill",
  payment: "payment_voucher",
};

export function salesRegisterSheet(
  rows: SalesRegisterRow[],
  totals: SalesRegisterTotals,
  options: RegisterOptions,
): ReportSheet<SalesRegisterRow> {
  const columns: ReportColumn<SalesRegisterRow>[] = [
    { header: "Date", value: (row) => row.date },
    { header: "Document", value: (row) => SALES_KIND_VALUE[row.kind] },
    { header: "Number", value: (row) => row.documentNumber },
    { header: "Customer", value: (row) => row.customerName },
    { header: "Customer type", value: (row) => row.customerType },
    { header: "Reference", value: (row) => row.reference ?? "" },
    { header: "Building", value: (row) => row.building ?? "" },
    { header: "Method", value: (row) => row.method ?? "" },
    { header: "Status", value: (row) => row.status },
    { header: "Invoiced", value: (row) => row.invoiced || null },
    { header: "VAT", value: (row) => row.vat || null },
    { header: "Received", value: (row) => row.received || null },
  ];
  return {
    title: "Sales and receipts",
    columns,
    rows,
    filtersSummary: summaryOf(options),
    summary: [
      ["Invoiced", totals.invoiced],
      ["Credit notes", totals.creditNotes],
      ["Net invoiced", totals.netInvoiced],
      ["VAT", totals.vat],
      ["Received", totals.received],
    ],
  };
}

export function purchaseRegisterSheet(
  rows: PurchaseRegisterRow[],
  totals: PurchaseRegisterTotals,
  options: RegisterOptions & { language: string },
): ReportSheet<PurchaseRegisterRow> {
  const columns: ReportColumn<PurchaseRegisterRow>[] = [
    { header: "Date", value: (row) => row.date },
    { header: "Document", value: (row) => PURCHASE_KIND_VALUE[row.kind] },
    { header: "Number", value: (row) => row.documentNumber },
    { header: "Supplier", value: (row) => row.supplierName },
    { header: "Reference", value: (row) => row.reference ?? "" },
    { header: "Due date", value: (row) => row.dueDate ?? "" },
    { header: "Account", value: (row) => bankDisplayName(row.account, options.language) },
    { header: "Method", value: (row) => row.method ?? "" },
    { header: "Status", value: (row) => row.status },
    { header: "Billed", value: (row) => row.billed || null },
    { header: "VAT", value: (row) => row.vat || null },
    { header: "Paid", value: (row) => row.paid || null },
  ];
  return {
    title: "Purchases and payments",
    columns,
    rows,
    filtersSummary: summaryOf(options),
    summary: [
      ["Billed", totals.billed],
      ["VAT", totals.vat],
      ["Waiting for approval", totals.pending],
      ["Paid", totals.paid],
    ],
  };
}
