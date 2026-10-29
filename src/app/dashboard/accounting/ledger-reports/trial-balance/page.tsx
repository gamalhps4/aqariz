"use client";

/**
 * PropertyPro - Trial balance (ميزان المراجعة)
 *
 * Every account's balance at the start of the period, what moved through it
 * and its balance at the end, each as a debit or a credit — and the check
 * that holds the books together: each pair of columns adds up to the same
 * total. Read from the journal (GET /api/accounting/ledger/reports/
 * trial-balance); each account opens its general statement.
 */

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportFilterBar, type ReportFilterField } from "@/components/reports/report-filter-bar";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";
import { useReportFilters, type FilterValues } from "@/components/reports/use-report-filters";
import { presetRange } from "@/lib/report-filters/period";
import { Money } from "../../setup/_shared/ledger-parts";
import { accountName, useLedgerText } from "../../setup/_shared/ledger-ui";
import {
  BalancedBadge,
  LedgerReportPage,
  periodParams,
  useLedgerReport,
  type ReportAccountRef,
} from "../_parts/report-kit";

type Pair = { debit: number; credit: number };
type TrialBalanceRow = TrialBalanceResponse["rows"][number];

interface TrialBalanceResponse {
  period: { from: string | null; to: string | null };
  balanced: boolean;
  totals: { opening: Pair; period: Pair; closing: Pair };
  rows: Array<{ account: ReportAccountRef & { type: string }; opening: Pair; period: Pair; closing: Pair }>;
}

const NO_ROWS: TrialBalanceRow[] = [];

/** A figure the table leaves blank (zero) sorts as blank: last, both ways. */
const figure = (value: number) => value || null;

const FILTERS = {
  defaults: (): FilterValues => ({ ...presetRange("this-month"), includeZero: "" }),
};

export default function TrialBalancePage() {
  return (
    <Suspense fallback={null}>
      <TrialBalance />
    </Suspense>
  );
}

function TrialBalance() {
  const { tx, language } = useLedgerText();
  const filters = useReportFilters(FILTERS);
  const { draft, applied, setField } = filters;
  const fields: ReportFilterField[] = [
    { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
    { kind: "toggle", key: "includeZero", label: tx("ledger.reports.includeZero", "Show accounts with no balance") },
  ];

  const params = useMemo(() => {
    const query = periodParams(applied);
    if (applied.includeZero === "true") query.set("includeZero", "true");
    return query;
  }, [applied]);
  const report = useLedgerReport<TrialBalanceResponse>("trial-balance", params);
  const data = report.data;
  // The accounts sort; the totals stay in the footer, under them.
  const sort = useTableSort(data?.rows ?? NO_ROWS, {
    account: (row) => accountName(row.account, language),
    openingDebit: (row) => figure(row.opening.debit),
    openingCredit: (row) => figure(row.opening.credit),
    periodDebit: (row) => figure(row.period.debit),
    periodCredit: (row) => figure(row.period.credit),
    closingDebit: (row) => figure(row.closing.debit),
    closingCredit: (row) => figure(row.closing.credit),
  });

  const cell = (value: number) => (value ? <Money value={value} /> : "");

  return (
    <LedgerReportPage
      report="trial-balance"
      title={tx("ledger.reports.trialBalance.title", "Trial balance")}
      subtitle={tx(
        "ledger.reports.trialBalance.subtitle",
        "Each account's opening balance, movement and closing balance over the period",
      )}
      params={params}
      state={{ ...report, hasData: Boolean(data) }}
      filters={
        <ReportFilterBar
          values={draft}
          onChange={setField}
          onApply={filters.apply}
          onReset={filters.reset}
          pending={filters.pending}
          canReset={filters.canReset}
          fields={fields}
        />
      }
    >
      {data && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-base font-semibold">
                {tx("ledger.reports.trialBalance.title", "Trial balance")}
              </h2>
              <BalancedBadge balanced={data.balanced} />
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead sort={sort} column="account" rowSpan={2}>
                      {tx("ledger.reports.col.account", "Account")}
                    </SortableTableHead>
                    <TableHead colSpan={2} className="text-center">
                      {tx("ledger.reports.openingBalance", "Opening balance")}
                    </TableHead>
                    <TableHead colSpan={2} className="text-center">
                      {tx("ledger.reports.movement", "Movement")}
                    </TableHead>
                    <TableHead colSpan={2} className="text-center">
                      {tx("ledger.reports.closingBalance", "Closing balance")}
                    </TableHead>
                  </TableRow>
                  <TableRow>
                    {(["opening", "period", "closing"] as const).flatMap((group) => [
                      <SortableTableHead key={`d${group}`} sort={sort} column={`${group}Debit`} className="text-end">
                        {tx("ledger.reports.col.debit", "Debit")}
                      </SortableTableHead>,
                      <SortableTableHead key={`c${group}`} sort={sort} column={`${group}Credit`} className="text-end">
                        {tx("ledger.reports.col.credit", "Credit")}
                      </SortableTableHead>,
                    ])}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        {tx("ledger.reports.noEntries", "No entries in this period")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sort.rows.map((row) => (
                      <TableRow key={row.account.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          <span className="me-2 text-muted-foreground tabular-nums">{row.account.code}</span>
                          <Link
                            className="hover:underline"
                            href={`/dashboard/accounting/ledger-reports/account-statement?accountId=${row.account.id}${
                              applied.startDate ? `&startDate=${applied.startDate}` : ""
                            }${applied.endDate ? `&endDate=${applied.endDate}` : ""}`}
                          >
                            {accountName(row.account, language)}
                          </Link>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">{cell(row.opening.debit)}</TableCell>
                        <TableCell className="text-end tabular-nums">{cell(row.opening.credit)}</TableCell>
                        <TableCell className="text-end tabular-nums">{cell(row.period.debit)}</TableCell>
                        <TableCell className="text-end tabular-nums">{cell(row.period.credit)}</TableCell>
                        <TableCell className="text-end tabular-nums">{cell(row.closing.debit)}</TableCell>
                        <TableCell className="text-end tabular-nums">{cell(row.closing.credit)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">{tx("ledger.reports.total", "Total")}</TableCell>
                    {[data.totals.opening, data.totals.period, data.totals.closing].flatMap((pair, index) => [
                      <TableCell key={`d${index}`} className="text-end font-semibold tabular-nums">
                        <Money value={pair.debit} />
                      </TableCell>,
                      <TableCell key={`c${index}`} className="text-end font-semibold tabular-nums">
                        <Money value={pair.credit} />
                      </TableCell>,
                    ])}
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </LedgerReportPage>
  );
}
