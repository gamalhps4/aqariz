"use client";

/**
 * PropertyPro - Purchases & Payments register (سجل المشتريات والمدفوعات)
 *
 * Every supplier bill the office entered and every payment voucher it wrote,
 * in date order, with totals over everything the filters match: what was
 * billed (approved bills), the VAT in it, what still waits for approval, and
 * what was paid. The period, supplier, building, document and status are
 * applied together and kept in the address; the search and the order apply
 * at once. A building narrows the bills only: a voucher belongs to no
 * building.
 */

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { keepSorted } from "@/lib/server-sort";
import GlobalSearch from "@/components/ui/global-search";
import { Label } from "@/components/ui/label";
import { ReportExportButton } from "@/components/reports/export-button";
import { ReportFilterBar, type ReportFilterField } from "@/components/reports/report-filter-bar";
import { useReportFilterOptions } from "@/components/reports/use-report-filter-options";
import { useReportFilters, type FilterValues } from "@/components/reports/use-report-filters";
import { presetRange } from "@/lib/report-filters/period";
import { bankDisplayName, type VoucherMethod } from "@/lib/accounting/purchases/types";
import type {
  PurchaseRegisterRow,
  PurchaseRegisterTotals,
  PurchaseRowKind,
  RegisterOrder,
} from "@/lib/accounting/registers";
import { LedgerHeader, LedgerPagination, Money } from "../../setup/_shared/ledger-parts";
import {
  DocumentStatusBadge,
  SupplierPicker,
  VOUCHER_METHOD_TEXT,
  useLedgerText,
  usePurchasesAccess,
  useSupplierOptions,
} from "../../purchases/_shared/purchases-ui";
import { NoPurchasesAccess, RefusalState, SummaryTiles } from "../../purchases/vouchers/_parts/voucher-kit";
import { OrderSelect, useRegisterPage, useStatusText } from "../_parts/register-kit";

type Access = ReturnType<typeof usePurchasesAccess>;

/** The register opens on this month, like the sales register. */
const FILTERS = {
  defaults: (): FilterValues => ({
    ...presetRange("this-month"),
    supplierId: "",
    propertyId: "",
    kind: "",
    status: "",
  }),
};

const OPTION_LISTS = ["buildings"] as const;

/** The filters the route reads under the same name. */
const PASSED_KEYS = ["supplierId", "propertyId", "kind", "status"] as const;

/** A bill's statuses, and a voucher's `posted`; `cancelled` is either's. */
const STATUS_FILTERS = ["pending", "approved", "partially_paid", "paid", "cancelled", "posted"] as const;

const KIND_BADGES: Record<PurchaseRowKind, { variant: "info" | "success"; text: readonly [string, string] }> = {
  bill: { variant: "info", text: ["purchases.registers.kind.bill", "Bill"] },
  payment: { variant: "success", text: ["purchases.registers.kind.payment", "Payment voucher"] },
};

interface PurchaseRegisterData {
  rows: PurchaseRegisterRow[];
  totals: PurchaseRegisterTotals;
}

export default function PurchasesRegisterPage() {
  // useSearchParams (the filters in the address) needs a boundary of its own.
  return (
    <Suspense fallback={null}>
      <PurchasesRegisterGate />
    </Suspense>
  );
}

function PurchasesRegisterGate() {
  const access = usePurchasesAccess();
  const { tx } = useLedgerText();
  if (access.loading) return null;
  if (!access.canView) {
    return (
      <div className="space-y-4">
        <LedgerHeader title={tx("purchases.registers.purchases.title", "Purchases and payments register")} />
        <NoPurchasesAccess />
      </div>
    );
  }
  return <PurchasesRegister access={access} />;
}

function PurchasesRegister({ access }: { access: Access }) {
  const { tx, text, language, formatDate } = useLedgerText();
  const statusText = useStatusText();
  const filters = useReportFilters(FILTERS);
  const { draft, applied, setField } = filters;
  const { options, loading: optionsLoading, failed: optionsFailed } = useReportFilterOptions(OPTION_LISTS);
  const { suppliers } = useSupplierOptions(true, true);
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

  const register = useRegisterPage<PurchaseRegisterData>("/api/accounting/purchases/register", base);
  const rows = register.data?.rows ?? [];
  const totals = register.data?.totals ?? null;

  const onSearch = useCallback((value: string) => setSearch(value), []);

  const fields: ReportFilterField[] = [
    { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
    { kind: "entity", entity: "building" },
    {
      kind: "status",
      key: "kind",
      label: tx("purchases.registers.kindFilter.label", "Document"),
      allLabel: tx("purchases.registers.kindFilter.all", "All documents"),
      options: [
        { value: "bills", label: tx("purchases.registers.kindFilter.bills", "Purchase bills") },
        { value: "payments", label: tx("purchases.registers.kindFilter.payments", "Payment vouchers") },
      ],
    },
    {
      kind: "status",
      key: "status",
      options: STATUS_FILTERS.map((value) => ({ value, label: statusText(value) })),
    },
  ];

  const methodText = (method: string | null) => {
    if (!method) return "";
    const entry = VOUCHER_METHOD_TEXT[method as VoucherMethod];
    return entry ? text(entry) : method;
  };

  const columns: DataTableColumn<PurchaseRegisterRow>[] = [
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
      cell: (row) => (
        <Link href={row.href} className="font-mono text-xs font-medium text-primary hover:underline" dir="ltr">
          {row.documentNumber}
        </Link>
      ),
      width: "min-w-[120px]",
    },
    {
      id: "supplier",
      header: tx("purchases.registers.col.supplier", "Supplier"),
      cell: (row) => <span className="text-sm font-medium">{row.supplierName}</span>,
      width: "min-w-[150px]",
    },
    {
      id: "reference",
      header: tx("purchases.registers.col.reference", "Reference"),
      cell: (row) =>
        row.reference ? (
          <span className="font-mono text-xs" dir="ltr">
            {row.reference}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      visibility: "md",
    },
    {
      id: "dueDate",
      header: tx("purchases.registers.col.dueDate", "Due date"),
      cell: (row) =>
        row.dueDate ? (
          <span className="whitespace-nowrap text-sm">{formatDate(row.dueDate)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      visibility: "lg",
    },
    {
      id: "account",
      header: tx("purchases.registers.col.account", "Account / method"),
      cell: (row) =>
        row.kind === "payment" ? (
          <div className="flex flex-col">
            <span className="text-sm">{bankDisplayName(row.account, language) || "—"}</span>
            {row.method && <span className="text-xs text-muted-foreground">{methodText(row.method)}</span>}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
      visibility: "lg",
    },
    {
      id: "status",
      header: tx("purchases.registers.col.status", "Status"),
      cell: (row) => <DocumentStatusBadge status={row.status} />,
    },
    {
      id: "billed",
      header: tx("purchases.registers.col.billed", "Billed"),
      cell: (row) => (row.billed ? <Money value={row.billed} className="whitespace-nowrap text-sm" /> : null),
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
      id: "paid",
      header: tx("purchases.registers.col.paid", "Paid"),
      cell: (row) =>
        row.paid ? <Money value={row.paid} className="whitespace-nowrap text-sm font-medium" /> : null,
      align: "right",
    },
  ];

  const refused = register.code !== null && register.code !== "REGISTER_TOO_DEEP";

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("purchases.registers.purchases.title", "Purchases and payments register")}
        subtitle={tx(
          "purchases.registers.purchases.subtitle",
          "Every supplier bill the office entered and every payment voucher it wrote, in date order.",
        )}
        actions={
          access.canExport && !refused ? (
            <ReportExportButton
              endpoint="/api/accounting/purchases/register"
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
        leading={
          <div className="w-full min-w-[220px] space-y-1.5 sm:w-auto">
            <Label htmlFor="purchases-register-supplier">{tx("purchases.registers.supplier", "Supplier")}</Label>
            <SupplierPicker
              id="purchases-register-supplier"
              suppliers={suppliers}
              value={draft.supplierId ?? ""}
              includeAll
              onChange={(supplierId) => setField({ supplierId })}
              className="h-10 bg-white dark:bg-gray-800"
            />
          </div>
        }
      />
      {applied.propertyId && (
        <p className="px-1 text-xs text-muted-foreground">
          {tx(
            "purchases.registers.purchases.buildingNote",
            "With a building chosen, the register lists bills only: a payment voucher belongs to no building.",
          )}
        </p>
      )}

      {refused ? (
        <RefusalState code={register.code} message={register.error ?? ""} canManageBooks={access.canManageBooks} />
      ) : (
        <>
          <SummaryTiles
            loading={register.loading && !totals}
            items={[
              { label: tx("purchases.registers.totals.billed", "Billed"), value: <Money value={totals?.billed ?? 0} /> },
              { label: tx("purchases.registers.totals.vat", "VAT"), value: <Money value={totals?.vat ?? 0} /> },
              {
                label: tx("purchases.registers.totals.pending", "Waiting for approval"),
                value: <Money value={totals?.pending ?? 0} />,
                tone: totals && totals.pending > 0 ? "warn" : undefined,
              },
              { label: tx("purchases.registers.totals.paid", "Paid"), value: <Money value={totals?.paid ?? 0} /> },
            ]}
          />
          <p className="px-1 text-xs text-muted-foreground">
            {tx(
              "purchases.registers.purchases.totalsNote",
              "The totals cover everything the filters match, not only this page. Billed counts approved bills, those waiting for approval are shown apart, and cancelled documents are listed but not counted.",
            )}
          </p>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <GlobalSearch
                  placeholder={tx(
                    "purchases.registers.purchases.search",
                    "Search by number, supplier, supplier invoice, reference or notes",
                  )}
                  ariaLabel={tx("purchases.registers.purchases.searchLabel", "Search the purchases register")}
                  initialValue={search}
                  debounceDelay={300}
                  onSearch={onSearch}
                  isLoading={register.loading && Boolean(search)}
                  className="min-w-0 flex-1"
                  inputClassName="h-10 bg-white dark:bg-gray-800"
                />
                <OrderSelect id="purchases-register-order" value={order} onChange={setOrder} />
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
