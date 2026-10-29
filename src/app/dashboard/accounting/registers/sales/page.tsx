"use client";

/**
 * PropertyPro - Sales & Receipts register (سجل المبيعات والمقبوضات)
 *
 * Every invoice and credit note the office issued and every receipt it gave
 * — a tenant's payment under its voucher number, and what an owner or a
 * customer paid on their invoice — in date order, with totals over
 * everything the filters match (not only the page shown). The period and the
 * pickers are applied together and kept in the address, so a reload or a
 * shared link opens on the same register; the search and the order apply at
 * once. Read from the documents, so it works before the books are set up.
 */

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { keepSorted } from "@/lib/server-sort";
import GlobalSearch from "@/components/ui/global-search";
import { ReportExportButton } from "@/components/reports/export-button";
import { ReportFilterBar, type ReportFilterField } from "@/components/reports/report-filter-bar";
import { useReportFilterOptions } from "@/components/reports/use-report-filter-options";
import { useReportFilters, type FilterValues } from "@/components/reports/use-report-filters";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { presetRange } from "@/lib/report-filters/period";
import { paymentMethodLabel } from "@/lib/payments/methods";
import type {
  RegisterOrder,
  SalesRegisterRow,
  SalesRegisterTotals,
  SalesRowKind,
} from "@/lib/accounting/registers";
import { LedgerHeader, LedgerPagination, Money } from "../../setup/_shared/ledger-parts";
import {
  CUSTOMER_TYPE_TEXT,
  DocumentStatusBadge,
  useLedgerText,
  usePurchasesAccess,
} from "../../purchases/_shared/purchases-ui";
import { PurchasesNotice, SummaryTiles } from "../../purchases/vouchers/_parts/voucher-kit";
import { NoSalesAccess, OrderSelect, useCodeText, useRegisterPage, useStatusText } from "../_parts/register-kit";

type Access = ReturnType<typeof usePurchasesAccess>;

/** The register opens on this month: the period VAT and the month's figures are reviewed by. */
const FILTERS = {
  defaults: (): FilterValues => ({
    ...presetRange("this-month"),
    ownerId: "",
    propertyId: "",
    tenantId: "",
    kind: "",
    status: "",
  }),
};

const OPTION_LISTS = ["owners", "buildings", "tenants"] as const;

/** The filters the route reads under the same name. */
const PASSED_KEYS = ["ownerId", "propertyId", "tenantId", "kind", "status"] as const;

/**
 * Statuses the register can be narrowed by: issued, overdue and cancelled
 * are an invoice's; refunded is a receipt's; paid and partly paid are both.
 */
const STATUS_FILTERS = ["issued", "partial", "paid", "overdue", "cancelled", "refunded"] as const;

const KIND_BADGES: Record<SalesRowKind, { variant: "info" | "warning" | "success"; text: readonly [string, string] }> = {
  invoice: { variant: "info", text: ["purchases.registers.kind.invoice", "Invoice"] },
  credit_note: { variant: "warning", text: ["purchases.registers.kind.credit_note", "Credit note"] },
  receipt: { variant: "success", text: ["purchases.registers.kind.receipt", "Receipt voucher"] },
};

interface SalesRegisterData {
  rows: SalesRegisterRow[];
  totals: SalesRegisterTotals;
}

export default function SalesRegisterPage() {
  // useSearchParams (the filters in the address) needs a boundary of its own.
  return (
    <Suspense fallback={null}>
      <SalesRegisterGate />
    </Suspense>
  );
}

function SalesRegisterGate() {
  const access = usePurchasesAccess();
  const { tx } = useLedgerText();
  if (access.loading) return null;
  if (!access.canViewSales) {
    return (
      <div className="space-y-4">
        <LedgerHeader title={tx("purchases.registers.sales.title", "Sales and receipts register")} />
        <NoSalesAccess />
      </div>
    );
  }
  return <SalesRegister access={access} />;
}

function SalesRegister({ access }: { access: Access }) {
  const { tx, text, formatDate } = useLedgerText();
  const { t } = useLocalizationContext();
  const statusText = useStatusText();
  const codeText = useCodeText();
  const filters = useReportFilters(FILTERS);
  const { draft, applied, setField } = filters;
  const { options, loading: optionsLoading, failed: optionsFailed } = useReportFilterOptions(OPTION_LISTS);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<RegisterOrder>("desc");

  // Everything a page is asked with but the page itself — also what the export takes.
  const base = useMemo(() => {
    const params = new URLSearchParams();
    if (applied.startDate) params.set("from", applied.startDate);
    if (applied.endDate) params.set("to", applied.endDate);
    for (const key of PASSED_KEYS) if (applied[key]) params.set(key, applied[key]);
    if (search.trim()) params.set("search", search.trim());
    params.set("order", order);
    return params.toString();
  }, [applied, search, order]);

  const register = useRegisterPage<SalesRegisterData>("/api/accounting/sales/register", base);
  const rows = register.data?.rows ?? [];
  const totals = register.data?.totals ?? null;

  const onSearch = useCallback((value: string) => setSearch(value), []);

  const fields: ReportFilterField[] = [
    { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
    { kind: "entity", entity: "owner" },
    { kind: "entity", entity: "building" },
    { kind: "entity", entity: "tenant" },
    {
      kind: "status",
      key: "kind",
      label: tx("purchases.registers.kindFilter.label", "Document"),
      allLabel: tx("purchases.registers.kindFilter.all", "All documents"),
      options: [
        { value: "invoices", label: tx("purchases.registers.kindFilter.invoices", "Invoices") },
        { value: "credit_notes", label: tx("purchases.registers.kindFilter.credit_notes", "Credit notes") },
        { value: "receipts", label: tx("purchases.registers.kindFilter.receipts", "Receipt vouchers") },
      ],
    },
    {
      kind: "status",
      key: "status",
      options: STATUS_FILTERS.map((value) => ({ value, label: statusText(value) })),
    },
  ];

  const methodText = (method: string | null) => paymentMethodLabel(method, t);

  const columns: DataTableColumn<SalesRegisterRow>[] = [
    {
      id: "date",
      sortKey: "date",
      header: tx("purchases.registers.col.date", "Date"),
      cell: (row) => <span className="whitespace-nowrap text-sm">{formatDate(row.date)}</span>,
      width: "min-w-[105px]",
    },
    {
      id: "document",
      header: tx("purchases.registers.col.document", "Document"),
      cell: (row) => {
        const badge = KIND_BADGES[row.kind];
        return (
          <Badge variant={badge.variant} className="text-[11px]">
            {text(badge.text)}
          </Badge>
        );
      },
    },
    {
      id: "number",
      header: tx("purchases.registers.col.number", "Number"),
      cell: (row) => {
        const number = row.documentNumber || "—";
        return row.href && row.documentNumber ? (
          <Link href={row.href} className="font-mono text-xs font-medium text-primary hover:underline" dir="ltr">
            {number}
          </Link>
        ) : row.href ? (
          <Link href={row.href} className="text-xs text-primary hover:underline">
            {tx("purchases.registers.open", "Open")}
          </Link>
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {number}
          </span>
        );
      },
      width: "min-w-[120px]",
    },
    {
      id: "customer",
      header: tx("purchases.registers.col.customer", "Customer"),
      cell: (row) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium">{row.customerName}</span>
          <span className="text-xs text-muted-foreground">{text(CUSTOMER_TYPE_TEXT[row.customerType])}</span>
        </div>
      ),
      width: "min-w-[160px]",
    },
    {
      id: "reference",
      header: tx("purchases.registers.col.reference", "Reference"),
      cell: (row) =>
        row.reference ? (
          <span className="text-sm">{codeText(row.reference)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      visibility: "md",
    },
    {
      id: "building",
      header: tx("purchases.registers.col.building", "Building"),
      cell: (row) => <span className="text-sm">{row.building ?? "—"}</span>,
      visibility: "lg",
    },
    {
      id: "method",
      header: tx("purchases.registers.col.method", "Method"),
      cell: (row) => <span className="text-sm">{methodText(row.method) || "—"}</span>,
      visibility: "xl",
    },
    {
      id: "status",
      header: tx("purchases.registers.col.status", "Status"),
      cell: (row) => <DocumentStatusBadge status={row.status} />,
    },
    {
      id: "invoiced",
      header: tx("purchases.registers.col.invoiced", "Invoiced"),
      cell: (row) =>
        row.invoiced ? (
          <Money
            value={row.invoiced}
            className={`whitespace-nowrap text-sm ${row.invoiced < 0 ? "text-amber-700 dark:text-amber-400" : ""}`}
          />
        ) : null,
      align: "right",
    },
    {
      id: "vat",
      header: tx("purchases.registers.col.vat", "VAT"),
      cell: (row) => (row.vat ? <Money value={row.vat} className="whitespace-nowrap text-sm text-muted-foreground" /> : null),
      align: "right",
      visibility: "md",
    },
    {
      id: "received",
      header: tx("purchases.registers.col.received", "Received"),
      cell: (row) =>
        row.received ? (
          <Money value={row.received} className="whitespace-nowrap text-sm font-medium text-emerald-700 dark:text-emerald-400" />
        ) : null,
      align: "right",
    },
  ];

  const refused = register.code !== null && register.code !== "REGISTER_TOO_DEEP";

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("purchases.registers.sales.title", "Sales and receipts register")}
        subtitle={tx(
          "purchases.registers.sales.subtitle",
          "Every invoice, credit note and receipt the office issued, in date order.",
        )}
        actions={
          access.canExportSales ? (
            <ReportExportButton
              endpoint="/api/accounting/sales/register"
              params={new URLSearchParams(base)}
              disabled={register.loading || rows.length === 0}
            />
          ) : null
        }
      />

      <ReportFilterBar
        values={draft}
        onChange={setField}
        onApply={filters.apply}
        onReset={filters.reset}
        pending={filters.pending}
        canReset={filters.canReset}
        fields={fields}
        options={options}
        optionsLoading={optionsLoading}
        optionsFailed={optionsFailed}
      />
      {applied.ownerId && (
        <p className="px-1 text-xs text-muted-foreground">
          {tx(
            "purchases.registers.sales.ownerNote",
            "With an owner chosen, the register lists the invoices raised to that owner; tenants' receipts are left out.",
          )}
        </p>
      )}

      {refused ? (
        <PurchasesNotice message={register.error ?? ""} tone="error" />
      ) : (
        <>
          <SummaryTiles
            loading={register.loading && !totals}
            items={[
              { label: tx("purchases.registers.totals.invoiced", "Invoiced"), value: <Money value={totals?.invoiced ?? 0} /> },
              {
                label: tx("purchases.registers.totals.creditNotes", "Credit notes"),
                value: <Money value={totals?.creditNotes ?? 0} />,
              },
              {
                label: tx("purchases.registers.totals.netInvoiced", "Net invoiced"),
                value: <Money value={totals?.netInvoiced ?? 0} />,
              },
              { label: tx("purchases.registers.totals.vat", "VAT"), value: <Money value={totals?.vat ?? 0} /> },
              {
                label: tx("purchases.registers.totals.received", "Received"),
                value: <Money value={totals?.received ?? 0} />,
                tone: "good",
              },
            ]}
          />
          <p className="px-1 text-xs text-muted-foreground">
            {tx(
              "purchases.registers.sales.totalsNote",
              "The totals cover everything the filters match, not only this page. Cancelled invoices and refunded receipts are listed but not counted.",
            )}
          </p>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <GlobalSearch
                  placeholder={tx(
                    "purchases.registers.sales.search",
                    "Search by invoice or receipt number, or customer name",
                  )}
                  ariaLabel={tx("purchases.registers.sales.searchLabel", "Search the sales register")}
                  initialValue={search}
                  debounceDelay={300}
                  onSearch={onSearch}
                  isLoading={register.loading && Boolean(search)}
                  className="min-w-0 flex-1"
                  inputClassName="h-10 bg-white dark:bg-gray-800"
                />
                <OrderSelect id="sales-register-order" value={order} onChange={setOrder} />
              </div>
              <DataTable
                columns={columns}
                data={rows}
                loading={register.loading}
                error={register.code === "REGISTER_TOO_DEEP" ? { message: register.error ?? "" } : null}
                getRowKey={(row) => row.key}
                // The register is in date order across every page, which the
                // date header and the order menu beside it both turn round;
                // the API orders by nothing else, so the other headers stay
                // plain.
                sort={{
                  key: "date",
                  direction: order,
                  onSortChange: (key, direction) =>
                    setOrder(keepSorted({ key: "date", direction: order }, { key, direction }).direction),
                }}
                emptyState={{
                  icon: <ScrollText className="h-12 w-12 text-muted-foreground" />,
                  title: tx("purchases.registers.empty.title", "No documents for these filters"),
                  description: tx("purchases.registers.empty.body", "Change the period or the filters to see more."),
                }}
              />
              {!register.loading && register.total > 0 && (
                <LedgerPagination
                  page={register.page}
                  limit={register.limit}
                  total={register.total}
                  onPageChange={register.setPage}
                  onLimitChange={register.setLimit}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
