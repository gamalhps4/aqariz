"use client";

/**
 * PropertyPro - What the ledger's report screens share
 *
 * The request (one route, /api/accounting/ledger/reports/<report>, run with
 * the filters last applied), the page around a report — its header and
 * export, and the states before it: no access, no books yet, a refusal —
 * and the tables the reports are drawn in: a statement with its running
 * balance, and accounts under their headings.
 */

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportExportButton } from "@/components/reports/export-button";
import { SortableTableHead, type TableSortState } from "@/components/ui/sortable-table";
import { nextSort, type SortDirection, type SortValue } from "@/lib/table-sort";
import { sortTreeRows } from "@/lib/table-sort-tree";
import type { SourceType } from "@/lib/accounting/types";
import {
  LedgerHeader,
  LedgerNotSetUp,
  Money,
  NoLedgerAccess,
} from "../../setup/_shared/ledger-parts";
import {
  SOURCE_TYPE_TEXT,
  accountName,
  ledgerRequest,
  useLedgerAccess,
  useLedgerError,
  useLedgerText,
} from "../../setup/_shared/ledger-ui";
import { describeCharge } from "@/lib/i18n/charge-description";

export type LedgerReportName =
  | "account-statement"
  | "party-statement"
  | "trial-balance"
  | "profit-loss"
  | "balance-sheet"
  | "banks"
  | "vat-return";

export interface ReportAccountRef {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
}

/**
 * Run a report with these parameters — or nothing yet, while `params` is
 * null (a statement with no account chosen).
 */
export function useLedgerReport<T>(report: LedgerReportName, params: URLSearchParams | null) {
  const describeError = useLedgerError();
  const query = params?.toString() ?? null;
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    code: string | null;
    error: string | null;
  }>({ data: null, loading: query !== null, code: null, error: null });

  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    void (async () => {
      setState((current) => ({ ...current, loading: true }));
      const response = await ledgerRequest<T>(`/reports/${report}?${query}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setState(
        response.ok
          ? { data: response.data, loading: false, code: null, error: null }
          : { data: null, loading: false, code: response.code, error: describeError(response) },
      );
    })();
    return () => controller.abort();
  }, [report, query, describeError]);

  return state;
}

/** The page around a report: header, export, filters, and the states before it. */
export function LedgerReportPage({
  report,
  title,
  subtitle,
  params,
  filters,
  state,
  children,
}: {
  report: LedgerReportName;
  title: string;
  subtitle: string;
  /** What the export runs with: the applied filters (null: nothing to export yet). */
  params: URLSearchParams | null;
  filters: ReactNode;
  state: { loading: boolean; code: string | null; error: string | null; hasData: boolean };
  children: ReactNode;
}) {
  const access = useLedgerAccess();

  if (!access.loading && !access.canView) {
    return (
      <div className="space-y-6">
        <LedgerHeader title={title} subtitle={subtitle} />
        <NoLedgerAccess />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <LedgerHeader
        title={title}
        subtitle={subtitle}
        actions={
          <ReportExportButton
            endpoint={`/api/accounting/ledger/reports/${report}`}
            params={params ?? new URLSearchParams()}
            disabled={!params || !state.hasData}
          />
        }
      />
      {filters}
      {state.code === "LEDGER_NOT_SET_UP" ? (
        <LedgerNotSetUp canManage={access.canManage} />
      ) : state.error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">{state.error}</CardContent>
        </Card>
      ) : state.loading && !state.hasData ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className={state.loading ? "space-y-6 opacity-60 transition-opacity" : "space-y-6"}>{children}</div>
      )}
    </div>
  );
}

/** A row of figures above a report. */
export function FigureTiles({ items }: { items: Array<{ label: string; value: number; tone?: "good" | "bad" }> }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p
            className={`mt-1 text-xl font-semibold tabular-nums ${
              item.tone === "bad" ? "text-destructive" : item.tone === "good" ? "text-emerald-600 dark:text-emerald-400" : ""
            }`}
          >
            <Money value={item.value} />
          </p>
        </div>
      ))}
    </div>
  );
}

/** Whether the books agree with themselves: debits equal credits, assets equal claims. */
export function BalancedBadge({ balanced }: { balanced: boolean }) {
  const { tx } = useLedgerText();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        balanced
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
      }`}
    >
      {balanced
        ? tx("ledger.reports.balanced", "Balanced")
        : tx("ledger.reports.notBalanced", "Does not balance")}
    </span>
  );
}

export interface StatementLine {
  id: string;
  date: string;
  entryId: string;
  entryNumber: number;
  sourceType: string;
  sourceRef: string | null;
  memo: string | null;
  account: ReportAccountRef | null;
  partyName: string | null;
  propertyName: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface StatementData {
  opening: number;
  closing: number;
  totals: { debit: number; credit: number };
  truncated: boolean;
  rows: StatementLine[];
}

/**
 * An account's or a party's lines, with the balance after each.
 *
 * Its headers do not sort, unlike the other report tables: each line's
 * balance is the running total of the lines above it, so any order but the
 * date's would leave that column adding up to nothing.
 */
export function StatementTable({
  data,
  showAccount = false,
  showParty = true,
}: {
  data: StatementData;
  showAccount?: boolean;
  showParty?: boolean;
}) {
  const { tx, text, language, formatDate } = useLedgerText();
  const sourceText = (type: string) => {
    const entry = SOURCE_TYPE_TEXT[type as SourceType];
    return entry ? text(entry) : type;
  };
  const columns = 7 + (showAccount ? 1 : 0) + (showParty ? 1 : 0);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tx("ledger.reports.col.date", "Date")}</TableHead>
                <TableHead>{tx("ledger.reports.col.entry", "Entry")}</TableHead>
                {showAccount && <TableHead>{tx("ledger.reports.col.account", "Account")}</TableHead>}
                <TableHead>{tx("ledger.reports.col.description", "Description")}</TableHead>
                {showParty && <TableHead>{tx("ledger.reports.col.party", "Party")}</TableHead>}
                <TableHead>{tx("ledger.reports.col.building", "Building")}</TableHead>
                <TableHead className="text-end">{tx("ledger.reports.col.debit", "Debit")}</TableHead>
                <TableHead className="text-end">{tx("ledger.reports.col.credit", "Credit")}</TableHead>
                <TableHead className="text-end">{tx("ledger.reports.col.balance", "Balance")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40">
                <TableCell colSpan={columns - 1} className="font-medium">
                  {tx("ledger.reports.openingBalance", "Opening balance")}
                </TableCell>
                <TableCell className="text-end font-medium tabular-nums">
                  <Money value={data.opening} />
                </TableCell>
              </TableRow>
              {data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns} className="py-8 text-center text-sm text-muted-foreground">
                    {tx("ledger.reports.noEntries", "No entries in this period")}
                  </TableCell>
                </TableRow>
              ) : (
                data.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDate(row.date)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link
                        href={`/dashboard/accounting/journals/${row.entryId}`}
                        className="font-medium text-primary hover:underline tabular-nums"
                      >
                        #{row.entryNumber}
                      </Link>
                    </TableCell>
                    {showAccount && (
                      <TableCell className="whitespace-nowrap text-sm">
                        {row.account ? `${row.account.code} — ${accountName(row.account, language)}` : "—"}
                      </TableCell>
                    )}
                    <TableCell className="min-w-[200px] text-sm">
                      <span className="text-muted-foreground">{sourceText(row.sourceType)}</span>
                      {row.sourceRef ? <span className="ms-1 font-medium">{row.sourceRef}</span> : null}
                      {row.memo ? (
                        <div className="text-xs text-muted-foreground">
                          {describeCharge({ description: row.memo }, language)}
                        </div>
                      ) : null}
                    </TableCell>
                    {showParty && <TableCell className="text-sm">{row.partyName ?? "—"}</TableCell>}
                    <TableCell className="text-sm">{row.propertyName ?? "—"}</TableCell>
                    <TableCell className="text-end tabular-nums">
                      {row.debit ? <Money value={row.debit} /> : ""}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {row.credit ? <Money value={row.credit} /> : ""}
                    </TableCell>
                    <TableCell className="text-end font-medium tabular-nums">
                      <Money value={row.balance} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={columns - 3} className="font-semibold">
                  {tx("ledger.reports.closingBalance", "Closing balance")}
                </TableCell>
                <TableCell className="text-end font-semibold tabular-nums">
                  <Money value={data.totals.debit} />
                </TableCell>
                <TableCell className="text-end font-semibold tabular-nums">
                  <Money value={data.totals.credit} />
                </TableCell>
                <TableCell className="text-end font-semibold tabular-nums">
                  <Money value={data.closing} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        {data.truncated && (
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            {tx(
              "ledger.reports.truncated",
              "Only the first 5,000 lines are listed; the totals and the closing balance cover the whole period. Narrow the period to see the rest.",
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export interface TreeLine {
  account: ReportAccountRef;
  depth: number;
  heading: boolean;
  amount: number;
}

const TREE_SORT_COLUMNS: Record<string, (row: TreeLine, language: string) => SortValue> = {
  account: (row, language) => accountName(row.account, language),
  amount: (row) => row.amount,
};

/**
 * Accounts under their headings, with a total line under them.
 *
 * A header click sorts the accounts under each heading among themselves,
 * each taking its own sub-accounts along (lib/table-sort-tree): the tree
 * stays a tree. The lines after the accounts and the total keep their place.
 */
export function AccountTreeTable({
  title,
  rows,
  totalLabel,
  total,
  extraRows,
  statementLinks = false,
}: {
  title: string;
  rows: TreeLine[];
  totalLabel: string;
  total: number;
  /** Lines after the accounts and before the total (the profit to date). */
  extraRows?: Array<{ label: string; amount: number }>;
  /** Link each account to its general statement. */
  statementLinks?: boolean;
}) {
  const { tx, language } = useLedgerText();
  const [order, setOrder] = useState<{ key: string | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });
  const sort: TableSortState = {
    ...order,
    toggle: (column) => setOrder((current) => nextSort(current, column)),
  };
  const sortedRows = useMemo(() => {
    const valueOf = order.key ? TREE_SORT_COLUMNS[order.key] : undefined;
    if (!valueOf) return rows;
    return sortTreeRows(
      rows,
      (row) => row.depth,
      (row) => valueOf(row, language),
      order.direction,
      language,
    );
  }, [rows, order, language]);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTableHead sort={sort} column="account">
                {tx("ledger.reports.col.account", "Account")}
              </SortableTableHead>
              <SortableTableHead sort={sort} column="amount" className="text-end">
                {tx("ledger.reports.col.amount", "Amount")}
              </SortableTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !extraRows?.length ? (
              <TableRow>
                <TableCell colSpan={2} className="py-6 text-center text-sm text-muted-foreground">
                  {tx("ledger.reports.noEntries", "No entries in this period")}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((row) => (
                <TableRow key={row.account.id} className={row.heading ? "bg-muted/30" : undefined}>
                  <TableCell
                    className={row.heading ? "font-semibold" : "text-sm"}
                    style={{ paddingInlineStart: `${1 + row.depth * 1.25}rem` }}
                  >
                    <span className="me-2 text-muted-foreground tabular-nums">{row.account.code}</span>
                    {statementLinks && !row.heading ? (
                      <Link
                        href={`/dashboard/accounting/ledger-reports/account-statement?accountId=${row.account.id}`}
                        className="hover:underline"
                      >
                        {accountName(row.account, language)}
                      </Link>
                    ) : (
                      accountName(row.account, language)
                    )}
                  </TableCell>
                  <TableCell className={`text-end tabular-nums ${row.heading ? "font-semibold" : ""}`}>
                    <Money value={row.amount} />
                  </TableCell>
                </TableRow>
              ))
            )}
            {extraRows?.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="text-sm italic">{row.label}</TableCell>
                <TableCell className="text-end tabular-nums">
                  <Money value={row.amount} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">{totalLabel}</TableCell>
              <TableCell className="text-end font-semibold tabular-nums">
                <Money value={total} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

/** "From … to …" as the request reads it, from the filter bar's dates. */
export function periodParams(values: { startDate?: string; endDate?: string }): URLSearchParams {
  const params = new URLSearchParams();
  if (values.startDate) params.set("from", values.startDate);
  if (values.endDate) params.set("to", values.endDate);
  return params;
}
