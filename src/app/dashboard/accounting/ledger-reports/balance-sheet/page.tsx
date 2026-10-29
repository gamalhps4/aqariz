"use client";

/**
 * PropertyPro - Balance sheet (قائمة المركز المالي)
 *
 * What the office holds and owes at the end of a day: its assets, its
 * liabilities — owners' money among them — and its equity. The books are not
 * closed into retained earnings at a year's end, so the profit or loss to
 * date stands in equity as its own line, and assets equal liabilities plus
 * equity. Read from the journal (GET /api/accounting/ledger/reports/
 * balance-sheet).
 */

import { Suspense, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReportFilterBar } from "@/components/reports/report-filter-bar";
import { useReportFilters, type FilterValues } from "@/components/reports/use-report-filters";
import { localDay } from "@/lib/report-filters/period";
import { Money } from "../../setup/_shared/ledger-parts";
import { useLedgerText } from "../../setup/_shared/ledger-ui";
import {
  AccountTreeTable,
  BalancedBadge,
  FigureTiles,
  LedgerReportPage,
  useLedgerReport,
  type TreeLine,
} from "../_parts/report-kit";

interface BalanceSheetResponse {
  asOf: string;
  assets: TreeLine[];
  liabilities: TreeLine[];
  equity: TreeLine[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  profitToDate: number;
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
}

const FILTERS = {
  defaults: (): FilterValues => ({ asOf: localDay(new Date()) }),
};

export default function BalanceSheetPage() {
  return (
    <Suspense fallback={null}>
      <BalanceSheet />
    </Suspense>
  );
}

function BalanceSheet() {
  const { tx } = useLedgerText();
  const filters = useReportFilters(FILTERS);
  const { draft, applied, setField } = filters;

  const params = useMemo(() => {
    const query = new URLSearchParams();
    if (applied.asOf) query.set("asOf", applied.asOf);
    return query;
  }, [applied]);
  const report = useLedgerReport<BalanceSheetResponse>("balance-sheet", params);
  const data = report.data;

  return (
    <LedgerReportPage
      report="balance-sheet"
      title={tx("ledger.reports.balanceSheet.title", "Balance sheet")}
      subtitle={tx(
        "ledger.reports.balanceSheet.subtitle",
        "Assets, liabilities and equity at the end of the day chosen",
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
          fields={[]}
          leading={
            <div className="w-full space-y-1.5 sm:w-auto">
              <Label htmlFor="balance-sheet-as-of">{tx("ledger.reports.asOf", "As at")}</Label>
              <Input
                id="balance-sheet-as-of"
                type="date"
                className="h-10 bg-white dark:bg-gray-800"
                value={draft.asOf}
                onChange={(event) => setField({ asOf: event.target.value })}
              />
            </div>
          }
        />
      }
    >
      {data && (
        <>
          <div className="flex items-center gap-3">
            <BalancedBadge balanced={data.balanced} />
          </div>
          <FigureTiles
            items={[
              { label: tx("ledger.reports.totalAssets", "Total assets"), value: data.totalAssets },
              { label: tx("ledger.reports.totalLiabilities", "Total liabilities"), value: data.totalLiabilities },
              { label: tx("ledger.reports.totalEquity", "Total equity"), value: data.totalEquity },
              {
                label: tx("ledger.reports.profitToDate", "Profit and loss to date"),
                value: data.profitToDate,
                tone: data.profitToDate < 0 ? "bad" : undefined,
              },
            ]}
          />
          <AccountTreeTable
            title={tx("ledger.reports.assets", "Assets")}
            rows={data.assets}
            totalLabel={tx("ledger.reports.totalAssets", "Total assets")}
            total={data.totalAssets}
            statementLinks
          />
          <AccountTreeTable
            title={tx("ledger.reports.liabilities", "Liabilities")}
            rows={data.liabilities}
            totalLabel={tx("ledger.reports.totalLiabilities", "Total liabilities")}
            total={data.totalLiabilities}
            statementLinks
          />
          <AccountTreeTable
            title={tx("ledger.reports.equity", "Equity")}
            rows={data.equity}
            extraRows={[
              { label: tx("ledger.reports.profitToDate", "Profit and loss to date"), amount: data.profitToDate },
            ]}
            totalLabel={tx("ledger.reports.totalEquityWithProfit", "Total equity, with the profit to date")}
            total={data.totalEquity + data.profitToDate}
            statementLinks
          />
          <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm font-semibold">
            <span>{tx("ledger.reports.totalLiabilitiesAndEquity", "Total liabilities and equity")}</span>
            <Money value={data.totalLiabilitiesAndEquity} className="tabular-nums" />
          </div>
        </>
      )}
    </LedgerReportPage>
  );
}
