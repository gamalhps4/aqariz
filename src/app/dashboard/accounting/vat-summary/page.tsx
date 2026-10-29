"use client";

/**
 * The VAT summary: output VAT by category from the office's invoices and
 * credit notes, input VAT from its expenses, per month or quarter — what a
 * VAT return is filled from until the ledger keeps the VAT accounts. Rent on
 * owners' buildings, and VAT paid on their expenses, are the owners' and are
 * shown apart (GET /api/accounting/vat-summary).
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportExportButton } from "@/components/reports/export-button";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { businessToday } from "@/lib/dates/business-day";

type VatCategory = "S" | "Z" | "E" | "O";

interface SummaryRow {
  vatCategory: VatCategory;
  vatRate: number;
  netAmount: number;
  vatAmount: number;
  count: number;
}

interface SummaryBlock {
  rows: SummaryRow[];
  netAmount: number;
  vatAmount: number;
}

interface VatSummaryResponse {
  period: { from: string; to: string; groupBy: "month" | "quarter" };
  output: SummaryBlock;
  ownersOutput: SummaryBlock;
  input: SummaryBlock;
  ownersInput: SummaryBlock;
  creditNotes: { count: number; netAmount: number; vatAmount: number };
  netVatDue: number;
  periods: Array<{ key: string; outputVat: number; inputVat: number; netVat: number }>;
  linesAvailable: boolean;
}

const CATEGORY_LABELS: Record<VatCategory, string> = {
  S: "Standard rate",
  Z: "Zero-rated",
  E: "Exempt",
  O: "Out of scope",
};

const NO_ROWS: SummaryRow[] = [];
const NO_PERIODS: VatSummaryResponse["periods"] = [];

/** The first day of the quarter a day is in, on the office's calendar. */
function quarterStart(day: string): string {
  const quarterFirstMonth = Math.floor((Number(day.slice(5, 7)) - 1) / 3) * 3 + 1;
  return `${day.slice(0, 4)}-${String(quarterFirstMonth).padStart(2, "0")}-01`;
}

export default function VatSummaryPage() {
  const { t, formatCurrency } = useLocalizationContext();
  const [from, setFrom] = useState(() => quarterStart(businessToday()));
  const [to, setTo] = useState(() => businessToday());
  const [groupBy, setGroupBy] = useState<"month" | "quarter">("month");
  const [data, setData] = useState<VatSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => {
    const query = new URLSearchParams();
    if (from) query.set("startDate", from);
    if (to) query.set("endDate", to);
    query.set("groupBy", groupBy);
    return query;
  }, [from, to, groupBy]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/accounting/vat-summary?${params.toString()}`);
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body?.error);
        setData(body.data as VatSummaryResponse);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error && cause.message
              ? cause.message
              : t("vatSummary.loadError", { defaultValue: "Could not load the VAT summary" }),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, t]);

  const categoryLabel = (row: SummaryRow) =>
    `${t(`invoices.vat.category.${row.vatCategory}`, {
      defaultValue: CATEGORY_LABELS[row.vatCategory],
    })}${row.vatCategory === "S" ? ` ${row.vatRate}%` : ""}`;

  // Periods ("2026-01", "2026-Q1") sort as written; the collator reads
  // their digits as numbers.
  const periodSort = useTableSort(data?.periods ?? NO_PERIODS, {
    period: (row) => row.key,
    outputVat: (row) => row.outputVat,
    inputVat: (row) => row.inputVat,
    netVat: (row) => row.netVat,
  });

  const block = (title: string, description: string, summary: SummaryBlock | undefined) => (
    <SummaryBlockCard
      title={title}
      description={description}
      summary={summary}
      categoryLabel={categoryLabel}
    />
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("vatSummary.title", { defaultValue: "VAT summary" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("vatSummary.subtitle", {
              defaultValue:
                "Output VAT from invoices and credit notes, input VAT from expenses, for the period",
            })}
          </p>
        </div>
        <ReportExportButton endpoint="/api/accounting/vat-summary" params={params} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="vat-from">{t("vatSummary.from", { defaultValue: "From" })}</Label>
          <Input id="vat-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vat-to">{t("vatSummary.to", { defaultValue: "To" })}</Label>
          <Input id="vat-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t("vatSummary.groupBy", { defaultValue: "By" })}</Label>
          <Select value={groupBy} onValueChange={(value) => setGroupBy(value as "month" | "quarter")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">{t("vatSummary.month", { defaultValue: "Month" })}</SelectItem>
              <SelectItem value="quarter">{t("vatSummary.quarter", { defaultValue: "Quarter" })}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">{error}</div>
      ) : loading && !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {[
              [t("vatSummary.outputVat", { defaultValue: "Output VAT" }), data.output.vatAmount],
              [t("vatSummary.inputVat", { defaultValue: "Input VAT" }), data.input.vatAmount],
              [t("vatSummary.netVatDue", { defaultValue: "Net VAT due" }), data.netVatDue],
              [
                t("vatSummary.creditNotes", {
                  defaultValue: "Credit notes ({count})",
                  values: { count: data.creditNotes.count },
                }),
                data.creditNotes.vatAmount,
              ],
            ].map(([label, amount]) => (
              <div key={String(label)} className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatCurrency(Number(amount))}
                </p>
              </div>
            ))}
          </div>

          {!data.linesAvailable && (
            <p className="text-sm text-muted-foreground">
              {t("vatSummary.notReady", {
                defaultValue:
                  "Invoice lines and expense VAT are not recorded yet on this database: figures come from invoice totals.",
              })}
            </p>
          )}

          {block(
            t("vatSummary.outputVat", { defaultValue: "Output VAT" }),
            t("vatSummary.outputDescription", {
              defaultValue: "The office's own invoices and credit notes, by category",
            }),
            data.output,
          )}
          {block(
            t("vatSummary.inputVat", { defaultValue: "Input VAT" }),
            t("vatSummary.inputDescription", {
              defaultValue: "Approved and paid expenses with VAT recorded, which the office may reclaim",
            }),
            data.input,
          )}
          {block(
            t("vatSummary.ownersOutput", { defaultValue: "Billed on owners' buildings" }),
            t("vatSummary.ownersOutputDescription", {
              defaultValue: "Rent and charges on buildings owners hold: the owners' supplies, not in the office's total",
            }),
            data.ownersOutput,
          )}
          {block(
            t("vatSummary.ownersInput", { defaultValue: "VAT on owners' buildings' expenses" }),
            t("vatSummary.ownersInputDescription", {
              defaultValue: "The owners' costs: the office cannot reclaim this VAT",
            }),
            data.ownersInput,
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t("vatSummary.byPeriod", { defaultValue: "By period" })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.periods.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead sort={periodSort} column="period">
                        {t("vatSummary.period", { defaultValue: "Period" })}
                      </SortableTableHead>
                      <SortableTableHead sort={periodSort} column="outputVat" className="text-end">
                        {t("vatSummary.outputVat", { defaultValue: "Output VAT" })}
                      </SortableTableHead>
                      <SortableTableHead sort={periodSort} column="inputVat" className="text-end">
                        {t("vatSummary.inputVat", { defaultValue: "Input VAT" })}
                      </SortableTableHead>
                      <SortableTableHead sort={periodSort} column="netVat" className="text-end">
                        {t("vatSummary.netVat", { defaultValue: "Net VAT" })}
                      </SortableTableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {periodSort.rows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="tabular-nums">{row.key}</TableCell>
                        <TableCell className="text-end tabular-nums">{formatCurrency(row.outputVat)}</TableCell>
                        <TableCell className="text-end tabular-nums">{formatCurrency(row.inputVat)}</TableCell>
                        <TableCell className="text-end tabular-nums">{formatCurrency(row.netVat)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t("reports.noData", { defaultValue: "No data" })}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/**
 * One block of the summary: VAT by category, then its total. A header click
 * sorts the categories; the total row stays last.
 */
function SummaryBlockCard({
  title,
  description,
  summary,
  categoryLabel,
}: {
  title: string;
  description: string;
  summary: SummaryBlock | undefined;
  categoryLabel: (row: SummaryRow) => string;
}) {
  const { t, formatCurrency } = useLocalizationContext();
  const sort = useTableSort(summary?.rows ?? NO_ROWS, {
    category: categoryLabel,
    net: (row) => row.netAmount,
    vat: (row) => row.vatAmount,
    documents: (row) => row.count,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {summary && summary.rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead sort={sort} column="category">
                  {t("vatSummary.category", { defaultValue: "VAT category" })}
                </SortableTableHead>
                <SortableTableHead sort={sort} column="net" className="text-end">
                  {t("vatSummary.net", { defaultValue: "Net" })}
                </SortableTableHead>
                <SortableTableHead sort={sort} column="vat" className="text-end">
                  {t("leases.invoicePrint.vat", { defaultValue: "VAT" })}
                </SortableTableHead>
                <SortableTableHead sort={sort} column="documents" className="text-end">
                  {t("vatSummary.documents", { defaultValue: "Documents" })}
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sort.rows.map((row) => (
                <TableRow key={`${row.vatCategory}-${row.vatRate}`}>
                  <TableCell>{categoryLabel(row)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(row.netAmount)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(row.vatAmount)}</TableCell>
                  <TableCell className="text-end tabular-nums">{row.count}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell>{t("vatSummary.total", { defaultValue: "Total" })}</TableCell>
                <TableCell className="text-end tabular-nums">{formatCurrency(summary.netAmount)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatCurrency(summary.vatAmount)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t("reports.noData", { defaultValue: "No data" })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
