"use client";

/**
 * PropertyPro - VAT return (إقرار ضريبة القيمة المضافة)
 *
 * The ZATCA return's boxes for a period, filled from the books: sales by
 * their VAT treatment from the income accounts, purchases from the cost
 * accounts, the VAT itself from the output and input VAT accounts, and the
 * net due (box 13). Only what the posting rules marked with a VAT code is in
 * it — an owner's rent, a deposit, paying the VAT to ZATCA are not. Read from
 * the journal (GET /api/accounting/ledger/reports/vat-return); the VAT
 * summary (from the documents) stays beside it to compare.
 */

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportFilterBar, type ReportFilterField } from "@/components/reports/report-filter-bar";
import { useReportFilters, type FilterValues } from "@/components/reports/use-report-filters";
import { presetRange } from "@/lib/report-filters/period";
import { Money } from "../../setup/_shared/ledger-parts";
import { useLedgerText } from "../../setup/_shared/ledger-ui";
import { FigureTiles, LedgerReportPage, periodParams, useLedgerReport } from "../_parts/report-kit";

interface VatBox {
  box: number;
  label: string;
  amount: number;
  vat: number;
}

interface VatReturnResponse {
  period: { from: string | null; to: string | null };
  vatRegistered: boolean;
  vatNumber: string | null;
  sales: VatBox[];
  purchases: VatBox[];
  totalOutputVat: number;
  totalInputVat: number;
  netVatDue: number;
}

/** The boxes' names, keyed by box number. */
const BOX_TEXT: Record<number, [string, string]> = {
  1: ["ledger.reports.vat.box1", "Standard-rated sales"],
  3: ["ledger.reports.vat.box3", "Zero-rated domestic sales"],
  5: ["ledger.reports.vat.box5", "Exempt sales"],
  6: ["ledger.reports.vat.box6", "Total sales"],
  7: ["ledger.reports.vat.box7", "Standard-rated domestic purchases"],
  10: ["ledger.reports.vat.box10", "Zero-rated purchases"],
  11: ["ledger.reports.vat.box11", "Exempt purchases"],
  12: ["ledger.reports.vat.box12", "Total purchases"],
};

const FILTERS = {
  defaults: (): FilterValues => ({ ...presetRange("this-quarter") }),
};

const FIELDS: ReportFilterField[] = [{ kind: "period", startKey: "startDate", endKey: "endDate", presets: true }];

export default function VatReturnPage() {
  return (
    <Suspense fallback={null}>
      <VatReturn />
    </Suspense>
  );
}

function VatReturn() {
  const { tx } = useLedgerText();
  const filters = useReportFilters(FILTERS);
  const { draft, applied, setField } = filters;
  const params = useMemo(() => periodParams(applied), [applied]);
  const report = useLedgerReport<VatReturnResponse>("vat-return", params);
  const data = report.data;

  const boxes = (title: string, rows: VatBox[]) => (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">{tx("ledger.reports.vat.box", "Box")}</TableHead>
              <TableHead>{tx("ledger.reports.col.description", "Description")}</TableHead>
              <TableHead className="text-end">{tx("ledger.reports.vat.amount", "Amount (SAR)")}</TableHead>
              <TableHead className="text-end">{tx("ledger.reports.vat.vatAmount", "VAT amount (SAR)")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const total = row.box === 6 || row.box === 12;
              const label = BOX_TEXT[row.box];
              return (
                <TableRow key={row.box} className={total ? "bg-muted/40 font-semibold" : undefined}>
                  <TableCell className="tabular-nums">{row.box}</TableCell>
                  <TableCell className="text-sm">{label ? tx(label[0], label[1]) : row.label}</TableCell>
                  <TableCell className="text-end tabular-nums"><Money value={row.amount} /></TableCell>
                  <TableCell className="text-end tabular-nums"><Money value={row.vat} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <LedgerReportPage
      report="vat-return"
      title={tx("ledger.reports.vatReturn.title", "VAT return")}
      subtitle={tx(
        "ledger.reports.vatReturn.subtitle",
        "The ZATCA return's boxes for the period, from the books",
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
        />
      }
    >
      {data && (
        <>
          {!data.vatRegistered && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              {tx(
                "ledger.reports.vatReturn.notRegistered",
                "The office is not marked VAT-registered in Accounting setup, so its purchases carry no reclaimable VAT.",
              )}
            </p>
          )}
          {data.vatNumber && (
            <p className="text-sm text-muted-foreground">
              {tx("ledger.reports.vatReturn.vatNumber", "VAT number")}:{" "}
              <span className="font-medium tabular-nums" dir="ltr">{data.vatNumber}</span>
            </p>
          )}
          <FigureTiles
            items={[
              { label: tx("ledger.reports.vatReturn.outputVat", "VAT on sales"), value: data.totalOutputVat },
              { label: tx("ledger.reports.vatReturn.inputVat", "VAT on purchases"), value: data.totalInputVat },
              {
                label:
                  data.netVatDue < 0
                    ? tx("ledger.reports.vatReturn.netReclaimable", "Net VAT reclaimable (box 13)")
                    : tx("ledger.reports.vatReturn.netDue", "Net VAT due (box 13)"),
                value: data.netVatDue,
              },
            ]}
          />
          {boxes(tx("ledger.reports.vatReturn.sales", "Sales"), data.sales)}
          {boxes(tx("ledger.reports.vatReturn.purchases", "Purchases"), data.purchases)}
          <p className="text-xs text-muted-foreground">
            {tx(
              "ledger.reports.vatReturn.note",
              "Sales to other GCC states, exports and imports (boxes 2, 4, 8 and 9) are not recorded in the app. Rent collected for owners is the owners' supply and is not in the office's return.",
            )}{" "}
            <Link href="/dashboard/accounting/vat-summary" className="text-primary hover:underline">
              {tx("ledger.reports.vatReturn.compare", "Compare with the VAT summary")}
            </Link>
          </p>
        </>
      )}
    </LedgerReportPage>
  );
}
