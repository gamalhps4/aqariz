"use client";

/**
 * PropertyPro - Profit and loss (قائمة الدخل)
 *
 * The office's own income and costs over a period, account by account under
 * their headings: commission and fees, the rent of its own and invested
 * buildings, other income; its expenses. An owner's rent is not income here —
 * the books hold it for the owner — so this is the office's result, not the
 * portfolio's. Narrowed to a building, it is what that building brought the
 * office. Read from the journal (GET /api/accounting/ledger/reports/
 * profit-loss).
 */

import { Suspense, useMemo } from "react";
import { ReportFilterBar, type ReportFilterField } from "@/components/reports/report-filter-bar";
import { useReportFilters, type FilterValues } from "@/components/reports/use-report-filters";
import { useReportFilterOptions } from "@/components/reports/use-report-filter-options";
import { yearToDate } from "@/lib/report-filters/period";
import { useLedgerText } from "../../setup/_shared/ledger-ui";
import {
  AccountTreeTable,
  FigureTiles,
  LedgerReportPage,
  periodParams,
  useLedgerReport,
  type TreeLine,
} from "../_parts/report-kit";

interface ProfitAndLossResponse {
  period: { from: string | null; to: string | null };
  income: TreeLine[];
  expenses: TreeLine[];
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
}

const FILTERS = {
  defaults: (): FilterValues => ({ ...yearToDate(), propertyId: "" }),
};

const FIELDS: ReportFilterField[] = [
  { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
  { kind: "entity", entity: "building" },
];

const OPTION_LISTS = ["buildings"] as const;

export default function ProfitAndLossPage() {
  return (
    <Suspense fallback={null}>
      <ProfitAndLoss />
    </Suspense>
  );
}

function ProfitAndLoss() {
  const { tx } = useLedgerText();
  const filters = useReportFilters(FILTERS);
  const { draft, applied, setField } = filters;
  const { options, loading, failed } = useReportFilterOptions(OPTION_LISTS);

  const params = useMemo(() => {
    const query = periodParams(applied);
    if (applied.propertyId) query.set("propertyId", applied.propertyId);
    return query;
  }, [applied]);
  const report = useLedgerReport<ProfitAndLossResponse>("profit-loss", params);
  const data = report.data;

  return (
    <LedgerReportPage
      report="profit-loss"
      title={tx("ledger.reports.profitLoss.title", "Profit and loss")}
      subtitle={tx(
        "ledger.reports.profitLoss.subtitle",
        "The office's own income less its expenses over the period, by account",
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
          options={options}
          optionsLoading={loading}
          optionsFailed={failed}
        />
      }
    >
      {data && (
        <>
          <FigureTiles
            items={[
              { label: tx("ledger.reports.totalIncome", "Total income"), value: data.totalIncome },
              { label: tx("ledger.reports.totalExpenses", "Total expenses"), value: data.totalExpenses },
              {
                label:
                  data.netProfit < 0
                    ? tx("ledger.reports.netLoss", "Net loss")
                    : tx("ledger.reports.netProfit", "Net profit"),
                value: data.netProfit,
                tone: data.netProfit < 0 ? "bad" : "good",
              },
            ]}
          />
          <AccountTreeTable
            title={tx("ledger.reports.income", "Income")}
            rows={data.income}
            totalLabel={tx("ledger.reports.totalIncome", "Total income")}
            total={data.totalIncome}
            statementLinks
          />
          <AccountTreeTable
            title={tx("ledger.reports.expenses", "Expenses")}
            rows={data.expenses}
            totalLabel={tx("ledger.reports.totalExpenses", "Total expenses")}
            total={data.totalExpenses}
            statementLinks
          />
        </>
      )}
    </LedgerReportPage>
  );
}
