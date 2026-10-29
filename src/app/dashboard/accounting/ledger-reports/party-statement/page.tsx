"use client";

/**
 * PropertyPro - Party statement (كشف حساب عميل)
 *
 * A tenant's, an owner's, a customer's or a supplier's account with the
 * office, from their sub-ledger in the books: a tenant's and a customer's
 * receivable (what they owe), an owner's payable less what they owe on
 * invoices raised to them, a supplier's payable (what the office owes them).
 * The picker lists everyone the books hold lines for, with their balance
 * (GET /api/accounting/ledger/reports/parties).
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ReportFilterBar, type ReportFilterField } from "@/components/reports/report-filter-bar";
import { useReportFilters, type FilterValues } from "@/components/reports/use-report-filters";
import { presetRange } from "@/lib/report-filters/period";
import { PARTY_TYPES, type PartyType } from "@/lib/accounting/types";
import { PARTY_TYPE_TEXT, accountName, ledgerRequest, useLedgerText } from "../../setup/_shared/ledger-ui";
import {
  FigureTiles,
  LedgerReportPage,
  StatementTable,
  periodParams,
  useLedgerReport,
  type ReportAccountRef,
  type StatementData,
} from "../_parts/report-kit";

interface PartyStatementResponse extends StatementData {
  party: { type: PartyType; id: string; name: string | null };
  normalSide: "debit" | "credit";
  accounts: ReportAccountRef[];
}

interface PartyOption {
  id: string;
  name: string;
  balance: number;
}

const FILTERS = {
  defaults: (): FilterValues => ({ ...presetRange("this-year"), partyType: "tenant", partyId: "" }),
};

const FIELDS: ReportFilterField[] = [{ kind: "period", startKey: "startDate", endKey: "endDate", presets: true }];

const isPartyType = (value: string): value is PartyType => (PARTY_TYPES as readonly string[]).includes(value);

export default function PartyStatementPage() {
  return (
    <Suspense fallback={null}>
      <PartyStatement />
    </Suspense>
  );
}

function PartyStatement() {
  const { tx, text, language, formatCurrency } = useLedgerText();
  const filters = useReportFilters(FILTERS);
  const { draft, applied, setField } = filters;
  const draftType: PartyType = isPartyType(draft.partyType) ? draft.partyType : "tenant";

  // The parties of the kind the controls show, with their balances.
  const [parties, setParties] = useState<{
    type: PartyType;
    list: PartyOption[];
    code: string | null;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const response = await ledgerRequest<{ parties: PartyOption[] }>(
        `/reports/parties?partyType=${draftType}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setParties({
        type: draftType,
        list: response.ok ? (response.data?.parties ?? []) : [],
        code: response.ok ? null : response.code,
      });
    })();
    return () => controller.abort();
  }, [draftType]);
  const partyList = parties?.type === draftType ? parties.list : [];

  const params = useMemo(() => {
    if (!applied.partyId || !isPartyType(applied.partyType)) return null;
    const query = periodParams(applied);
    query.set("partyType", applied.partyType);
    query.set("partyId", applied.partyId);
    return query;
  }, [applied]);
  const report = useLedgerReport<PartyStatementResponse>("party-statement", params);
  const data = params ? report.data : null;
  const owes = data?.normalSide === "credit";

  return (
    <LedgerReportPage
      report="party-statement"
      title={tx("ledger.reports.partyStatement.title", "Party statement")}
      subtitle={tx(
        "ledger.reports.partyStatement.subtitle",
        "A tenant's, owner's, customer's or supplier's account with the office, from the books",
      )}
      params={params}
      state={{
        ...report,
        code: parties?.code === "LEDGER_NOT_SET_UP" ? parties.code : report.code,
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
          leading={
            <>
              <div className="w-full min-w-[160px] space-y-1.5 sm:w-auto">
                <Label>{tx("ledger.reports.partyType", "Party type")}</Label>
                <Select
                  value={draftType}
                  onValueChange={(value) => setField({ partyType: value, partyId: "" })}
                >
                  <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PARTY_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {text(PARTY_TYPE_TEXT[type])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full min-w-[260px] space-y-1.5 sm:w-auto">
                <Label>{tx("ledger.reports.col.party", "Party")}</Label>
                <SearchableSelect
                  value={draft.partyId}
                  onValueChange={(partyId) => setField({ partyId })}
                  options={partyList.map((party) => ({
                    value: party.id,
                    label: party.name,
                    subtitle: `${tx("ledger.reports.col.balance", "Balance")}: ${formatCurrency(party.balance)}`,
                  }))}
                  placeholder={tx("ledger.reports.partyStatement.choose", "Choose whose statement")}
                  searchPlaceholder={tx("ledger.reports.partyStatement.search", "Search by name")}
                  emptyMessage={tx("ledger.reports.partyStatement.none", "No one of this kind has entries in the books")}
                  triggerClassName="h-10 bg-white dark:bg-gray-800"
                />
              </div>
            </>
          }
        />
      }
    >
      {!params ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <UserRound className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {tx("ledger.reports.partyStatement.pick", "Choose a party and apply to see their statement.")}
            </p>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {text(PARTY_TYPE_TEXT[data.party.type])}: {data.party.name ?? data.party.id}
            </p>
            <p className="text-xs text-muted-foreground">
              {tx("ledger.reports.partyStatement.accounts", "Accounts")}:{" "}
              {data.accounts.map((account) => `${account.code} — ${accountName(account, language)}`).join(" · ")}
            </p>
            <p className="text-xs text-muted-foreground">
              {owes
                ? tx("ledger.reports.partyStatement.creditSide", "The balance is what the office owes them.")
                : tx("ledger.reports.partyStatement.debitSide", "The balance is what they owe the office.")}
            </p>
          </div>
          <FigureTiles
            items={[
              { label: tx("ledger.reports.openingBalance", "Opening balance"), value: data.opening },
              { label: tx("ledger.reports.totalDebit", "Total debit"), value: data.totals.debit },
              { label: tx("ledger.reports.totalCredit", "Total credit"), value: data.totals.credit },
              { label: tx("ledger.reports.closingBalance", "Closing balance"), value: data.closing },
            ]}
          />
          <StatementTable data={data} showAccount={data.accounts.length > 1} showParty={false} />
        </>
      ) : null}
    </LedgerReportPage>
  );
}
