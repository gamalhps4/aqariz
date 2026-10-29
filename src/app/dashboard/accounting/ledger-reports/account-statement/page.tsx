"use client";

/**
 * PropertyPro - General account statement (كشف حساب عام)
 *
 * One account of the chart over a period: the balance it opened on, every
 * line posted to it with the entry it belongs to and the balance after it,
 * and where it closed. Narrowed to a building, it is that building's share of
 * the account. Read from the journal (GET /api/accounting/ledger/reports/
 * account-statement); the chart of accounts and the other reports link here
 * with `?accountId=`.
 */

import { Suspense, useMemo } from "react";
import { ScrollText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ReportFilterBar, type ReportFilterField } from "@/components/reports/report-filter-bar";
import { useReportFilters, type FilterValues } from "@/components/reports/use-report-filters";
import { useReportFilterOptions } from "@/components/reports/use-report-filter-options";
import { presetRange } from "@/lib/report-filters/period";
import { AccountPicker } from "../../setup/_shared/ledger-parts";
import { accountName, useLedgerText } from "../../setup/_shared/ledger-ui";
import { useLedgerAccounts } from "../../setup/_shared/use-ledger-data";
import {
  FigureTiles,
  LedgerReportPage,
  StatementTable,
  periodParams,
  useLedgerReport,
  type ReportAccountRef,
  type StatementData,
} from "../_parts/report-kit";

interface AccountStatementResponse extends StatementData {
  account: ReportAccountRef & { normalSide: string };
  period: { from: string | null; to: string | null };
}

const FILTERS = {
  defaults: (): FilterValues => ({ ...presetRange("this-month"), accountId: "", propertyId: "" }),
};

const FIELDS: ReportFilterField[] = [
  { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
  { kind: "entity", entity: "building" },
];

const OPTION_LISTS = ["buildings"] as const;

export default function AccountStatementPage() {
  // useSearchParams needs a boundary of its own under the dashboard layout.
  return (
    <Suspense fallback={null}>
      <AccountStatement />
    </Suspense>
  );
}

function AccountStatement() {
  const { tx, language } = useLedgerText();
  const filters = useReportFilters(FILTERS);
  const { draft, applied, setField } = filters;
  const { options, loading, failed } = useReportFilterOptions(OPTION_LISTS);
  const { accounts, loading: accountsLoading, error: accountsError } = useLedgerAccounts();
  // No chart at all: the office has not set accounting up yet.
  const noBooks = !accountsLoading && !accountsError && accounts.length === 0;

  const params = useMemo(() => {
    if (!applied.accountId) return null;
    const query = periodParams(applied);
    query.set("accountId", applied.accountId);
    if (applied.propertyId) query.set("propertyId", applied.propertyId);
    return query;
  }, [applied]);
  const report = useLedgerReport<AccountStatementResponse>("account-statement", params);
  const data = params ? report.data : null;

  return (
    <LedgerReportPage
      report="account-statement"
      title={tx("ledger.reports.accountStatement.title", "General account statement")}
      subtitle={tx(
        "ledger.reports.accountStatement.subtitle",
        "Every posting to one account over the period, with its running balance",
      )}
      params={params}
      state={{
        ...report,
        code: noBooks ? "LEDGER_NOT_SET_UP" : report.code,
        loading: params ? report.loading : false,
        hasData: Boolean(data),
      }}
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
          leading={
            <div className="w-full min-w-[260px] space-y-1.5 sm:w-auto">
              <Label>{tx("ledger.reports.col.account", "Account")}</Label>
              <AccountPicker
                accounts={accounts}
                value={draft.accountId}
                onChange={(accountId) => setField({ accountId })}
                includeInactive
                className="h-10 bg-white dark:bg-gray-800"
              />
            </div>
          }
        />
      }
    >
      {!params ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <ScrollText className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {tx("ledger.reports.accountStatement.pick", "Choose an account and apply to see its statement.")}
            </p>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <p className="text-sm font-medium">
            {data.account.code} — {accountName(data.account, language)}
          </p>
          <FigureTiles
            items={[
              { label: tx("ledger.reports.openingBalance", "Opening balance"), value: data.opening },
              { label: tx("ledger.reports.totalDebit", "Total debit"), value: data.totals.debit },
              { label: tx("ledger.reports.totalCredit", "Total credit"), value: data.totals.credit },
              { label: tx("ledger.reports.closingBalance", "Closing balance"), value: data.closing },
            ]}
          />
          <StatementTable data={data} />
        </>
      ) : null}
    </LedgerReportPage>
  );
}
