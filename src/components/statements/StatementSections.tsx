"use client";

/**
 * PropertyPro - The parts of a statement of account
 *
 * Used by the owner's statement, a management agreement's statement (the same
 * statement read over the buildings one agreement covers), the owner portal,
 * the agreement report, and the compound, building and unit statements. Kept in one place so none of them can lay the same
 * figures out differently — they are the documents the client reconciles
 * against its own statements.
 *
 * Laid out as the client's sample (كشف حساب إتفاقيات الإدارة): the office's
 * name, registration and logo; the title; the details; the summary under its
 * heading (الملخص); every payment; the expenses. The words come from the same
 * catalogue keys the exports print (lib/statements/summary.ts, document.ts).
 */

import Image from "@/components/ui/app-image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Loader2, Receipt, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumn,
  type DataTablePagination,
} from "@/components/ui/data-table";
import { ReportExportButton } from "@/components/reports/export-button";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { LineTranslate } from "@/lib/statements/line-text";
import {
  statementSummaryRows,
  SUMMARY_TITLE_KEY,
  type SummaryFigures,
} from "@/lib/statements/summary";
import {
  expenseItemText,
  paymentCycleText,
  paymentNoteText,
  paymentUnitText,
  receivedByText,
} from "@/lib/statements/document";
import type {
  OwnerStatement,
  OwnerStatementTotals,
  StatementContractRow,
  StatementExpenseRow,
  StatementLetterhead,
  StatementPaymentRow,
} from "@/types/owner";

/** The screen's `t`, in the shape the shared wording helpers take. */
function useLineTranslate(): LineTranslate {
  const { t } = useLocalizationContext();
  return (key, english, values) => t(key, { defaultValue: english, values });
}

/** Rows a statement table shows at once. */
const PAGE_SIZE = 50;

/**
 * A year of payments across an office's agreements runs to thousands of
 * rows; the screen shows them a page at a time. The export carries them all.
 */
function usePagedRows<R>(rows: R[]): {
  visible: R[];
  pagination?: DataTablePagination;
} {
  const { t } = useLocalizationContext();
  const [page, setPage] = useState(1);
  if (rows.length <= PAGE_SIZE) return { visible: rows };

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  // A shorter result after new filters keeps the reader on a page that exists.
  const current = Math.min(page, totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, rows.length);
  return {
    visible: rows.slice(start, end),
    pagination: {
      currentPage: current,
      totalPages,
      pageSize: PAGE_SIZE,
      totalItems: rows.length,
      onPageChange: setPage,
      showingText: `${t("common.showing", { defaultValue: "Showing" })} ${start + 1}–${end} / ${rows.length}`,
      previousLabel: t("common.previous", { defaultValue: "Previous" }),
      nextLabel: t("common.next", { defaultValue: "Next" }),
    },
  };
}

/** An owner statement's totals, as the summary reads them. */
export function summaryFiguresOf(totals: OwnerStatementTotals): SummaryFigures {
  return {
    collected: totals.rentCollected,
    commission: totals.commission,
    commissionTax: totals.commissionTax,
    expenses: totals.expenses,
    investmentRent: totals.investmentRent,
    collectedByOwner: totals.collectedByOwner,
    collectedByOperator: totals.collectedByOperator,
    dueToOwner: totals.dueToOwner,
    dueToOperator: totals.dueToOperator,
  };
}

/**
 * The office that issued the statement: its name and registration numbers on
 * the reading side, its logo on the other — as the printout carries them.
 */
export function StatementLetterheadBlock({
  letterhead,
}: {
  letterhead: StatementLetterhead | null | undefined;
}) {
  const { t } = useLocalizationContext();
  if (!letterhead || (!letterhead.companyName && !letterhead.logoUrl)) {
    return null;
  }

  return (
    <div className="flex items-start justify-between gap-4 border-b pb-4">
      <div className="space-y-0.5">
        {letterhead.companyName && (
          <p className="text-base font-semibold">{letterhead.companyName}</p>
        )}
        {letterhead.commercialRegistration && (
          <p className="text-sm text-muted-foreground">
            {t("exports.document.commercialRegistration", { defaultValue: "CR" })}
            {": "}
            <span className="tabular-nums">{letterhead.commercialRegistration}</span>
          </p>
        )}
        {letterhead.taxNumber && (
          <p className="text-sm text-muted-foreground">
            {t("exports.document.taxNumber", { defaultValue: "VAT" })}
            {": "}
            <span className="tabular-nums">{letterhead.taxNumber}</span>
          </p>
        )}
      </div>
      {letterhead.logoUrl && (
        <Image
          src={letterhead.logoUrl}
          alt={letterhead.companyName}
          width={150}
          height={48}
          unoptimized
          className="h-12 w-auto max-w-[150px] object-contain"
        />
      )}
    </div>
  );
}

/** Whose statement, over what, for which period — the details at the top. */
export function StatementDetailsBlock({
  details,
}: {
  details: Array<{ label: string; value: ReactNode }>;
}) {
  if (details.length === 0) return null;
  return (
    <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {details.map((detail, index) => (
        // Labels can repeat — a statement over two agreements lists both.
        <div key={`${index}-${detail.label}`} className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">{detail.label}:</dt>
          <dd className="font-medium">{detail.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * الملخص — the client's eight rows, in its order and words. The commission's
 * percentage is in its label and nowhere else on the page.
 */
export function StatementSummary({
  figures,
  commissionPercentage,
  className,
}: {
  figures: SummaryFigures;
  commissionPercentage: number | null;
  className?: string;
}) {
  const { t, formatCurrency } = useLocalizationContext();
  const tr = useLineTranslate();
  const rows = statementSummaryRows(figures, commissionPercentage, tr);

  return (
    <div className={className ?? "overflow-hidden rounded-lg border"}>
      <div className="bg-muted px-4 py-2 text-center text-sm font-semibold">
        {t(SUMMARY_TITLE_KEY, { defaultValue: "Summary" })}
      </div>
      <dl className="divide-y text-sm">
        {rows.map((row) => {
          // The closing balance: exactly one of the two carries a figure.
          const closing = row.key === "dueToOwner" || row.key === "dueToOperator";
          const owed = closing && row.amount > 0;
          return (
            <div
              key={row.key}
              className="flex items-center justify-between gap-4 px-4 py-2 odd:bg-muted/30"
            >
              <dt className={closing ? "font-medium" : "text-muted-foreground"}>
                {row.label}
              </dt>
              <dd
                className={
                  owed
                    ? row.key === "dueToOwner"
                      ? "font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
                      : "font-semibold tabular-nums"
                    : "font-medium tabular-nums"
                }
              >
                {formatCurrency(row.amount)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/**
 * Every payment received, one row each — the client's columns: التاريخ،
 * المستأجر، الوحدة، العقد، دورة الإيجار، إجمالي العقد، المستلم، المبلغ،
 * ملاحظة، السند. `leadingColumns` puts more in front (the agreement report adds
 * the agreement); `receiptLinks` opens each payment's receipt from السند,
 * which only the office's own screens can.
 */
export function StatementPaymentsTable<R extends StatementPaymentRow>({
  payments,
  loading,
  leadingColumns = [],
  receiptLinks = false,
}: {
  payments: R[];
  loading: boolean;
  leadingColumns?: DataTableColumn<R>[];
  receiptLinks?: boolean;
}) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const tr = useLineTranslate();
  const paged = usePagedRows(payments);

  const columns: DataTableColumn<R>[] = [
    ...leadingColumns,
    {
      id: "date",
      header: t("clients.statement.payments.date", { defaultValue: "Date" }),
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.date)}</span>,
    },
    {
      id: "tenant",
      header: t("clients.statement.payments.tenant", { defaultValue: "Tenant" }),
      cell: (row) => <span className="font-medium">{row.tenantName}</span>,
    },
    {
      id: "unit",
      header: t("clients.statement.payments.unit", { defaultValue: "Unit" }),
      cell: (row) => paymentUnitText(row) || "—",
    },
    {
      id: "contract",
      header: t("clients.statement.payments.contract", { defaultValue: "Contract" }),
      cell: (row) => row.contractNumber ?? "—",
      visibility: "md",
    },
    {
      id: "cycle",
      header: t("clients.statement.payments.cycle", { defaultValue: "Rent cycle" }),
      cell: (row) => paymentCycleText(row, tr) || "—",
      visibility: "lg",
    },
    {
      id: "contractTotal",
      header: t("clients.statement.payments.contractTotal", {
        defaultValue: "Contract total",
      }),
      cell: (row) =>
        row.contractTotal === null ? "—" : formatCurrency(row.contractTotal),
      visibility: "lg",
    },
    {
      id: "receivedBy",
      header: t("clients.statement.payments.receivedBy", {
        defaultValue: "Received by",
      }),
      cell: (row) => (
        <Badge
          variant={row.receivedBy === "owner" ? "secondary" : "outline"}
          className="font-normal"
        >
          {receivedByText(row, tr)}
        </Badge>
      ),
    },
    {
      id: "amount",
      header: t("clients.statement.payments.amount", { defaultValue: "Amount" }),
      cell: (row) => (
        <span className="font-medium tabular-nums">{formatCurrency(row.amount)}</span>
      ),
    },
    {
      id: "note",
      header: t("clients.statement.payments.note", { defaultValue: "Note" }),
      cell: (row) => {
        const note = paymentNoteText(row, tr);
        return note ? (
          <span className="line-clamp-2 text-muted-foreground" title={note}>
            {note}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
      visibility: "md",
    },
    {
      id: "receipt",
      header: t("clients.statement.payments.receipt", { defaultValue: "Receipt" }),
      cell: (row) =>
        receiptLinks ? (
          <Link
            href={`/dashboard/payments/${row.paymentId}/receipt`}
            className="whitespace-nowrap text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            {row.receiptNumber}
          </Link>
        ) : (
          <span className="whitespace-nowrap text-xs">{row.receiptNumber}</span>
        ),
      visibility: "md",
    },
  ];

  return (
    <DataTable<R>
      columns={columns}
      data={paged.visible}
      pagination={paged.pagination}
      loading={loading}
      getRowKey={(row) => row.paymentId}
      emptyState={{
        icon: <Wallet className="h-10 w-10 text-muted-foreground" />,
        title: t("clients.statement.payments.empty", {
          defaultValue: "No payments were received in this period",
        }),
      }}
    />
  );
}

/** Every expense deducted in the period — the statement's own section. */
export function StatementExpensesTable({
  expenses,
  loading,
}: {
  expenses: StatementExpenseRow[];
  loading: boolean;
}) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const tr = useLineTranslate();
  const paged = usePagedRows(expenses);

  const columns: DataTableColumn<StatementExpenseRow>[] = [
    {
      id: "date",
      header: t("clients.statement.payments.date", { defaultValue: "Date" }),
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.date)}</span>,
    },
    {
      id: "property",
      header: t("clients.statement.expenseRows.property", { defaultValue: "Property" }),
      cell: (row) => row.propertyName || "—",
    },
    {
      id: "item",
      header: t("clients.statement.expenseRows.item", { defaultValue: "Item" }),
      cell: (row) => expenseItemText(row, tr),
    },
    {
      id: "description",
      header: t("clients.statement.expenseRows.description", {
        defaultValue: "Description",
      }),
      cell: (row) => row.description || "—",
      visibility: "md",
    },
    {
      id: "reference",
      header: t("clients.statement.expenseRows.reference", {
        defaultValue: "Reference",
      }),
      cell: (row) => row.reference ?? "—",
      visibility: "lg",
    },
    {
      id: "amount",
      header: t("clients.statement.payments.amount", { defaultValue: "Amount" }),
      cell: (row) => (
        <span className="font-medium tabular-nums">{formatCurrency(row.amount)}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={paged.visible}
      pagination={paged.pagination}
      loading={loading}
      getRowKey={(row) => row.expenseId}
      emptyState={{
        icon: <Receipt className="h-10 w-10 text-muted-foreground" />,
        title: t("clients.statement.expenseRows.empty", {
          defaultValue: "No expenses were deducted in this period",
        }),
      }}
    />
  );
}

/**
 * A statement as one page, in the order the printout has it: letterhead,
 * title, details, summary, then every payment and every expense. The
 * download beside the payments exports exactly this. `children` sits between
 * the summary and the payments — a compound's buildings, a building's units.
 */
export function StatementDocumentLayout({
  letterhead,
  title,
  details,
  figures,
  commissionPercentage,
  payments,
  expenses,
  loading,
  exportEndpoint,
  exportParams,
  receiptLinks = false,
  children,
}: {
  letterhead: StatementLetterhead | null | undefined;
  title: string;
  details: Array<{ label: string; value: ReactNode }>;
  /** Null until the statement has loaded. */
  figures: SummaryFigures | null;
  commissionPercentage: number | null;
  payments: StatementPaymentRow[];
  expenses: StatementExpenseRow[];
  loading: boolean;
  exportEndpoint?: string;
  exportParams?: URLSearchParams;
  receiptLinks?: boolean;
  children?: ReactNode;
}) {
  const { t } = useLocalizationContext();

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <StatementLetterheadBlock letterhead={letterhead} />
        <h2 className="text-center text-lg font-semibold">{title}</h2>
        <StatementDetailsBlock details={details} />

        {figures ? (
          <StatementSummary
            figures={figures}
            commissionPercentage={commissionPercentage}
          />
        ) : (
          loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )
        )}

        {children}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">
              {t("clients.statement.payments.title", { defaultValue: "Payments" })}
            </h3>
            {exportEndpoint && (
              <ReportExportButton
                endpoint={exportEndpoint}
                params={exportParams ?? new URLSearchParams()}
                disabled={loading}
              />
            )}
          </div>
          <StatementPaymentsTable
            payments={payments}
            loading={loading}
            receiptLinks={receiptLinks}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-semibold">
            {t("clients.statement.expenseRows.title", { defaultValue: "Expenses" })}
          </h3>
          <StatementExpensesTable expenses={expenses} loading={loading} />
        </section>
      </CardContent>
    </Card>
  );
}

/** The owner's statement, or an agreement's, as one page — see StatementDocumentLayout. */
export function StatementDocument({
  statement,
  ...layout
}: {
  statement: OwnerStatement | null;
  letterhead: StatementLetterhead | null | undefined;
  title: string;
  details: Array<{ label: string; value: ReactNode }>;
  loading: boolean;
  exportEndpoint?: string;
  exportParams?: URLSearchParams;
  receiptLinks?: boolean;
}) {
  return (
    <StatementDocumentLayout
      {...layout}
      figures={statement ? summaryFiguresOf(statement.totals) : null}
      commissionPercentage={statement?.commissionPercentage ?? null}
      payments={statement?.payments ?? []}
      expenses={statement?.expenses ?? []}
    />
  );
}

/**
 * Whose statement and for which period — the details the owner's statement
 * prints at the top, on screen as in the download.
 */
export function useOwnerStatementDetails(
  statement: OwnerStatement | null,
): Array<{ label: string; value: ReactNode }> {
  const { t, formatDate, formatCurrency } = useLocalizationContext();
  if (!statement) return [];
  return [
    {
      label: t("clients.statement.details.owner", { defaultValue: "Owner" }),
      value: statement.owner.name,
    },
    ...(statement.owner.companyName
      ? [
          {
            label: t("clients.statement.details.company", { defaultValue: "Company" }),
            value: statement.owner.companyName,
          },
        ]
      : []),
    {
      label: t("clients.statement.details.properties", {
        defaultValue: "Properties",
      }),
      value: statement.propertyCount,
    },
    {
      label: t("clients.statement.details.period", { defaultValue: "Period" }),
      value: t("agreements.statement.term", {
        defaultValue: "{start} to {end}",
        values: {
          start: formatDate(statement.period.startDate),
          end: formatDate(statement.period.endDate),
        },
      }),
    },
    // What the commission was charged on, when that is not simply everything
    // collected — so the rate can be checked against it.
    ...(statement.commissionSource === "agreements" &&
    Math.abs(statement.totals.commissionBase - statement.totals.rentCollected) >=
      0.005
      ? [
          {
            label: t("clients.statement.details.commissionBase", {
              defaultValue: "Commission charged on",
            }),
            value: formatCurrency(statement.totals.commissionBase),
          },
        ]
      : []),
  ];
}

/**
 * The rent roll, in the order the statement an owner is used to reads it:
 * when, who, where, for how long, for how much, and how much of it has come in.
 */
export function StatementContractsTable({
  statement,
  loading,
  exportEndpoint,
  exportParams,
}: {
  statement: OwnerStatement | null;
  loading: boolean;
  exportEndpoint: string;
  exportParams: URLSearchParams;
}) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();

  const columns: DataTableColumn<StatementContractRow>[] = [
    {
      id: "date",
      header: t("clients.statement.contracts.date", { defaultValue: "Date" }),
      cell: (row) => formatDate(row.date),
    },
    {
      id: "tenant",
      header: t("clients.statement.contracts.tenant", {
        defaultValue: "Tenant",
      }),
      cell: (row) => (
        <div>
          <div className="font-medium">{row.tenantName}</div>
          {row.contractNumber && (
            <div className="text-xs text-muted-foreground">
              {row.contractNumber}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "unit",
      header: t("clients.statement.contracts.unit", { defaultValue: "Unit" }),
      cell: (row) => (
        <div>
          <div>{row.unitNumber || "—"}</div>
          <div className="text-xs text-muted-foreground">{row.propertyName}</div>
        </div>
      ),
    },
    {
      id: "duration",
      header: t("clients.statement.contracts.duration", {
        defaultValue: "Term",
      }),
      visibility: "md" as const,
      cell: (row) =>
        t("clients.statement.contracts.months", {
          defaultValue: "{count} months",
          values: { count: row.durationMonths },
        }),
    },
    {
      id: "total",
      header: t("clients.statement.contracts.total", {
        defaultValue: "Contract value",
      }),
      cell: (row) => formatCurrency(row.contractTotal),
    },
    {
      id: "due",
      header: t("clients.statement.contracts.due", { defaultValue: "Due" }),
      cell: (row) =>
        row.due > 0 ? (
          <span className="text-destructive">{formatCurrency(row.due)}</span>
        ) : (
          formatCurrency(0)
        ),
    },
    {
      id: "paid",
      header: t("clients.statement.contracts.paid", { defaultValue: "Paid" }),
      cell: (row) => (
        <span className="text-emerald-600 dark:text-emerald-400">
          {formatCurrency(row.paid)}
        </span>
      ),
    },
    {
      id: "notes",
      header: t("clients.statement.contracts.notes", {
        defaultValue: "Notes",
      }),
      visibility: "lg" as const,
      cell: (row) => row.notes || "—",
    },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          {t("clients.statement.contracts.title", {
            defaultValue: "Contracts in this period",
          })}
        </CardTitle>
        <ReportExportButton
          endpoint={exportEndpoint}
          params={exportParams}
          disabled={loading}
        />
      </CardHeader>
      <CardContent>
        <DataTable<StatementContractRow>
          columns={columns}
          data={statement?.contracts ?? []}
          loading={loading}
          getRowKey={(row) => row.leaseId}
        />
      </CardContent>
    </Card>
  );
}
