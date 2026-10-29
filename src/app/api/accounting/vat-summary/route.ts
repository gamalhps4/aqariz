/**
 * PropertyPro - VAT summary
 * GET /api/accounting/vat-summary?startDate=&endDate=&groupBy=month|quarter
 *     [&format=xlsx|pdf|csv]
 *
 * Output VAT by category from the office's invoices and credit notes (and
 * the commission owner settlements booked themselves), input VAT from its
 * expenses and purchase bills, per period — what a VAT return is filled
 * from, document by document (lib/invoice/vat-summary.ts has the rules).
 * Each document is dated as the ledger posts it, so for a VAT-registered
 * office this equals the ledger's VAT return for the same days. Days are the
 * office's (Riyadh); without dates it is this quarter so far. Narrowed by the
 * caller's scope like every finance report: bills and settlements, which
 * belong to no one building, only for office-wide readers.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applyScope, expenseScope, invoiceScope } from "@/lib/db/scopes";
import type { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { ACCOUNTING_READ_PERMISSIONS } from "@/lib/finance-permissions";
import { InvoiceStatus } from "@/types";
import {
  businessDay,
  businessDayEnd,
  businessDayStart,
  businessToday,
  dateOnly,
  parseBusinessDay,
} from "@/lib/dates/business-day";
import { COUNTED_EXPENSE_STATUSES } from "@/lib/reports/report-where";
import {
  buildReportResponse,
  canExport,
  EXPORT_DENIED_MESSAGE,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  reportSection,
  type ReportColumn,
  type ReportSheet,
} from "@/lib/reports/export";
import { ledgerDay } from "@/lib/accounting/dates";
import { loadPostingContext, ownershipOn } from "@/lib/accounting/documents.service";
import { POSTED_BILL_STATUSES } from "@/lib/accounting/posting/purchase";
import { purchasesAvailable } from "@/lib/accounting/purchases/availability";
import { COMMISSION_TAX_RATE } from "@/lib/regional/region";
import { accountingPhase0Available } from "@/lib/invoice/phase0-columns";
import { readInvoiceLines } from "@/lib/invoice/custom-invoice.service";
import {
  invoiceVatDay,
  settlementVatDocs,
  summarizeVat,
  type VatBillDoc,
  type VatExpenseDoc,
  type VatInvoiceDoc,
  type VatPeriodGrouping,
  type VatPeriodRow,
  type VatSettlementDoc,
  type VatSummaryRow,
} from "@/lib/invoice/vat-summary";
import type { VatCategory } from "@/lib/invoice/vat";

/** How a category reads in an export: a value the catalogue translates. */
const CATEGORY_VALUES: Record<VatCategory, string> = {
  S: "standard_rated",
  Z: "zero_rated",
  E: "exempt",
  O: "out_of_scope",
};

const ROW_COLUMNS: ReportColumn<VatSummaryRow>[] = [
  { header: "VAT category", value: (row) => CATEGORY_VALUES[row.vatCategory] },
  { header: "Rate %", value: (row) => row.vatRate },
  { header: "Net", value: (row) => row.netAmount },
  { header: "VAT", value: (row) => row.vatAmount },
  { header: "Documents", value: (row) => row.count },
];

const PERIOD_COLUMNS: ReportColumn<VatPeriodRow>[] = [
  { header: "Period", value: (row) => row.key },
  { header: "Output VAT", value: (row) => row.outputVat },
  { header: "Input VAT", value: (row) => row.inputVat },
  { header: "Net VAT", value: (row) => row.netVat },
];

/** Approved purchase bills dated in the range, line by line. */
async function vatBills(range: { gte: Date; lte: Date }): Promise<VatBillDoc[]> {
  if (!(await purchasesAvailable())) return [];
  const bills = await db.purchaseBill.findMany({
    where: { status: { in: [...POSTED_BILL_STATUSES] }, billDate: range },
    select: {
      id: true,
      billDate: true,
      lines: { select: { netAmount: true, vatAmount: true, vatCategory: true, vatRate: true } },
    },
  });
  return bills.map((bill) => ({
    id: bill.id,
    day: businessDay(bill.billDate),
    lines: bill.lines.map((line) => ({
      vatCategory: line.vatCategory as VatCategory,
      vatRate: Number(line.vatRate),
      netAmount: Number(line.netAmount),
      vatAmount: Math.max(0, Number(line.vatAmount)),
    })),
  }));
}

/**
 * The commission owner settlements booked themselves — settled before a
 * settlement issued its tax invoice, which the invoices above count instead —
 * as their entries hold it: the standard-rated income and its VAT, on the
 * entry's day, and taken off again by a cancellation's reversal on its day.
 * Settlements exist only once the office keeps books.
 */
async function vatSettlements(fromDay: string, toDay: string): Promise<VatSettlementDoc[]> {
  const lines = await db.journalLine.findMany({
    where: {
      vatCode: "S",
      date: { gte: dateOnly(fromDay), lte: dateOnly(toDay) },
      entry: { sourceType: "owner_settlement" },
    },
    select: {
      entryId: true,
      date: true,
      debit: true,
      credit: true,
      account: { select: { type: true } },
    },
  });
  return settlementVatDocs(
    lines.map((line) => ({
      entryId: line.entryId,
      day: businessDay(line.date),
      debit: Number(line.debit),
      credit: Number(line.credit),
      income: line.account.type === "income",
    })),
    COMMISSION_TAX_RATE,
  );
}

/** The first day of the quarter a day falls in. */
function quarterStart(day: string): string {
  const month = Number(day.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  return `${day.slice(0, 4)}-${String(first).padStart(2, "0")}-01`;
}

export const GET = withPermissionAndDB([...ACCOUNTING_READ_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = request.nextUrl;
      const today = businessToday();
      const rawFrom = searchParams.get("startDate");
      const rawTo = searchParams.get("endDate");
      const fromDay = rawFrom ? parseBusinessDay(rawFrom) : quarterStart(today);
      const toDay = rawTo ? parseBusinessDay(rawTo) : today;
      if (!fromDay || !toDay) {
        return createErrorResponse("Invalid date range provided", 400);
      }
      if (toDay < fromDay) {
        return createErrorResponse("End date must be after the start date", 400);
      }
      const groupBy: VatPeriodGrouping =
        searchParams.get("groupBy") === "quarter" ? "quarter" : "month";

      const format = searchParams.get("format");
      if (format && !canExport(user, "accounting_export", "financial_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (format && !isReportFormat(format)) {
        return createErrorResponse(`Unsupported export format "${format}"`, 400);
      }

      const range = { gte: businessDayStart(fromDay), lte: businessDayEnd(toDay) };
      const phase0 = await accountingPhase0Available();

      // Invoices and credit notes of the period, dated as the ledger posts
      // them (an installment on its due day, a custom invoice on its issue
      // day): either day may fall in it, and the lines decide below. A
      // cancelled invoice was voided; an invoice a credit note corrected stays
      // issued, so the two net off.
      const invoiceWhere: Prisma.InvoiceWhereInput = {
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
        OR: [{ issueDate: range }, { dueDate: range }],
      };
      applyScope(invoiceWhere, invoiceScope(user));
      const expenseWhere: Prisma.ExpenseWhereInput = {
        deletedAt: null,
        status: { in: COUNTED_EXPENSE_STATUSES },
        date: range,
      };
      applyScope(expenseWhere, expenseScope(user));

      const [invoices, expenses] = await Promise.all([
        db.invoice.findMany({
          where: invoiceWhere,
          select: {
            id: true,
            issueDate: true,
            dueDate: true,
            category: true,
            subtotal: true,
            discountAmount: true,
            taxAmount: true,
            propertyId: true,
            ...(phase0 ? { documentType: true } : {}),
          },
        }),
        // Only an expense with VAT recorded can be in the summary, and before
        // the migration none has.
        phase0
          ? db.expense.findMany({
              where: {
                ...expenseWhere,
                OR: [{ vatAmount: { gt: 0 } }, { vatCategory: { not: null } }],
              },
              select: {
                id: true,
                date: true,
                amount: true,
                propertyId: true,
                vatAmount: true,
                vatCategory: true,
              },
            })
          : Promise.resolve([]),
      ]);

      // Whose building each document is on, on its day, as the ledger reads
      // it: an owner's, the office's own, or one held under investment.
      const context = await loadPostingContext(
        { cutOverDate: null, depositHolder: "owner", vatRegistered: false },
        [
          ...invoices.map((invoice) => invoice.propertyId),
          ...expenses.map((expense) => expense.propertyId),
        ].filter((id): id is string => Boolean(id)),
      );
      const ownersOn = (propertyId: string | null, at: Date) =>
        Boolean(propertyId) && ownershipOn(context, propertyId, ledgerDay(at)).ownership === "owner";

      const lines = await readInvoiceLines(invoices.map((invoice) => invoice.id));
      const invoiceDocs: VatInvoiceDoc[] = invoices.flatMap((invoice) => {
        const own = lines.get(invoice.id) ?? [];
        const day = invoiceVatDay(invoice, own.length > 0);
        if (day < fromDay || day > toDay) return [];
        const posted = dateOnly(day);
        return [
          {
            id: invoice.id,
            day,
            documentType:
              (invoice as { documentType?: string }).documentType === "credit_note"
                ? "credit_note"
                : "invoice",
            category: invoice.category,
            subtotal: Number(invoice.subtotal),
            discountAmount: Number(invoice.discountAmount),
            taxAmount: Number(invoice.taxAmount),
            lines: own,
            onOwnersBuilding: ownersOn(invoice.propertyId, posted),
          },
        ];
      });
      const expenseDocs: VatExpenseDoc[] = expenses.map((expense) => ({
        id: expense.id,
        day: businessDay(expense.date),
        amount: Number(expense.amount),
        vatAmount: Number(expense.vatAmount ?? 0),
        vatCategory: (expense.vatCategory as VatCategory | null) ?? null,
        onOwnersBuilding: ownersOn(expense.propertyId, expense.date),
      }));

      // The office's own purchases and the commission settlements booked:
      // neither is on one building, so only an office-wide reader sees them.
      const officeWide =
        !user.isOwner && !user.isTenant && user.scopedPropertyIds === undefined;
      const [billDocs, settlementDocs] = officeWide
        ? await Promise.all([vatBills(range), vatSettlements(fromDay, toDay)])
        : [[], []];

      const summary = summarizeVat(invoiceDocs, expenseDocs, groupBy, {
        bills: billDocs,
        settlements: settlementDocs,
      });

      if (format && isReportFormat(format)) {
        const sheet: ReportSheet<VatSummaryRow> = {
          title: "VAT summary",
          columns: ROW_COLUMNS,
          rows: summary.output.rows,
          filtersSummary: {
            period: { from: fromDay, to: toDay },
            filters: [],
          },
          summary: [
            ["Output VAT", summary.output.vatAmount],
            ["Input VAT", summary.input.vatAmount],
            ["Net VAT due", summary.netVatDue],
            ["Credit notes", summary.creditNotes.count],
            ["VAT on owners' rent", summary.ownersOutput.vatAmount],
          ],
          document: {
            summaryTitle: "Summary",
            tableTitle: "Output VAT",
            emptyText: "No invoices in this period",
            sections: [
              reportSection("Input VAT", ROW_COLUMNS, summary.input.rows, "No expenses with VAT in this period"),
              reportSection("Billed on owners' buildings", ROW_COLUMNS, summary.ownersOutput.rows),
              reportSection("VAT on owners' buildings' expenses", ROW_COLUMNS, summary.ownersInput.rows),
              reportSection("By period", PERIOD_COLUMNS, summary.periods),
            ],
          },
        };
        return buildReportResponse(sheet, {
          format,
          rtl: isRtlReportRequest(searchParams),
          lang: reportLanguage(searchParams),
          fileName: "VAT summary",
          dateStamp: `${fromDay}_${toDay}`,
        });
      }

      return createSuccessResponse(
        {
          period: { from: fromDay, to: toDay, groupBy },
          ...summary,
          // Without the migration nothing is written line by line and no
          // expense carries VAT yet: the screen says so.
          linesAvailable: phase0,
        },
        "VAT summary generated",
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
);
