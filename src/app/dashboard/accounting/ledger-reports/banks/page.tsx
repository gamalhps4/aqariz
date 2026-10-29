"use client";

/**
 * PropertyPro - Banks report (تقرير البنوك)
 *
 * Each of the office's bank, cash, POS and gateway accounts over a period:
 * what it opened with, the money in and out, and what it closed with. Choose
 * one to list its movements with a running balance. Read from the journal
 * (GET /api/accounting/ledger/reports/banks).
 */

import { Suspense, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { replaceQuery, useReportFilters, type FilterValues } from "@/components/reports/use-report-filters";
import { presetRange } from "@/lib/report-filters/period";
import type { BankAccountKind } from "@/lib/accounting/types";
import { Money } from "../../setup/_shared/ledger-parts";
import { BANK_KIND_TEXT, accountName, useLedgerText } from "../../setup/_shared/ledger-ui";
import {
  FigureTiles,
  LedgerReportPage,
  StatementTable,
  periodParams,
  useLedgerReport,
  type ReportAccountRef,
  type StatementData,
} from "../_parts/report-kit";

interface BankRow {
  id: string;
  kind: BankAccountKind;
  name: string;
  bankName: string | null;
  iban: string | null;
  active: boolean;
  ledgerAccount: ReportAccountRef;
  opening: number;
  moneyIn: number;
  moneyOut: number;
  closing: number;
}

interface BankReportResponse {
  period: { from: string | null; to: string | null };
  rows: BankRow[];
  totals: { opening: number; moneyIn: number; moneyOut: number; closing: number };
  movements: (StatementData & { bankAccountId: string }) | null;
}

const ALL = "__all__";

const NO_ROWS: BankRow[] = [];

const FILTERS = {
  defaults: (): FilterValues => ({ ...presetRange("this-month"), bankAccountId: "" }),
};

const FIELDS: ReportFilterField[] = [{ kind: "period", startKey: "startDate", endKey: "endDate", presets: true }];

export default function BanksReportPage() {
  return (
    <Suspense fallback={null}>
      <BanksReport />
    </Suspense>
  );
}

function BanksReport() {
  const { tx, text, language } = useLedgerText();
  const filters = useReportFilters(FILTERS);
  const { draft, applied, setField } = filters;

  const params = useMemo(() => {
    const query = periodParams(applied);
    if (applied.bankAccountId) query.set("bankAccountId", applied.bankAccountId);
    return query;
  }, [applied]);
  const report = useLedgerReport<BankReportResponse>("banks", params);
  const data = report.data;
  const nameOf = (row: BankRow) => row.name || accountName(row.ledgerAccount, language);
  // The accounts sort; the totals stay in the footer. The movements below
  // keep their date order — each line's balance runs on from the one above.
  const sort = useTableSort(data?.rows ?? NO_ROWS, {
    account: nameOf,
    kind: (row) => text(BANK_KIND_TEXT[row.kind]),
    opening: (row) => row.opening,
    moneyIn: (row) => row.moneyIn,
    moneyOut: (row) => row.moneyOut,
    closing: (row) => row.closing,
  });
  const selected = data?.movements ? data.rows.find((row) => row.id === data.movements!.bankAccountId) : null;

  return (
    <LedgerReportPage
      report="banks"
      title={tx("ledger.reports.banks.title", "Banks report")}
      subtitle={tx(
        "ledger.reports.banks.subtitle",
        "Each bank, cash, POS and gateway account: opening balance, money in and out, closing balance",
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
          fields={FIELDS}
          leading={
            <div className="w-full min-w-[220px] space-y-1.5 sm:w-auto">
              <Label>{tx("ledger.reports.banks.movementsOf", "Movements of")}</Label>
              <Select
                value={draft.bankAccountId || ALL}
                onValueChange={(value) => setField({ bankAccountId: value === ALL ? "" : value })}
              >
                <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{tx("ledger.reports.banks.noMovements", "Balances only")}</SelectItem>
                  {(data?.rows ?? []).map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {nameOf(row)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
      }
    >
      {data && (
        <>
          <FigureTiles
            items={[
              { label: tx("ledger.reports.openingBalance", "Opening balance"), value: data.totals.opening },
              { label: tx("ledger.reports.moneyIn", "Money in"), value: data.totals.moneyIn },
              { label: tx("ledger.reports.moneyOut", "Money out"), value: data.totals.moneyOut },
              { label: tx("ledger.reports.closingBalance", "Closing balance"), value: data.totals.closing },
            ]}
          />
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead sort={sort} column="account">
                        {tx("ledger.reports.col.account", "Account")}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="kind">
                        {tx("ledger.reports.col.kind", "Kind")}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="opening" className="text-end">
                        {tx("ledger.reports.openingBalance", "Opening balance")}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="moneyIn" className="text-end">
                        {tx("ledger.reports.moneyIn", "Money in")}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="moneyOut" className="text-end">
                        {tx("ledger.reports.moneyOut", "Money out")}
                      </SortableTableHead>
                      <SortableTableHead sort={sort} column="closing" className="text-end">
                        {tx("ledger.reports.closingBalance", "Closing balance")}
                      </SortableTableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                          {tx("ledger.reports.banks.none", "No bank or cash accounts yet")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      sort.rows.map((row) => (
                        <TableRow key={row.id} className={row.id === selected?.id ? "bg-muted/40" : undefined}>
                          <TableCell className="text-sm">
                            <div className="font-medium">{nameOf(row)}</div>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {row.ledgerAccount.code}
                              {row.bankName ? ` · ${row.bankName}` : ""}
                              {row.iban ? ` · ${row.iban}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{text(BANK_KIND_TEXT[row.kind])}</TableCell>
                          <TableCell className="text-end tabular-nums"><Money value={row.opening} /></TableCell>
                          <TableCell className="text-end tabular-nums"><Money value={row.moneyIn} /></TableCell>
                          <TableCell className="text-end tabular-nums"><Money value={row.moneyOut} /></TableCell>
                          <TableCell className="text-end font-medium tabular-nums"><Money value={row.closing} /></TableCell>
                          <TableCell className="text-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => replaceQuery({ bankAccountId: row.id })}
                            >
                              {tx("ledger.reports.banks.showMovements", "Movements")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={2} className="font-semibold">{tx("ledger.reports.total", "Total")}</TableCell>
                      <TableCell className="text-end font-semibold tabular-nums"><Money value={data.totals.opening} /></TableCell>
                      <TableCell className="text-end font-semibold tabular-nums"><Money value={data.totals.moneyIn} /></TableCell>
                      <TableCell className="text-end font-semibold tabular-nums"><Money value={data.totals.moneyOut} /></TableCell>
                      <TableCell className="text-end font-semibold tabular-nums"><Money value={data.totals.closing} /></TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </CardContent>
          </Card>
          {data.movements && selected && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">
                {tx("ledger.reports.banks.movementsTitle", "Movements: {name}", { name: nameOf(selected) })}
              </h2>
              <StatementTable data={data.movements} />
            </div>
          )}
        </>
      )}
    </LedgerReportPage>
  );
}
