"use client";

/**
 * PropertyPro - Payments reports
 *
 * The five reports the payments section owes, behind one period + building
 * filter so an operator picks the window once and moves between reports.
 * Export re-runs the same endpoint with `format=csv`, so the file and the
 * screen always show the same figures.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarRange,
  ChevronDown,
  Loader2,
  Receipt,
  TrendingDown,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/payments/methods";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ReportExportButton } from "@/components/reports/export-button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { useModuleAccess } from "@/components/layout/module-access";
import {
  EMPTY_REGISTER_FILTERS,
  NO_REGISTER_OPTIONS,
  RegisterBreakdowns,
  RegisterFilterFields,
  RegisterStatCards,
  RegisterTotalLine,
  registerColumns,
  registerFilterParams,
  type RegisterFilterOptions,
  type RegisterFilterValue,
} from "@/components/payments/PaymentRegisterView";
import {
  paymentReportRowKey,
  type BuildingCollectionsReport,
  type BuildingExpensesReport,
  type CollectionsReport,
  type ReceivablesReport,
  type BuildingCollectionRow,
  type BuildingExpenseRow,
  type ChargeFilter,
  type ChargeGroupTotal,
  type InstallmentPayment,
  type OverdueTenantRow,
  type OverdueTenantsReport,
  type PaymentReportData,
  type PaymentReportRow,
  type PaymentReportType as ReportType,
  type ReceivableRow,
} from "@/types/payment-report";

const REPORTS: Array<{
  type: ReportType;
  labelKey: string;
  fallback: string;
  icon: typeof AlertTriangle;
  /** Reports that answer "what is owed right now" ignore the start date. */
  pointInTime?: boolean;
  /** Reports that can be narrowed to one tenant. */
  byTenant?: boolean;
  /** The rent registers: they list one group of charges at a time. */
  byCharge?: boolean;
}> = [
  {
    // The Collections menu, in its order: overdue tenants, due rent,
    // overdue rent.
    type: "overdue-tenants",
    labelKey: "payments.reports.type.overdueTenants",
    fallback: "Overdue tenants",
    icon: Users,
    pointInTime: true,
    byTenant: true,
    byCharge: true,
  },
  {
    type: "outstanding",
    labelKey: "payments.reports.type.outstanding",
    fallback: "Due rent payments",
    icon: Wallet,
    byTenant: true,
    byCharge: true,
  },
  {
    type: "overdue",
    labelKey: "payments.reports.type.overdue",
    fallback: "Overdue rent payments",
    icon: AlertTriangle,
    pointInTime: true,
    byTenant: true,
    byCharge: true,
  },
  {
    // The client's "Payment Report": every payment received in the period,
    // and every refund, with its breakdowns.
    type: "collections",
    labelKey: "payments.reports.type.collections",
    fallback: "Payment report",
    icon: Receipt,
    byTenant: true,
  },
  {
    type: "collections-by-building",
    labelKey: "payments.reports.type.byBuilding",
    fallback: "Payments by building",
    icon: Building2,
  },
  {
    type: "expenses-by-building",
    labelKey: "payments.reports.type.expensesByBuilding",
    fallback: "Expenses per building",
    icon: TrendingDown,
  },
];

const ALL_BUILDINGS = "__all__";
const ALL_OWNERS = "__all_owners__";
const ALL_TENANTS = "__all_tenants__";

/**
 * The charges a rent register can list. Rent comes first and is the default:
 * the electricity and water a contract bills with its rent are on the same
 * installment, so they come with it. Deposits and other charges are listed
 * on their own and summed beside the rent.
 */
const CHARGE_OPTIONS: Array<{
  value: ChargeFilter;
  labelKey: string;
  fallback: string;
}> = [
  {
    value: "rent",
    labelKey: "payments.reports.charges.rent",
    fallback: "Rent and utilities billed with it",
  },
  {
    value: "deposit",
    labelKey: "payments.reports.charges.deposit",
    fallback: "Security deposits",
  },
  {
    value: "other",
    labelKey: "payments.reports.charges.other",
    fallback: "Other charges",
  },
  {
    value: "all",
    labelKey: "payments.reports.charges.all",
    fallback: "All charges",
  },
];

function isChargeOption(value: unknown): value is ChargeFilter {
  return CHARGE_OPTIONS.some((option) => option.value === value);
}

/** A date from the address ("2026-10-31"), or null when it is not one. */
function isoParam(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The period a report opens on, and the one Reset goes back to: this month
 * to date — or, for due rent, the whole of this month, already late or not
 * yet. Reset used to keep whatever dates were on screen.
 */
function defaultPeriod(type: ReportType): { startDate: string; endDate: string } {
  const now = new Date();
  return {
    startDate: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate:
      type === "outstanding"
        ? isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0))
        : isoDay(now),
  };
}

/** Lines a page of the payment report shows unless the reader picks more. */
const REGISTER_PAGE_SIZE = 25;

/** Each value once, in the order first seen; blanks left out. */
function distinct(values: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

interface PropertyOption {
  id: string;
  name: string;
}

interface OwnerOption {
  /** The owner's USER id — that is what Property.ownerId points at. */
  id: string;
  name: string;
}

interface TenantOption {
  id: string;
  name: string;
  phone?: string;
}

/**
 * Every tenant, for the picker. The list endpoint pages at 100, so this reads
 * pages until there are no more — an office with 300 tenants must be able to
 * pick the 250th.
 */
async function loadAllTenants(): Promise<TenantOption[]> {
  const toOption = (row: {
    _id?: string;
    id?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  }): TenantOption => ({
    id: String(row._id ?? row.id),
    name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || "—",
    phone: row.phone,
  });
  const first = await fetch("/api/tenants?limit=100&page=1");
  if (!first.ok) return [];
  const payload = await first.json();
  const options: TenantOption[] = (payload?.data ?? []).map(toOption);
  const pages = Math.min(Number(payload?.pagination?.pages ?? 1), 20);
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, index) =>
        fetch(`/api/tenants?limit=100&page=${index + 2}`)
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null),
      ),
    );
    for (const page of rest) {
      options.push(...(page?.data ?? []).map(toOption));
    }
  }
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

type Translate = ReturnType<typeof useLocalizationContext>["t"];

/**
 * Parts side by side — a unit, a contract number, a building. Each is
 * isolated, so an Arabic unit name cannot pull the numbers after it into
 * its own direction and swap the order they read in.
 */
function JoinedParts({ parts }: { parts: Array<string | null | undefined> }) {
  const present = parts.filter((part): part is string => Boolean(part));
  return (
    <>
      {present.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && " · "}
          <bdi>{part}</bdi>
        </Fragment>
      ))}
    </>
  );
}

/** An installment's category ("rent", "security_deposit") as words. */
function categoryText(category: string, t: Translate): string {
  return t(`transactions.categories.${category}`, {
    defaultValue: category.replace(/_/g, " "),
  });
}

/** A stored method as words; "—" when none was recorded. */
function methodText(method: string | null | undefined, t: Translate): string {
  if (!method || method === "unspecified") return "—";
  return paymentMethodLabel(method, t);
}

/**
 * The payments on one installment, a line each, under the installment's
 * row. The client asked for every payment to appear separately in the
 * arrears reports, with its date clearly shown.
 */
function InstallmentPaymentLines({
  payments,
}: {
  payments: InstallmentPayment[];
}) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  if (payments.length === 0) return null;

  const onlineLabel = t("payments.table.recordedOnline", {
    defaultValue: "Online",
  });
  const cell = "py-1 pe-4 align-top";

  return (
    <div className="ms-2 border-s-2 border-primary/20 ps-3">
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        {t("payments.reports.lines.title", {
          defaultValue: "Payments on this installment",
        })}
      </p>
      <table className="text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className={cn(cell, "text-start font-normal")}>
              {t("payments.table.number", { defaultValue: "Payment No." })}
            </th>
            <th className={cn(cell, "text-start font-normal")}>
              {t("payments.reports.columns.paymentDate", {
                defaultValue: "Payment date",
              })}
            </th>
            <th className={cn(cell, "text-end font-normal")}>
              {t("payments.reports.columns.amount", { defaultValue: "Amount" })}
            </th>
            <th className={cn(cell, "text-start font-normal")}>
              {t("payments.reports.columns.method", { defaultValue: "Method" })}
            </th>
            <th className={cn(cell, "text-start font-normal")}>
              {t("payments.reports.columns.reference", {
                defaultValue: "Reference",
              })}
            </th>
            <th className={cn(cell, "text-start font-normal")}>
              {t("payments.reports.columns.recordedBy", {
                defaultValue: "Recorded by",
              })}
            </th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr
              key={payment.paymentId}
              className="border-t border-gray-100 dark:border-gray-700"
            >
              <td className={cn(cell, "whitespace-nowrap font-mono")}>
                <bdi dir="ltr">{payment.paymentNumber ?? "—"}</bdi>
              </td>
              <td className={cn(cell, "font-medium")}>
                {formatDate(payment.paidDate)}
              </td>
              <td className={cn(cell, "text-end")}>
                {formatCurrency(payment.amount)}
              </td>
              <td className={cell}>{methodText(payment.method, t)}</td>
              <td className={cell}>
                {payment.reference ? (
                  <span className="font-mono" dir="ltr">
                    {payment.reference}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className={cell}>
                {payment.recordedBy ?? (payment.online ? onlineLabel : "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One overdue tenant opened up: the installments behind the totals, each
 * with what was paid on it and when.
 */
function TenantInstallments({
  installments,
}: {
  installments: ReceivableRow[];
}) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const head = "px-3 py-2 font-medium";
  const cell = "px-3 py-2 align-top";

  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead className="bg-gray-50/50 text-xs text-muted-foreground dark:bg-gray-800/50">
          <tr>
            <th className={cn(head, "text-start")}>
              {t("payments.reports.columns.installment", {
                defaultValue: "Installment",
              })}
            </th>
            <th className={cn(head, "text-start")}>
              {t("payments.reports.columns.due", { defaultValue: "Due" })}
            </th>
            <th className={cn(head, "text-center")}>
              {t("payments.reports.columns.age", {
                defaultValue: "Days overdue",
              })}
            </th>
            <th className={cn(head, "text-end")}>
              {t("payments.reports.columns.invoiced", {
                defaultValue: "Invoiced",
              })}
            </th>
            <th className={cn(head, "text-end")}>
              {t("payments.reports.columns.paid", { defaultValue: "Paid" })}
            </th>
            <th className={cn(head, "text-start")}>
              {t("payments.reports.columns.lastPayment", {
                defaultValue: "Last payment",
              })}
            </th>
            <th className={cn(head, "text-end")}>
              {t("payments.reports.columns.balance", {
                defaultValue: "Balance",
              })}
            </th>
          </tr>
        </thead>
        <tbody>
          {installments.map((row) => (
            <Fragment key={row.invoiceId}>
              <tr className="border-t border-gray-100 dark:border-gray-700">
                <td className={cell}>
                  <span className="block font-mono text-xs">
                    {row.invoiceNumber}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    <JoinedParts
                      parts={[
                        categoryText(row.category, t),
                        row.contractNumber,
                        row.propertyName,
                        row.unitNumber,
                      ]}
                    />
                  </span>
                </td>
                <td className={cell}>{formatDate(row.dueDate)}</td>
                <td className={cn(cell, "text-center")}>
                  <Badge
                    variant="outline"
                    className="border-error/20 bg-error/10 text-xs text-error"
                  >
                    {row.daysOverdue}
                  </Badge>
                </td>
                <td className={cn(cell, "text-end")}>
                  {formatCurrency(row.totalAmount)}
                </td>
                <td className={cn(cell, "text-end")}>
                  {formatCurrency(row.amountPaid)}
                </td>
                <td className={cell}>
                  {row.lastPaymentDate ? formatDate(row.lastPaymentDate) : "—"}
                </td>
                <td className={cn(cell, "text-end font-semibold text-error")}>
                  {formatCurrency(row.balance)}
                </td>
              </tr>
              {row.payments.length > 0 && (
                <tr>
                  <td colSpan={7} className="px-3 pb-3">
                    <InstallmentPaymentLines payments={row.payments} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The collection registers in the menu are this page with a different
 * `?type=`. Moving between them keeps the page mounted, and the type was read
 * from the address only once, so the second link left the first register on
 * screen. Keyed on the type, the page starts afresh for each link.
 */
export default function PaymentReportsPage() {
  const search = useSearchParams();
  return <PaymentReports key={search.get("type") ?? ""} />;
}

function PaymentReports() {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const search = useSearchParams();
  // Each register is its own module of the package; the selector offers only
  // those the office's package includes (the open one always stays listed —
  // the page guard decides that one).
  const { canOpen } = useModuleAccess();

  const [reportType, setReportType] = useState<ReportType>(() => {
    // Linked to from the dashboard indicators and the menu, so the page
    // opens on the register that was asked for.
    const asked = search.get("type");
    return REPORTS.some((entry) => entry.type === asked)
      ? (asked as ReportType)
      : "overdue";
  });
  // A link can carry the window — the dashboard's "Due" card opens the
  // due-rent register on exactly the days its figure covers. Otherwise the
  // report's own default period (see defaultPeriod).
  const [startDate, setStartDate] = useState(
    () => isoParam(search.get("startDate")) ?? defaultPeriod(reportType).startDate,
  );
  const [endDate, setEndDate] = useState(
    () => isoParam(search.get("endDate")) ?? defaultPeriod(reportType).endDate,
  );
  // The payment report's own filters, and the page of it on screen.
  const [registerFilters, setRegisterFilters] = useState<RegisterFilterValue>(
    EMPTY_REGISTER_FILTERS,
  );
  const [registerOptions, setRegisterOptions] =
    useState<RegisterFilterOptions>(NO_REGISTER_OPTIONS);
  const [registerPage, setRegisterPage] = useState(1);
  const [registerLimit, setRegisterLimit] = useState(REGISTER_PAGE_SIZE);
  const [propertyId, setPropertyId] = useState(ALL_BUILDINGS);
  const [ownerId, setOwnerId] = useState(ALL_OWNERS);
  const [tenantId, setTenantId] = useState(ALL_TENANTS);
  const [category, setCategory] = useState<ChargeFilter>(() => {
    const asked = search.get("category");
    return isChargeOption(asked) ? asked : "rent";
  });

  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [data, setData] = useState<PaymentReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Overdue tenants opened up to show their installments. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleTenant = useCallback((tenantId: string) => {
    setExpanded((open) => {
      const next = new Set(open);
      if (next.has(tenantId)) next.delete(tenantId);
      else next.add(tenantId);
      return next;
    });
  }, []);

  const activeReport = REPORTS.find((report) => report.type === reportType)!;

  /**
   * The filters the report was last RUN with, as opposed to what the controls
   * show. Only Apply writes here, so changing three filters fetches once for
   * the combination actually asked for — not three times, twice for
   * combinations nobody wanted. See the leases report for the same shape.
   */
  const [applied, setApplied] = useState({
    startDate,
    endDate,
    propertyId: ALL_BUILDINGS,
    ownerId: ALL_OWNERS,
    tenantId: ALL_TENANTS,
    category,
    register: EMPTY_REGISTER_FILTERS,
  });

  const pending =
    applied.startDate !== startDate ||
    applied.endDate !== endDate ||
    applied.propertyId !== propertyId ||
    applied.ownerId !== ownerId ||
    applied.tenantId !== tenantId ||
    applied.category !== category ||
    (reportType === "collections" &&
      JSON.stringify(applied.register) !== JSON.stringify(registerFilters));

  const applyFilters = () => {
    setRegisterPage(1);
    setApplied({
      startDate,
      endDate,
      propertyId,
      ownerId,
      tenantId,
      category,
      register: registerFilters,
    });
  };

  /**
   * Back to how the report opens: every filter cleared, and the report's own
   * default period — not whatever dates were on screen.
   */
  const resetFilters = () => {
    const period = defaultPeriod(reportType);
    setStartDate(period.startDate);
    setEndDate(period.endDate);
    setPropertyId(ALL_BUILDINGS);
    setOwnerId(ALL_OWNERS);
    setTenantId(ALL_TENANTS);
    setCategory("rent");
    setRegisterFilters(EMPTY_REGISTER_FILTERS);
    setRegisterPage(1);
    setApplied({
      ...period,
      propertyId: ALL_BUILDINGS,
      ownerId: ALL_OWNERS,
      tenantId: ALL_TENANTS,
      category: "rent",
      register: EMPTY_REGISTER_FILTERS,
    });
  };

  /** Switch the listed charges and run the report at once. */
  const showCharges = (next: ChargeFilter) => {
    setCategory(next);
    setApplied({
      startDate,
      endDate,
      propertyId,
      ownerId,
      tenantId,
      category: next,
      register: registerFilters,
    });
  };

  const query = useMemo(() => {
    // An "as at" register reads one date. Sending the hidden start date too
    // made every "as at" before the first of the month a refused range.
    const params = new URLSearchParams({ type: reportType });
    if (!activeReport.pointInTime) params.set("startDate", applied.startDate);
    params.set("endDate", applied.endDate);
    if (applied.propertyId !== ALL_BUILDINGS)
      params.set("propertyId", applied.propertyId);
    if (applied.ownerId !== ALL_OWNERS) params.set("ownerId", applied.ownerId);
    if (activeReport.byTenant && applied.tenantId !== ALL_TENANTS)
      params.set("tenantId", applied.tenantId);
    if (activeReport.byCharge) params.set("category", applied.category);
    if (reportType === "collections") registerFilterParams(applied.register, params);
    return params;
  }, [
    reportType,
    applied,
    activeReport.byTenant,
    activeReport.byCharge,
    activeReport.pointInTime,
  ]);

  /** What the screen asks for: the filters, and for the payment report a page. */
  const screenQuery = useMemo(() => {
    const params = new URLSearchParams(query);
    if (reportType === "collections") {
      params.set("page", String(registerPage));
      params.set("limit", String(registerLimit));
    }
    return params;
  }, [query, reportType, registerPage, registerLimit]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/properties?limit=200")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.success) return;
        setProperties(
          (payload.data ?? []).map((row: any) => ({
            id: row.id,
            name: row.name,
          })),
        );
      })
      .catch(() => setProperties([]));

    // The owners list is derived from who owns property, so it needs no
    // separate "has a profile" filter — see lib/services/owner.service.ts.
    fetch("/api/owners")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.success) return;
        setOwners(
          (payload.data ?? []).map((row: any) => ({
            id: row.userId,
            name: row.companyName || row.name,
          })),
        );
      })
      .catch(() => setOwners([]));

    loadAllTenants()
      .then((options) => {
        if (!cancelled) setTenants(options);
      })
      .catch(() => setTenants([]));

    // The payment report's compound, recorded-by and method choices.
    fetch("/api/payments/filter-options")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.success) return;
        setRegisterOptions({
          compounds: payload.data?.compounds ?? [],
          recorders: payload.data?.recorders ?? [],
          methods: payload.data?.methods ?? [],
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/payments/reports?${screenQuery}`);
      const payload = await response.json();
      if (payload?.success) {
        setData(payload.data);
        setError(null);
      } else {
        setData(null);
        setError(
          payload?.error ??
            t("payments.reports.loadError", {
              defaultValue: "Could not generate the report",
            }),
        );
      }
    } catch (loadError) {
      console.error("Failed to load report:", loadError);
      setError(
        t("payments.reports.loadError", {
          defaultValue: "Could not generate the report",
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [screenQuery, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Each report has its own row and summary shape; the branches below narrow
  // to the right one, and the table is fed the union.
  const summary = data?.summary;
  const rows: PaymentReportRow[] = data?.rows ?? [];
  const registerPagination =
    reportType === "collections" && data && "pagination" in data
      ? (data as CollectionsReport).pagination
      : null;

  const columns: DataTableColumn<PaymentReportRow>[] = useMemo(() => {
    if (reportType === "overdue-tenants") {
      return [
        {
          id: "tenant",
          header: t("payments.reports.columns.tenant", {
            defaultValue: "Tenant",
          }),
          cell: (row) => {
            const tenant = row as OverdueTenantRow;
            const open = expanded.has(tenant.tenantId);
            // Opens the tenant up into the installments behind the totals.
            return (
              <button
                type="button"
                onClick={() => toggleTenant(tenant.tenantId)}
                aria-expanded={open}
                title={
                  open
                    ? t("payments.reports.hideInstallments", {
                        defaultValue: "Hide installments",
                      })
                    : t("payments.reports.showInstallments", {
                        defaultValue: "Show installments",
                      })
                }
                className="flex items-start gap-2 rounded-sm text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    !open && "ltr:-rotate-90 rtl:rotate-90",
                  )}
                />
                <span className="block font-medium">
                  {tenant.tenantName || "—"}
                </span>
              </button>
            );
          },
          width: "min-w-[150px]",
        },
        {
          id: "mobile",
          header: t("payments.reports.columns.mobile", {
            defaultValue: "Mobile",
          }),
          cell: (row) => {
            const phone = (row as OverdueTenantRow).tenantPhone;
            return phone ? (
              <span className="whitespace-nowrap text-sm" dir="ltr">
                <bdi>{phone}</bdi>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            );
          },
        },
        {
          id: "contracts",
          header: t("payments.reports.columns.contracts", {
            defaultValue: "Contracts",
          }),
          cell: (row) => (
            <span className="block font-mono text-xs">
              {(row as OverdueTenantRow).contracts.join(", ") || "—"}
            </span>
          ),
          visibility: "md",
          width: "min-w-[100px]",
        },
        {
          // Every building and unit the tenant is late on, each in its own
          // column, as on the installment registers.
          id: "building",
          header: t("payments.reports.columns.building", {
            defaultValue: "Building",
          }),
          cell: (row) => {
            const buildings = distinct(
              (row as OverdueTenantRow).installments.map(
                (installment) => installment.propertyName,
              ),
            );
            return (
              <span className="text-sm">{buildings.join(", ") || "—"}</span>
            );
          },
          visibility: "md",
          width: "min-w-[120px]",
        },
        {
          id: "unit",
          header: t("payments.reports.columns.unit", { defaultValue: "Unit" }),
          cell: (row) => {
            const units = distinct(
              (row as OverdueTenantRow).installments.map(
                (installment) => installment.unitNumber,
              ),
            );
            return units.length ? (
              <bdi className="text-sm">{units.join(", ")}</bdi>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            );
          },
          visibility: "md",
          width: "min-w-[70px]",
        },
        {
          id: "installments",
          header: t("payments.reports.columns.installments", {
            defaultValue: "Installments",
          }),
          cell: (row) => (
            <span className="text-sm">
              {(row as OverdueTenantRow).installmentCount}
            </span>
          ),
          align: "center",
          width: "min-w-[110px]",
        },
        {
          id: "oldest",
          header: t("payments.reports.columns.oldestDue", {
            defaultValue: "Oldest due date",
          }),
          cell: (row) => (
            <span className="text-sm">
              {formatDate((row as OverdueTenantRow).oldestDueDate)}
            </span>
          ),
          visibility: "md",
          width: "min-w-[130px]",
        },
        {
          id: "age",
          header: t("payments.reports.columns.age", {
            defaultValue: "Days overdue",
          }),
          cell: (row) => (
            <Badge
              variant="outline"
              className="border-error/20 bg-error/10 text-xs text-error"
            >
              {(row as OverdueTenantRow).maxDaysOverdue}
            </Badge>
          ),
          align: "center",
          width: "min-w-[110px]",
        },
        {
          id: "overdue",
          header: t("payments.reports.columns.overdueAmount", {
            defaultValue: "Overdue amount",
          }),
          cell: (row) => (
            <span className="text-sm font-semibold text-error">
              {formatCurrency((row as OverdueTenantRow).totalOverdue)}
            </span>
          ),
          align: "right",
          width: "min-w-[130px]",
        },
      ];
    }

    if (reportType === "overdue" || reportType === "outstanding") {
      // Nine columns, so the balance stays on a laptop screen: what the
      // installment is for sits under its number, how late it is beside its
      // due date, and what was paid under what was invoiced. The mobile, the
      // building and the unit each have their own column, as the client
      // asked.
      return [
        {
          id: "invoice",
          header: t("payments.reports.columns.invoice", {
            defaultValue: "Invoice",
          }),
          cell: (row) => {
            const installment = row as ReceivableRow;
            return (
              <div>
                <span className="block font-mono text-xs">
                  {installment.invoiceNumber}
                </span>
                {installment.contractNumber && (
                  <span className="block font-mono text-xs text-muted-foreground">
                    {installment.contractNumber}
                  </span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {categoryText(installment.category, t)}
                  {installment.utilitiesAmount > 0 &&
                    ` · ${t("payments.reports.inclUtilities", {
                      defaultValue: "incl. utilities {amount}",
                      values: {
                        amount: formatCurrency(installment.utilitiesAmount),
                      },
                    })}`}
                </span>
              </div>
            );
          },
          width: "min-w-[130px]",
        },
        {
          id: "tenant",
          header: t("payments.reports.columns.tenant", {
            defaultValue: "Tenant",
          }),
          cell: (row) => (
            <span className="text-sm">
              {(row as ReceivableRow).tenantName || "—"}
            </span>
          ),
          width: "min-w-[140px]",
        },
        {
          id: "mobile",
          header: t("payments.reports.columns.mobile", {
            defaultValue: "Mobile",
          }),
          cell: (row) => {
            const phone = (row as ReceivableRow).tenantPhone;
            return phone ? (
              <span className="whitespace-nowrap text-sm" dir="ltr">
                <bdi>{phone}</bdi>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            );
          },
          width: "min-w-[120px]",
        },
        {
          id: "building",
          header: t("payments.reports.columns.building", {
            defaultValue: "Building",
          }),
          cell: (row) => (
            <span className="text-sm">
              {(row as ReceivableRow).propertyName || "—"}
            </span>
          ),
          visibility: "md",
          width: "min-w-[120px]",
        },
        {
          id: "unit",
          header: t("payments.reports.columns.unit", { defaultValue: "Unit" }),
          cell: (row) =>
            (row as ReceivableRow).unitNumber ? (
              <bdi className="text-sm">{(row as ReceivableRow).unitNumber}</bdi>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            ),
          visibility: "md",
          width: "min-w-[70px]",
        },
        {
          // The due date, and whether it is merely due or already late —
          // the distinction the review asks to be clear at a glance.
          id: "due",
          header: t("payments.reports.columns.due", { defaultValue: "Due" }),
          cell: (row) => {
            const installment = row as ReceivableRow;
            return (
              <div className="space-y-1">
                <span className="block text-sm">
                  {formatDate(installment.dueDate)}
                </span>
                {installment.state === "overdue" ? (
                  <Badge
                    variant="outline"
                    className="border-error/20 bg-error/10 text-xs font-normal text-error"
                  >
                    {t("payments.reports.state.overdue", {
                      defaultValue: "Overdue",
                    })}{" "}
                    · {installment.daysOverdue}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-warning/20 bg-warning/10 text-xs font-normal text-warning"
                  >
                    {t("payments.reports.state.due", { defaultValue: "Due" })}
                  </Badge>
                )}
              </div>
            );
          },
          width: "min-w-[120px]",
        },
        {
          // Invoiced, the part payments already made, and when the last one
          // came in; each payment is listed under the row.
          id: "paid",
          header: t("payments.reports.columns.invoicedPaid", {
            defaultValue: "Invoiced / paid",
          }),
          cell: (row) => {
            const installment = row as ReceivableRow;
            return (
              <div className="text-sm">
                <span className="block">
                  {formatCurrency(installment.totalAmount)}
                </span>
                {installment.amountPaid > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    {t("payments.table.paidSoFar", {
                      defaultValue: "{{amount}} paid",
                      values: { amount: formatCurrency(installment.amountPaid) },
                    })}
                  </span>
                )}
                {installment.lastPaymentDate && (
                  <span className="block text-xs text-muted-foreground">
                    {t("payments.reports.lastPaidOn", {
                      defaultValue: "Last paid {date}",
                      values: { date: formatDate(installment.lastPaymentDate) },
                    })}
                  </span>
                )}
              </div>
            );
          },
          align: "right",
          visibility: "md",
          width: "min-w-[130px]",
        },
        {
          id: "balance",
          header: t("payments.reports.columns.balance", {
            defaultValue: "Balance",
          }),
          cell: (row) => (
            <span className="text-sm font-semibold">
              {formatCurrency((row as ReceivableRow).balance)}
            </span>
          ),
          align: "right",
          width: "min-w-[120px]",
        },
      ];
    }

    if (reportType === "collections") {
      return registerColumns(t, formatCurrency, formatDate) as DataTableColumn<PaymentReportRow>[];
    }

    if (reportType === "collections-by-building") {
      return [
        {
          id: "building",
          header: t("payments.reports.columns.building", {
            defaultValue: "Building",
          }),
          cell: (row) => {
            const building = row as BuildingCollectionRow;
            return (
              <div className="text-sm">
                <span className="block font-medium">
                  {building.propertyName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {building.city}
                </span>
              </div>
            );
          },
          width: "min-w-[200px]",
        },
        {
          id: "count",
          header: t("payments.reports.columns.payments", {
            defaultValue: "Payments",
          }),
          cell: (row) => (
            <span className="text-sm">
              {(row as BuildingCollectionRow).paymentCount}
            </span>
          ),
          align: "center",
          width: "min-w-[110px]",
        },
        {
          id: "collected",
          header: t("payments.reports.columns.collected", {
            defaultValue: "Collected",
          }),
          cell: (row) => (
            <span className="text-sm font-semibold text-success">
              {formatCurrency((row as BuildingCollectionRow).collected)}
            </span>
          ),
          align: "right",
          width: "min-w-[130px]",
        },
        {
          id: "outstanding",
          header: t("payments.reports.columns.outstanding", {
            defaultValue: "Outstanding",
          }),
          cell: (row) => (
            <span className="text-sm">
              {formatCurrency((row as BuildingCollectionRow).outstanding)}
            </span>
          ),
          align: "right",
          width: "min-w-[130px]",
        },
      ];
    }

    return [
      {
        id: "building",
        header: t("payments.reports.columns.building", {
          defaultValue: "Building",
        }),
        cell: (row) => {
          const building = row as BuildingExpenseRow;
          return (
            <div className="text-sm">
              <span className="block font-medium">{building.propertyName}</span>
              <span className="block text-xs text-muted-foreground">
                {building.city}
              </span>
            </div>
          );
        },
        width: "min-w-[200px]",
      },
      {
        id: "count",
        header: t("payments.reports.columns.entries", {
          defaultValue: "Entries",
        }),
        cell: (row) => (
          <span className="text-sm">
            {(row as BuildingExpenseRow).expenseCount}
          </span>
        ),
        align: "center",
        width: "min-w-[100px]",
      },
      {
        id: "topCategory",
        header: t("payments.reports.columns.topCategory", {
          defaultValue: "Top category",
        }),
        cell: (row) => {
          const category = (row as BuildingExpenseRow).topCategory;
          return (
            <Badge variant="outline" className="text-xs font-normal">
              {category
                ? t(`expenses.categories.${category}`, {
                    defaultValue: category.replace(/_/g, " "),
                  })
                : "—"}
            </Badge>
          );
        },
        visibility: "md",
        width: "min-w-[150px]",
      },
      {
        id: "total",
        header: t("payments.reports.columns.total", { defaultValue: "Total" }),
        cell: (row) => (
          <span className="text-sm font-semibold text-error">
            {formatCurrency((row as BuildingExpenseRow).total)}
          </span>
        ),
        align: "right",
        width: "min-w-[130px]",
      },
    ];
  }, [reportType, t, formatCurrency, formatDate, expanded, toggleTenant]);

  /**
   * What sits under a row: an installment's payments on the two receivables
   * registers, and an opened tenant's installments on the overdue tenants.
   */
  const renderRowDetail = useCallback(
    (row: PaymentReportRow) => {
      if (reportType === "overdue" || reportType === "outstanding") {
        const installment = row as ReceivableRow;
        return installment.payments?.length ? (
          <InstallmentPaymentLines payments={installment.payments} />
        ) : null;
      }
      if (reportType === "overdue-tenants") {
        const tenant = row as OverdueTenantRow;
        return expanded.has(tenant.tenantId) ? (
          <TenantInstallments installments={tenant.installments ?? []} />
        ) : null;
      }
      return null;
    },
    [reportType, expanded],
  );

  /**
   * What is owed in the charges this register does not list — a deposit is
   * reported beside the rent rather than mixed into it, or dropped. Each
   * opens as its own list.
   */
  const otherCharges = () => {
    if (!activeReport.byCharge || !summary) return null;
    const stats = summary as {
      category?: ChargeFilter;
      byCategory?: ChargeGroupTotal[];
    };
    const listed = stats.category ?? applied.category;
    if (listed === "all") return null;
    const others = (stats.byCategory ?? []).filter(
      (group) => group.group !== listed && group.invoiceCount > 0,
    );
    if (others.length === 0) return null;

    return (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-gray-200/60 bg-gray-50/50 px-4 py-3 text-sm dark:border-gray-700/60 dark:bg-gray-800/50">
        <span className="text-muted-foreground">
          {t("payments.reports.listedSeparately", {
            defaultValue: "Listed separately:",
          })}
        </span>
        {others.map((group) => {
          const option = CHARGE_OPTIONS.find(
            (entry) => entry.value === group.group,
          )!;
          return (
            <span key={group.group} className="inline-flex items-center gap-2">
              <span className="font-medium">
                {t(option.labelKey, { defaultValue: option.fallback })}
              </span>
              <span>{formatCurrency(group.balance)}</span>
              <Badge variant="outline" className="text-xs font-normal">
                {t("payments.reports.installmentCount", {
                  defaultValue: "Installments: {count}",
                  values: { count: group.invoiceCount },
                })}
              </Badge>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => showCharges(group.group)}
              >
                {t("payments.reports.showCharges", { defaultValue: "Show" })}
              </Button>
            </span>
          );
        })}
      </div>
    );
  };

  const statCards = () => {
    if (!summary) return null;

    if (reportType === "overdue-tenants") {
      const stats = summary as OverdueTenantsReport["summary"];
      return (
        <AnalyticsCardGrid className="lg:grid-cols-4">
          <AnalyticsCard
            title={t("payments.reports.stats.overdueTenants", {
              defaultValue: "Tenants overdue",
            })}
            value={String(stats.tenantCount)}
            icon={Users}
            iconColor="primary"
            description={t("payments.reports.stats.installmentsLate", {
              defaultValue: "Late installments: {count}",
              values: { count: stats.installmentCount },
            })}
          />
          <AnalyticsCard
            title={t("payments.reports.stats.overdue", {
              defaultValue: "Overdue",
            })}
            value={formatCurrency(stats.totalOverdue)}
            icon={AlertTriangle}
            iconColor="error"
          />
          <AnalyticsCard
            title={t("payments.reports.stats.days1to60", {
              defaultValue: "Up to 60 days",
            })}
            value={formatCurrency(
              stats.aging.days1to30 + stats.aging.days31to60,
            )}
            icon={CalendarRange}
            iconColor="warning"
          />
          <AnalyticsCard
            title={t("payments.reports.stats.over90", {
              defaultValue: "90+ days",
            })}
            value={formatCurrency(stats.over90)}
            icon={CalendarRange}
            iconColor="error"
          />
        </AnalyticsCardGrid>
      );
    }

    if (reportType === "overdue" || reportType === "outstanding") {
      const stats = summary as ReceivablesReport["summary"];
      return (
        <AnalyticsCardGrid className="lg:grid-cols-4">
          <AnalyticsCard
            title={t("payments.reports.stats.invoices", {
              defaultValue: "Invoices",
            })}
            value={String(stats.invoiceCount)}
            icon={Receipt}
            iconColor="primary"
            description={t("payments.reports.stats.tenants", {
              defaultValue: "{count} tenants",
              values: { count: stats.tenantCount },
            })}
          />
          <AnalyticsCard
            title={t("payments.reports.stats.balance", {
              defaultValue: "Total balance",
            })}
            value={formatCurrency(stats.totalBalance)}
            icon={Wallet}
            iconColor="warning"
          />
          <AnalyticsCard
            title={t("payments.reports.stats.overdue", {
              defaultValue: "Overdue",
            })}
            value={formatCurrency(stats.overdueBalance)}
            icon={AlertTriangle}
            iconColor="error"
          />
          <AnalyticsCard
            title={t("payments.reports.stats.over90", {
              defaultValue: "90+ days",
            })}
            value={formatCurrency(stats.aging.days90plus)}
            icon={CalendarRange}
            iconColor="error"
            description={t("payments.reports.stats.aging", {
              defaultValue: "1-30: {a} · 31-60: {b} · 61-90: {c}",
              values: {
                a: formatCurrency(stats.aging.days1to30),
                b: formatCurrency(stats.aging.days31to60),
                c: formatCurrency(stats.aging.days61to90),
              },
            })}
          />
        </AnalyticsCardGrid>
      );
    }

    if (reportType === "collections") {
      return (
        <RegisterStatCards summary={summary as CollectionsReport["summary"]} />
      );
    }

    if (reportType === "collections-by-building") {
      const stats = summary as BuildingCollectionsReport["summary"];
      return (
        <AnalyticsCardGrid className="lg:grid-cols-3">
          <AnalyticsCard
            title={t("payments.reports.stats.buildings", {
              defaultValue: "Buildings",
            })}
            value={String(stats.buildingCount)}
            icon={Building2}
            iconColor="primary"
          />
          <AnalyticsCard
            title={t("payments.reports.stats.collected", {
              defaultValue: "Collected",
            })}
            value={formatCurrency(stats.totalCollected)}
            icon={Wallet}
            iconColor="success"
          />
          <AnalyticsCard
            title={t("payments.reports.stats.outstanding", {
              defaultValue: "Outstanding",
            })}
            value={formatCurrency(stats.totalOutstanding)}
            icon={AlertTriangle}
            iconColor="warning"
          />
        </AnalyticsCardGrid>
      );
    }

    const stats = summary as BuildingExpensesReport["summary"];
    return (
      <AnalyticsCardGrid className="lg:grid-cols-3">
        <AnalyticsCard
          title={t("payments.reports.stats.buildings", {
            defaultValue: "Buildings",
          })}
          value={String(stats.buildingCount)}
          icon={Building2}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("payments.reports.stats.expenses", {
            defaultValue: "Total expenses",
          })}
          value={formatCurrency(stats.totalExpenses)}
          icon={TrendingDown}
          iconColor="error"
          description={t("payments.reports.stats.entries", {
            defaultValue: "{count} entries",
            values: { count: stats.expenseCount },
          })}
        />
        <AnalyticsCard
          title={t("payments.reports.stats.unassigned", {
            defaultValue: "Not assigned to a building",
          })}
          value={formatCurrency(stats.unassignedTotal)}
          icon={Wallet}
          iconColor="warning"
        />
      </AnalyticsCardGrid>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("nav.payments.reports", { defaultValue: "Payment reports" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("payments.reports.subtitle", {
              defaultValue:
                "Overdue and outstanding rent, collections by period and by building, and expenses per building",
            })}
          </p>
        </div>
        <ReportExportButton
          endpoint="/api/payments/reports"
          params={query}
          disabled={loading || rows.length === 0}
        />
      </div>

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1 space-y-1.5">
                <Label>
                  {t("payments.reports.reportLabel", {
                    defaultValue: "Report",
                  })}
                </Label>
                <Select
                  value={reportType}
                  onValueChange={(value) => setReportType(value as ReportType)}
                >
                  <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORTS.filter(
                      (report) =>
                        report.type === reportType ||
                        canOpen(`/dashboard/payments/reports?type=${report.type}`),
                    ).map((report) => (
                      <SelectItem key={report.type} value={report.type}>
                        {t(report.labelKey, { defaultValue: report.fallback })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* A point-in-time report answers "what is owed now", so a start
                  date would be meaningless for it. */}
              {!activeReport.pointInTime && (
                <div className="space-y-1.5">
                  <Label htmlFor="startDate">
                    {t("payments.reports.from", { defaultValue: "From" })}
                  </Label>
                  <Input
                    id="startDate"
                    type="date"
                    className="h-10 bg-white dark:bg-gray-800"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="endDate">
                  {activeReport.pointInTime
                    ? t("payments.reports.asOf", { defaultValue: "As at" })
                    : t("payments.reports.to", { defaultValue: "To" })}
                </Label>
                <Input
                  id="endDate"
                  type="date"
                  className="h-10 bg-white dark:bg-gray-800"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>

              {/* The office manages for several owners, so narrowing a money
                  report to one of them is the first thing asked of it. */}
              <div className="min-w-[200px] space-y-1.5">
                <Label>
                  {t("payments.reports.owner", { defaultValue: "Owner" })}
                </Label>
                <Select value={ownerId} onValueChange={setOwnerId}>
                  <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_OWNERS}>
                      {t("payments.reports.allOwners", {
                        defaultValue: "All owners",
                      })}
                    </SelectItem>
                    {owners.map((owner) => (
                      <SelectItem key={owner.id} value={owner.id}>
                        {owner.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-[200px] space-y-1.5">
                <Label>
                  {t("payments.reports.building", { defaultValue: "Building" })}
                </Label>
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_BUILDINGS}>
                      {t("payments.reports.allBuildings", {
                        defaultValue: "All buildings",
                      })}
                    </SelectItem>
                    {properties.map((property) => (
                      <SelectItem key={property.id} value={property.id}>
                        {property.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* "Allow selecting a specific tenant" — searchable, because an
                  office's tenant list does not fit a plain dropdown. */}
              {activeReport.byTenant && (
                <div className="min-w-[220px] space-y-1.5">
                  <Label>
                    {t("payments.reports.tenant", { defaultValue: "Tenant" })}
                  </Label>
                  <SearchableSelect
                    value={tenantId}
                    onValueChange={(value) => setTenantId(value || ALL_TENANTS)}
                    options={[
                      {
                        value: ALL_TENANTS,
                        label: t("payments.reports.allTenants", {
                          defaultValue: "All tenants",
                        }),
                      },
                      ...tenants.map((tenant) => ({
                        value: tenant.id,
                        label: tenant.name,
                        subtitle: tenant.phone,
                      })),
                    ]}
                    placeholder={t("payments.reports.allTenants", {
                      defaultValue: "All tenants",
                    })}
                    searchPlaceholder={t("payments.reports.searchTenant", {
                      defaultValue: "Search tenants",
                    })}
                    emptyMessage={t("payments.reports.noTenant", {
                      defaultValue: "No tenant matches",
                    })}
                    triggerClassName="h-10 bg-white dark:bg-gray-800"
                  />
                </div>
              )}

              {/* The payment report's own filters: how it was paid, who
                  received it, what for, who recorded it, its status, and
                  the compound, unit or contract. */}
              {reportType === "collections" && (
                <RegisterFilterFields
                  value={registerFilters}
                  onChange={setRegisterFilters}
                  options={registerOptions}
                />
              )}

              {/* Rent unless asked otherwise; deposits and other charges are
                  their own lists, summed beside the rent. */}
              {activeReport.byCharge && (
                <div className="min-w-[220px] space-y-1.5">
                  <Label>
                    {t("payments.reports.chargesLabel", {
                      defaultValue: "Charges",
                    })}
                  </Label>
                  <Select
                    value={category}
                    onValueChange={(value) => setCategory(value as ChargeFilter)}
                  >
                    <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHARGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {t(option.labelKey, { defaultValue: option.fallback })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-10"
                disabled={!pending}
                onClick={applyFilters}
              >
                {t("reports.applyFilters", { defaultValue: "Apply filters" })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-10"
                onClick={resetFilters}
              >
                {t("reports.resetFilters", { defaultValue: "Reset filters" })}
              </Button>
            </div>
          </div>
          {pending && (
            <p className="px-4 pb-2 text-xs text-muted-foreground">
              {t("reports.pendingHint", {
                defaultValue:
                  "Filters changed — the figures below are from the last run.",
              })}
            </p>
          )}
        </CardHeader>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {statCards()}

      {/* The payment report's breakdowns, over every line it matched. */}
      {reportType === "collections" && summary && (
        <RegisterBreakdowns summary={summary as CollectionsReport["summary"]} />
      )}

      {otherCharges()}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <activeReport.icon className="h-4 w-4" />
            {t(activeReport.labelKey, { defaultValue: activeReport.fallback })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              loading={false}
              getRowKey={paymentReportRowKey}
              renderRowDetail={renderRowDetail}
              emptyState={{
                icon: <Receipt className="h-10 w-10 text-muted-foreground" />,
                title: t("payments.reports.empty.title", {
                  defaultValue: "Nothing to report",
                }),
                description: t("payments.reports.empty.description", {
                  defaultValue:
                    "No records match this report for the selected period",
                }),
              }}
            />
          )}
          {/* The payment report pages on the server: the totals above are
              over every line, the table shows one page of them. */}
          {reportType === "collections" && registerPagination && summary && (
            <div className="mt-4 space-y-3">
              <RegisterTotalLine summary={summary as CollectionsReport["summary"]} />
              {registerPagination.total > 0 && (
                <GlobalPagination
                  currentPage={registerPagination.page}
                  totalPages={registerPagination.totalPages}
                  totalItems={registerPagination.total}
                  pageSize={registerPagination.limit}
                  pageSizeOptions={[25, 50, 100, 200]}
                  onPageChange={setRegisterPage}
                  onPageSizeChange={(size) => {
                    setRegisterLimit(size);
                    setRegisterPage(1);
                  }}
                  showingLabel={t("common.showing", { defaultValue: "Showing" })}
                  previousLabel={t("common.previous", { defaultValue: "Previous" })}
                  nextLabel={t("common.next", { defaultValue: "Next" })}
                  pageLabel={t("common.page", { defaultValue: "Page" })}
                  ofLabel={t("common.of", { defaultValue: "of" })}
                  itemsPerPageLabel={t("common.perPage", { defaultValue: "per page" })}
                  disabled={loading}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
