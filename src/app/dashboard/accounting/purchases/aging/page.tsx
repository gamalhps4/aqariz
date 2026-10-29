"use client";

/**
 * PropertyPro - Payables aging (أعمار الديون الدائنة)
 *
 * What the office owes each supplier at a day, by how long it has been due:
 * not yet due, 1–30, 31–60, 61–90 and over 90 days overdue — approved bills
 * with what is still unpaid on them and expenses approved with a supplier but
 * not paid — less what vouchers paid on account. Each supplier opens onto the
 * documents behind their figures. Beside the total, the books' own balance
 * on the suppliers' payable account, and how far the two are apart; before
 * accounting is set up the report still works, without that comparison.
 */

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Clock, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";
import { ReportExportButton } from "@/components/reports/export-button";
import { toHalalas } from "@/lib/accounting/money";
import type { AgingSupplierRow, PayablesAging } from "@/lib/accounting/purchases/aging";
import { AGING_BUCKETS, type AgingBucket } from "@/lib/accounting/purchases/types";
import { LedgerHeader, Money } from "../../setup/_shared/ledger-parts";
import type { LedgerResponse } from "../../setup/_shared/ledger-ui";
import {
  AGING_BUCKET_TEXT,
  SupplierPicker,
  purchasesRequest,
  queryString,
  todayInput,
  useLedgerError,
  useLedgerText,
  usePurchasesAccess,
  useSupplierOptions,
} from "../_shared/purchases-ui";
import { NoPurchasesAccess, RefusalState, SummaryTiles } from "../vouchers/_parts/voucher-kit";

type Access = ReturnType<typeof usePurchasesAccess>;

const OVERDUE_BUCKETS: readonly AgingBucket[] = ["d1_30", "d31_60", "d61_90", "d90_plus"];

/** Columns of the main table: the expander, the supplier, five buckets, outstanding, on account, net. */
const MAIN_COLUMNS = 2 + AGING_BUCKETS.length + 3;

/** An amount the table shows as a dash (none) sorts as blank: last, both ways. */
const shownAmount = (value: number) => (toHalalas(value) === 0 ? null : value);

const BUCKET_TONES: Record<AgingBucket, string> = {
  current: "",
  d1_30: "text-amber-600 dark:text-amber-400",
  d31_60: "text-amber-700 dark:text-amber-300",
  d61_90: "text-destructive",
  d90_plus: "text-destructive font-semibold",
};

export default function PayablesAgingPage() {
  const access = usePurchasesAccess();
  if (access.loading) return null;
  if (!access.canView) return <NoPurchasesAccess />;
  return <PayablesAgingReport access={access} />;
}

function PayablesAgingReport({ access }: { access: Access }) {
  const { tx, text, formatDate } = useLedgerText();
  const describeError = useLedgerError();
  const { suppliers } = useSupplierOptions(true, true);
  const [asOf, setAsOf] = useState(todayInput);
  const [supplierId, setSupplierId] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [result, setResult] = useState<{ query: string; response: LedgerResponse<PayablesAging> } | null>(null);

  const query = queryString({ asOf, supplierId });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const response = await purchasesRequest<PayablesAging>(`/aging${query}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult({ query, response });
    })();
    return () => controller.abort();
  }, [query]);

  const current = result?.query === query ? result.response : null;
  const loading = current === null;
  // While a new day or supplier loads, the figures already shown stay, dimmed.
  const shown = current ?? result?.response ?? null;
  const data = shown?.ok ? shown.data : null;
  const refusal = current && !current.ok ? current : null;

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? null;
  // The suppliers sort, each keeping its documents under it; the totals stay
  // in the footer.
  const sort = useTableSort(rows, {
    supplier: (row) => row.supplierName,
    ...Object.fromEntries(
      AGING_BUCKETS.map((bucket) => [bucket, (row: AgingSupplierRow) => shownAmount(row.buckets[bucket])]),
    ),
    outstanding: (row) => row.outstanding,
    onAccount: (row) => shownAmount(row.onAccount),
    net: (row) => row.net,
  });
  const overdue = totals ? OVERDUE_BUCKETS.reduce((sum, bucket) => sum + toHalalas(totals.buckets[bucket]), 0) / 100 : 0;
  const allOpen = rows.length > 0 && rows.every((row) => expanded.has(row.supplierId));

  const toggle = (id: string) =>
    setExpanded((currentSet) => {
      const next = new Set(currentSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(rows.map((row) => row.supplierId)));

  const exportParams = new URLSearchParams(Object.entries({ asOf, supplierId }).filter((entry) => Boolean(entry[1])));

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("purchases.aging.title", "Payables aging")}
        subtitle={
          data
            ? tx("purchases.aging.subtitleAsOf", "What the office owes each supplier on {date}, by how long it has been due.", {
                date: formatDate(data.asOf),
              })
            : tx("purchases.aging.subtitle", "What the office owes each supplier at a date, by how long it has been due.")
        }
        actions={
          access.canExport ? (
            <ReportExportButton
              endpoint="/api/accounting/purchases/aging"
              params={exportParams}
              disabled={loading || !data || rows.length === 0}
            />
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
        <div className="w-full space-y-1.5 sm:w-auto">
          <Label htmlFor="aging-as-of">{tx("purchases.aging.asOf", "As of")}</Label>
          <Input
            id="aging-as-of"
            type="date"
            className="h-10 bg-white dark:bg-gray-800"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value || todayInput())}
          />
        </div>
        <div className="w-full min-w-[240px] space-y-1.5 sm:w-auto">
          <Label htmlFor="aging-supplier">{tx("purchases.aging.supplier", "Supplier")}</Label>
          <SupplierPicker
            id="aging-supplier"
            suppliers={suppliers}
            value={supplierId}
            includeAll
            onChange={setSupplierId}
            className="h-10 bg-white dark:bg-gray-800"
          />
        </div>
      </div>

      {refusal ? (
        <RefusalState code={refusal.code} message={describeError(refusal)} canManageBooks={access.canManageBooks} />
      ) : !data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className={loading ? "space-y-4 opacity-60 transition-opacity" : "space-y-4"}>
          <SummaryTiles
            items={[
              { label: tx("purchases.aging.cards.outstanding", "Total outstanding"), value: <Money value={totals?.outstanding ?? 0} /> },
              {
                label: tx("purchases.aging.cards.overdue", "Overdue"),
                value: <Money value={overdue} />,
                tone: overdue > 0 ? "bad" : undefined,
              },
              {
                label: tx("purchases.aging.cards.onAccount", "On account"),
                value: <Money value={totals?.onAccount ?? 0} />,
                hint: tx("purchases.aging.cards.onAccountHint", "Paid to suppliers and not yet set against a bill"),
              },
              { label: tx("purchases.aging.cards.net", "Net owed"), value: <Money value={totals?.net ?? 0} /> },
            ]}
          />

          {rows.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Clock className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">{tx("purchases.aging.empty.title", "Nothing is owed to suppliers at this date")}</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {tx(
                    "purchases.aging.empty.body",
                    "Approved bills and supplier expenses that are not paid in full appear here, with payments made on account.",
                  )}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">{tx("purchases.aging.bySupplier", "By supplier")}</CardTitle>
                <Button variant="ghost" size="sm" onClick={toggleAll}>
                  {allOpen
                    ? tx("purchases.aging.collapseAll", "Hide all documents")
                    : tx("purchases.aging.expandAll", "Show all documents")}
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <span className="sr-only">{tx("purchases.aging.details", "Documents")}</span>
                        </TableHead>
                        <SortableTableHead sort={sort} column="supplier" className="min-w-[180px]">
                          {tx("purchases.aging.col.supplier", "Supplier")}
                        </SortableTableHead>
                        {AGING_BUCKETS.map((bucket) => (
                          <SortableTableHead key={bucket} sort={sort} column={bucket} className="whitespace-nowrap text-end">
                            {text(AGING_BUCKET_TEXT[bucket])}
                          </SortableTableHead>
                        ))}
                        <SortableTableHead sort={sort} column="outstanding" className="whitespace-nowrap text-end">
                          {tx("purchases.aging.col.outstanding", "Total outstanding")}
                        </SortableTableHead>
                        <SortableTableHead sort={sort} column="onAccount" className="whitespace-nowrap text-end">
                          {tx("purchases.aging.col.onAccount", "On account")}
                        </SortableTableHead>
                        <SortableTableHead sort={sort} column="net" className="whitespace-nowrap text-end">
                          {tx("purchases.aging.col.net", "Net")}
                        </SortableTableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sort.rows.map((row) => {
                        const open = expanded.has(row.supplierId);
                        const detailId = `aging-${row.supplierId}`;
                        return (
                          <Fragment key={row.supplierId}>
                            <TableRow className={open ? "border-b-0 bg-muted/30" : undefined}>
                              <TableCell className="w-10">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  aria-expanded={open}
                                  aria-controls={detailId}
                                  aria-label={
                                    open
                                      ? tx("purchases.aging.collapse", "Hide the documents of {name}", { name: row.supplierName })
                                      : tx("purchases.aging.expand", "Show the documents of {name}", { name: row.supplierName })
                                  }
                                  onClick={() => toggle(row.supplierId)}
                                >
                                  {open ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                                  )}
                                </Button>
                              </TableCell>
                              <TableCell className="font-medium">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span>{row.supplierName}</span>
                                  {access.canPay && row.net > 0 && (
                                    <Link
                                      href={`/dashboard/accounting/purchases/vouchers/new${queryString({ supplierId: row.supplierId })}`}
                                      className="text-xs font-normal text-primary hover:underline"
                                    >
                                      {tx("purchases.aging.pay", "Pay")}
                                    </Link>
                                  )}
                                </div>
                              </TableCell>
                              {AGING_BUCKETS.map((bucket) => (
                                <TableCell key={bucket} className="text-end tabular-nums">
                                  <BucketAmount value={row.buckets[bucket]} className={BUCKET_TONES[bucket]} />
                                </TableCell>
                              ))}
                              <TableCell className="text-end font-medium tabular-nums">
                                <Money value={row.outstanding} />
                              </TableCell>
                              <TableCell className="text-end tabular-nums">
                                <BucketAmount value={row.onAccount} />
                              </TableCell>
                              <TableCell className="text-end font-semibold tabular-nums">
                                <Money value={row.net} />
                              </TableCell>
                            </TableRow>
                            {open && (
                              <TableRow id={detailId} className="bg-muted/30 hover:bg-muted/30">
                                <TableCell colSpan={MAIN_COLUMNS} className="whitespace-normal px-4 pb-4 pt-0">
                                  <SupplierDocuments row={row} />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                    {totals && (
                      <TableFooter>
                        <TableRow>
                          <TableCell />
                          <TableCell className="font-semibold">{tx("purchases.aging.total", "Total")}</TableCell>
                          {AGING_BUCKETS.map((bucket) => (
                            <TableCell key={bucket} className="text-end font-semibold tabular-nums">
                              <Money value={totals.buckets[bucket]} />
                            </TableCell>
                          ))}
                          <TableCell className="text-end font-semibold tabular-nums">
                            <Money value={totals.outstanding} />
                          </TableCell>
                          <TableCell className="text-end font-semibold tabular-nums">
                            <Money value={totals.onAccount} />
                          </TableCell>
                          <TableCell className="text-end font-semibold tabular-nums">
                            <Money value={totals.net} />
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    )}
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {data.ledger && totals && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Scale className="h-5 w-5" aria-hidden="true" />
                  {tx("purchases.aging.books.title", "Per the books")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <BooksFigure
                    label={tx("purchases.aging.books.balance", "Suppliers' payable account in the books")}
                    value={data.ledger.balance}
                  />
                  <BooksFigure label={tx("purchases.aging.books.net", "Net owed in this report")} value={totals.net} />
                  <BooksFigure
                    label={tx("purchases.aging.books.difference", "Difference")}
                    value={data.ledger.difference}
                    tone={toHalalas(data.ledger.difference) === 0 ? "good" : "warn"}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {toHalalas(data.ledger.difference) === 0
                    ? tx("purchases.aging.books.agree", "The books agree with this report.")
                    : tx(
                        "purchases.aging.books.note",
                        "The two can differ: opening balances and journals written by hand are in the books and not in this report, and documents dated before the cut-over are in this report and not in the books.",
                      )}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/** An amount in a bucket, or a quiet dash for none. */
function BucketAmount({ value, className = "" }: { value: number; className?: string }) {
  if (toHalalas(value) === 0) return <span className="text-muted-foreground">—</span>;
  return <Money value={value} className={className} />;
}

function BooksFigure({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  const color =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "";
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>
        <Money value={value} />
      </p>
    </div>
  );
}

/** What a supplier's figures are made of: the documents owed, and the payments on account. */
function SupplierDocuments({ row }: { row: AgingSupplierRow }) {
  const { tx, text, formatDate } = useLedgerText();
  const itemSort = useTableSort(row.items, {
    kind: (item) =>
      item.kind === "bill"
        ? tx("purchases.aging.items.bill", "Purchase bill")
        : tx("purchases.aging.items.expense", "Expense"),
    number: (item) => item.number,
    reference: (item) => item.reference,
    date: (item) => new Date(item.date),
    dueDate: (item) => new Date(item.dueDate),
    // Not yet overdue shows a dash: blank, last both ways.
    days: (item) => (item.daysPastDue > 0 ? item.daysPastDue : null),
    // The age buckets in their own order (not yet due, 1–30, … over 90), not
    // their names' alphabet.
    bucket: (item) => AGING_BUCKETS.indexOf(item.bucket),
    outstanding: (item) => item.outstanding,
  });
  const advanceSort = useTableSort(row.advances, {
    voucher: (advance) => advance.number,
    date: (advance) => new Date(advance.date),
    amount: (advance) => advance.amount,
  });
  return (
    <div className="space-y-3 rounded-lg border bg-background p-3">
      {row.items.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{tx("purchases.aging.items.title", "Documents owed")}</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sort={itemSort} column="kind">
                    {tx("purchases.aging.items.kind", "Document")}
                  </SortableTableHead>
                  <SortableTableHead sort={itemSort} column="number">
                    {tx("purchases.aging.items.number", "Number")}
                  </SortableTableHead>
                  <SortableTableHead sort={itemSort} column="reference" className="hidden md:table-cell">
                    {tx("purchases.aging.items.reference", "Supplier invoice no.")}
                  </SortableTableHead>
                  <SortableTableHead sort={itemSort} column="date" className="hidden lg:table-cell">
                    {tx("purchases.aging.items.date", "Date")}
                  </SortableTableHead>
                  <SortableTableHead sort={itemSort} column="dueDate">
                    {tx("purchases.aging.items.dueDate", "Due date")}
                  </SortableTableHead>
                  <SortableTableHead sort={itemSort} column="days" className="text-end">
                    {tx("purchases.aging.items.days", "Days overdue")}
                  </SortableTableHead>
                  <SortableTableHead sort={itemSort} column="bucket" className="hidden sm:table-cell">
                    {tx("purchases.aging.items.bucket", "Age")}
                  </SortableTableHead>
                  <SortableTableHead sort={itemSort} column="outstanding" className="text-end">
                    {tx("purchases.aging.items.outstanding", "Outstanding")}
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemSort.rows.map((item) => (
                  <TableRow key={`${item.kind}:${item.id}`}>
                    <TableCell>
                      <Badge variant={item.kind === "bill" ? "info" : "secondary"} className="text-[11px]">
                        {item.kind === "bill"
                          ? tx("purchases.aging.items.bill", "Purchase bill")
                          : tx("purchases.aging.items.expense", "Expense")}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link
                        href={
                          item.kind === "bill"
                            ? `/dashboard/accounting/purchases/bills/${item.id}`
                            : `/dashboard/accounting/expenses/${item.id}`
                        }
                        className="font-mono text-xs font-medium text-primary hover:underline"
                        dir="ltr"
                      >
                        {item.number}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {item.reference ? (
                        <span className="font-mono text-xs" dir="ltr">
                          {item.reference}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm lg:table-cell">{formatDate(item.date)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatDate(item.dueDate)}</TableCell>
                    <TableCell className="text-end text-sm tabular-nums">
                      {item.daysPastDue > 0 ? (
                        <span dir="ltr" className={BUCKET_TONES[item.bucket]}>
                          {item.daysPastDue}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm sm:table-cell">{text(AGING_BUCKET_TEXT[item.bucket])}</TableCell>
                    <TableCell className="text-end">
                      <Money value={item.outstanding} className="text-sm font-medium" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      {row.advances.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{tx("purchases.aging.advances.title", "Paid on account")}</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sort={advanceSort} column="voucher">
                    {tx("purchases.aging.advances.voucher", "Voucher")}
                  </SortableTableHead>
                  <SortableTableHead sort={advanceSort} column="date">
                    {tx("purchases.aging.advances.date", "Date")}
                  </SortableTableHead>
                  <SortableTableHead sort={advanceSort} column="amount" className="text-end">
                    {tx("purchases.aging.advances.amount", "On account")}
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advanceSort.rows.map((advance) => (
                  <TableRow key={advance.voucherId}>
                    <TableCell>
                      <Link
                        href={`/dashboard/accounting/purchases/vouchers/${advance.voucherId}`}
                        className="font-mono text-xs font-medium text-primary hover:underline"
                        dir="ltr"
                      >
                        {advance.number}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatDate(advance.date)}</TableCell>
                    <TableCell className="text-end">
                      <Money value={advance.amount} className="text-sm font-medium" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
