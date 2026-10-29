/**
 * PropertyPro - The purchases lists as files
 *
 * Suppliers, bills, vouchers and the payables aging as a ReportSheet for
 * buildReportResponse: English headings the export catalogue translates
 * (`exports.label.*`), stored codes it translates as values (a bill's status,
 * how a voucher was paid), and the block under the title saying what the file
 * covers (`filtersSummary`). Days are ISO days; the writers print them in the
 * office's format.
 *
 * Pure: the routes hand in what the services read.
 */

import type { ReportColumn, ReportFiltersSummary, ReportSheet } from "@/lib/reports/export";
import { AGING_BUCKETS, bankDisplayName, type BillView, type SupplierView, type VoucherView } from "./types";
import type { AgingSupplierRow, AgingTotals } from "./aging";

type Filters = ReportFiltersSummary["filters"];

interface ListOptions {
  filters: Filters;
  period?: ReportFiltersSummary["period"];
  truncated?: boolean;
  limit?: number;
}

function summaryOf(options: ListOptions): ReportFiltersSummary {
  return {
    ...(options.period ? { period: options.period } : {}),
    filters: options.filters,
    ...(options.limit ? { limit: options.limit } : {}),
    ...(options.truncated !== undefined ? { truncated: options.truncated } : {}),
  };
}

export function suppliersSheet(rows: SupplierView[], options: ListOptions): ReportSheet<SupplierView> {
  const columns: ReportColumn<SupplierView>[] = [
    { header: "Supplier", value: (row) => row.name },
    { header: "VAT number", value: (row) => row.vatNumber ?? "" },
    { header: "Contact", value: (row) => row.contactName ?? "" },
    { header: "Phone", value: (row) => row.phone ?? "" },
    { header: "Email", value: (row) => row.email ?? "" },
    { header: "City", value: (row) => row.city ?? "" },
    { header: "Payment terms (days)", value: (row) => row.paymentTermsDays },
    { header: "Open bills", value: (row) => row.openBills },
    { header: "Balance", value: (row) => row.balance },
    { header: "Status", value: (row) => (row.isActive ? "active" : "inactive") },
  ];
  const owed = rows.reduce((sum, row) => sum + Math.round((row.balance ?? 0) * 100), 0) / 100;
  return {
    title: "Suppliers",
    columns,
    rows,
    filtersSummary: summaryOf(options),
    summary: [
      ["Suppliers", rows.length],
      ["Total owed", owed],
    ],
  };
}

export function billsSheet(
  rows: BillView[],
  options: ListOptions & {
    totals: { totalAmount: number; vatAmount: number; amountPaid: number; outstanding: number; overdue: number };
  },
): ReportSheet<BillView> {
  const columns: ReportColumn<BillView>[] = [
    { header: "Number", value: (row) => row.displayNumber },
    { header: "Date", value: (row) => row.billDate },
    { header: "Due date", value: (row) => row.dueDate },
    { header: "Supplier", value: (row) => row.supplier?.name ?? "" },
    { header: "Supplier invoice no.", value: (row) => row.supplierInvoiceNumber ?? "" },
    { header: "Status", value: (row) => row.status },
    { header: "Subtotal", value: (row) => row.subtotal },
    { header: "Discount", value: (row) => row.discountAmount },
    { header: "VAT", value: (row) => row.vatAmount },
    { header: "Total", value: (row) => row.totalAmount },
    { header: "Paid", value: (row) => row.amountPaid },
    { header: "Balance", value: (row) => row.balance },
  ];
  return {
    title: "Purchase bills",
    columns,
    rows,
    filtersSummary: summaryOf(options),
    summary: [
      ["Total", options.totals.totalAmount],
      ["VAT", options.totals.vatAmount],
      ["Paid", options.totals.amountPaid],
      ["Still to pay", options.totals.outstanding],
      ["Overdue", options.totals.overdue],
    ],
  };
}

export function vouchersSheet(
  rows: VoucherView[],
  options: ListOptions & { totalAmount: number; language: string },
): ReportSheet<VoucherView> {
  const columns: ReportColumn<VoucherView>[] = [
    { header: "Number", value: (row) => row.displayNumber },
    { header: "Date", value: (row) => row.voucherDate },
    { header: "Supplier", value: (row) => row.supplier?.name ?? "" },
    { header: "Account", value: (row) => bankDisplayName(row.bankAccount, options.language) },
    { header: "Method", value: (row) => row.method },
    { header: "Reference", value: (row) => row.reference ?? "" },
    { header: "Status", value: (row) => row.status },
    { header: "Amount", value: (row) => row.amount },
    { header: "Paid on bills", value: (row) => row.allocated },
    { header: "On account", value: (row) => row.onAccount },
  ];
  return {
    title: "Payment vouchers",
    columns,
    rows,
    filtersSummary: summaryOf(options),
    summary: [["Total paid", options.totalAmount]],
  };
}

interface AgingSheetRow {
  supplier: string;
  buckets: Record<(typeof AGING_BUCKETS)[number], number>;
  outstanding: number;
  onAccount: number;
  net: number;
}

const BUCKET_HEADERS: Record<(typeof AGING_BUCKETS)[number], string> = {
  current: "Current",
  d1_30: "1-30 days",
  d31_60: "31-60 days",
  d61_90: "61-90 days",
  d90_plus: "90+ days",
};

export function agingSheet(
  rows: AgingSupplierRow[],
  totals: AgingTotals,
  options: {
    asOf: string;
    filters: Filters;
    ledger: { balance: number; difference: number } | null;
    totalLabel: string;
  },
): ReportSheet<AgingSheetRow> {
  const body: AgingSheetRow[] = rows.map((row) => ({
    supplier: row.supplierName,
    buckets: row.buckets,
    outstanding: row.outstanding,
    onAccount: row.onAccount,
    net: row.net,
  }));
  body.push({
    supplier: options.totalLabel,
    buckets: totals.buckets,
    outstanding: totals.outstanding,
    onAccount: totals.onAccount,
    net: totals.net,
  });
  const columns: ReportColumn<AgingSheetRow>[] = [
    { header: "Supplier", value: (row) => row.supplier },
    ...AGING_BUCKETS.map(
      (bucket): ReportColumn<AgingSheetRow> => ({
        header: BUCKET_HEADERS[bucket],
        value: (row) => row.buckets[bucket],
      }),
    ),
    { header: "Total outstanding", value: (row) => row.outstanding },
    { header: "On account", value: (row) => row.onAccount },
    { header: "Net owed", value: (row) => row.net },
  ];
  return {
    title: "Payables aging",
    columns,
    rows: body,
    filtersSummary: { asAt: options.asOf, filters: options.filters, rows: rows.length },
    summary: options.ledger
      ? [
          ["Net owed", totals.net],
          ["Per the books", options.ledger.balance],
          ["Difference", options.ledger.difference],
        ]
      : [["Net owed", totals.net]],
  };
}
