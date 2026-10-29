"use client";

/**
 * PropertyPro - The payment report, on screen
 *
 * The parts of the payments reports page that belong to the payment report
 * (`?type=collections`): its own filters, its figures, its six breakdowns and
 * its table. The page keeps the filters' state so one Apply and one Reset
 * serve every report.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Building2,
  CalendarRange,
  CreditCard,
  Layers,
  Receipt,
  RotateCcw,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DataTableColumn } from "@/components/ui/data-table";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  isolateLtr,
  RemoteOptionSelect,
  searchFilterOptions,
  type RemoteOption,
} from "@/components/payments/RemoteOptionSelect";
import {
  MANUAL_PAYMENT_METHODS,
  paymentMethodLabel,
} from "@/lib/payments/methods";
import { CHARGE_TYPES, paymentTypeLabel } from "@/lib/payments/type-labels";
import { PaymentType } from "@/types";
import type {
  CollectionRow,
  PaymentRegisterGroup,
  PaymentRegisterSummary,
} from "@/types/payment-report";

type Translate = ReturnType<typeof useLocalizationContext>["t"];

export const REGISTER_ANY = "__any__";

/** The payment report's own filters, beside the page's period and building. */
export interface RegisterFilterValue {
  method: string;
  receiver: string;
  paymentType: string;
  recordedBy: string;
  compoundId: string;
  unitId: string;
  leaseId: string;
  status: string;
}

export const EMPTY_REGISTER_FILTERS: RegisterFilterValue = {
  method: REGISTER_ANY,
  receiver: REGISTER_ANY,
  paymentType: REGISTER_ANY,
  recordedBy: REGISTER_ANY,
  compoundId: REGISTER_ANY,
  unitId: REGISTER_ANY,
  leaseId: REGISTER_ANY,
  status: REGISTER_ANY,
};

/** The filters that are set, as the endpoint reads them. */
export function registerFilterParams(
  value: RegisterFilterValue,
  params: URLSearchParams,
): void {
  for (const [key, chosen] of Object.entries(value)) {
    if (chosen && chosen !== REGISTER_ANY) params.set(key, chosen);
  }
}

/** The options the filters offer, from /api/payments/filter-options. */
export interface RegisterFilterOptions {
  compounds: Array<{ id: string; label: string }>;
  recorders: Array<{ id: string; label: string }>;
  methods: string[];
}

export const NO_REGISTER_OPTIONS: RegisterFilterOptions = {
  compounds: [],
  recorders: [],
  methods: [],
};

interface SearchedOption {
  id: string;
  label: string;
  hint?: string;
  tenantPhone?: string;
}

/** The payment report's filter fields, beside the page's own. */
export function RegisterFilterFields({
  value,
  onChange,
  options,
}: {
  value: RegisterFilterValue;
  onChange: (next: RegisterFilterValue) => void;
  options: RegisterFilterOptions;
}) {
  const { t } = useLocalizationContext();
  const set = (key: keyof RegisterFilterValue, chosen: string) =>
    onChange({ ...value, [key]: chosen || REGISTER_ANY });

  const manual = new Set<string>(MANUAL_PAYMENT_METHODS.map((method) => method.value));
  const otherMethods = options.methods.filter((method) => !manual.has(method));

  const loadLeases = async (search: string, chosen: string[]): Promise<RemoteOption[]> =>
    (await searchFilterOptions<SearchedOption>("leases", search, chosen)).map((option) => ({
      value: option.id,
      label: option.label,
      subtitle: [isolateLtr(option.tenantPhone), option.hint].filter(Boolean).join(" · "),
    }));
  const loadUnits = async (search: string, chosen: string[]): Promise<RemoteOption[]> =>
    (await searchFilterOptions<SearchedOption>("units", search, chosen)).map((option) => ({
      value: option.id,
      label: option.label,
      subtitle: option.hint,
    }));

  const field = (label: string, control: ReactNode) => (
    <div className="min-w-[180px] space-y-1.5">
      <Label>{label}</Label>
      {control}
    </div>
  );
  const anyItem = (labelKey: string, fallback: string) => (
    <SelectItem value={REGISTER_ANY}>{t(labelKey, { defaultValue: fallback })}</SelectItem>
  );
  const trigger = "h-10 bg-white dark:bg-gray-800";
  const searchText = {
    searchPlaceholder: t("payments.filters.searchOptions", {
      defaultValue: "Name, mobile, unit or contract number",
    }),
    emptyMessage: t("payments.filters.noOptions", { defaultValue: "Nothing matches" }),
    loadingMessage: t("common.loading", { defaultValue: "Loading…" }),
  };

  return (
    <>
      {field(
        t("payments.reports.filters.method", { defaultValue: "Payment method" }),
        <Select value={value.method} onValueChange={(next) => set("method", next)}>
          <SelectTrigger className={trigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anyItem("payments.filters.allMethods", "All methods")}
            {MANUAL_PAYMENT_METHODS.map((method) => (
              <SelectItem key={method.value} value={method.value}>
                {t(method.labelKey, { defaultValue: method.fallback })}
              </SelectItem>
            ))}
            {otherMethods.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-xs text-muted-foreground">
                  {t("payments.filters.otherMethods", {
                    defaultValue: "Online and other methods",
                  })}
                </SelectLabel>
                {otherMethods.map((method) => (
                  <SelectItem key={method} value={method}>
                    {paymentMethodLabel(method, t)}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            <SelectItem value="unspecified">
              {t("payments.statistics.noMethod", { defaultValue: "Not recorded" })}
            </SelectItem>
          </SelectContent>
        </Select>,
      )}
      {field(
        t("payments.reports.filters.receiver", { defaultValue: "Received by" }),
        <Select value={value.receiver} onValueChange={(next) => set("receiver", next)}>
          <SelectTrigger className={trigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anyItem("payments.reports.filters.anyReceiver", "The office or the owner")}
            <SelectItem value="office">
              {t("payments.reports.receiver.office", { defaultValue: "Received by the office" })}
            </SelectItem>
            <SelectItem value="owner">
              {t("payments.reports.receiver.owner", { defaultValue: "Received by the owner" })}
            </SelectItem>
          </SelectContent>
        </Select>,
      )}
      {field(
        t("payments.reports.filters.type", { defaultValue: "Payment type" }),
        <Select
          value={value.paymentType}
          onValueChange={(next) => set("paymentType", next)}
        >
          <SelectTrigger className={trigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anyItem("payments.filters.allTypes", "All types")}
            {[...CHARGE_TYPES, PaymentType.LATE_FEE].map((type) => (
              <SelectItem key={type} value={type}>
                {paymentTypeLabel(type, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      )}
      {field(
        t("payments.reports.columns.status", { defaultValue: "Status" }),
        <Select value={value.status} onValueChange={(next) => set("status", next)}>
          <SelectTrigger className={trigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anyItem("payments.filters.allStatuses", "All statuses")}
            <SelectItem value="paid">
              {t("payments.status.paid", { defaultValue: "Paid" })}
            </SelectItem>
            <SelectItem value="partial">
              {t("payments.status.partial", { defaultValue: "Partly paid" })}
            </SelectItem>
            <SelectItem value="refunded">
              {t("payments.status.refunded", { defaultValue: "Refunded" })}
            </SelectItem>
          </SelectContent>
        </Select>,
      )}
      {field(
        t("payments.reports.columns.recordedBy", { defaultValue: "Recorded by" }),
        <Select value={value.recordedBy} onValueChange={(next) => set("recordedBy", next)}>
          <SelectTrigger className={trigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anyItem("payments.reports.filters.anyone", "Anyone")}
            <SelectItem value="online">
              {t("payments.table.recordedOnline", { defaultValue: "Online" })}
            </SelectItem>
            {options.recorders.map((recorder) => (
              <SelectItem key={recorder.id} value={recorder.id}>
                {recorder.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      )}
      {field(
        t("collection.filters.compound", { defaultValue: "Compound" }),
        <Select value={value.compoundId} onValueChange={(next) => set("compoundId", next)}>
          <SelectTrigger className={trigger}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anyItem("collection.filters.allCompounds", "All compounds")}
            {options.compounds.map((compound) => (
              <SelectItem key={compound.id} value={compound.id}>
                {compound.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>,
      )}
      {field(
        t("payments.filters.unit", { defaultValue: "Unit" }),
        <RemoteOptionSelect
          value={value.unitId}
          onValueChange={(next) => set("unitId", next)}
          load={loadUnits}
          leading={[
            {
              value: REGISTER_ANY,
              label: t("payments.reports.filters.allUnits", { defaultValue: "All units" }),
            },
          ]}
          placeholder={t("payments.reports.filters.allUnits", { defaultValue: "All units" })}
          triggerClassName={trigger}
          {...searchText}
        />,
      )}
      {field(
        t("payments.filters.contract", { defaultValue: "Contract" }),
        <RemoteOptionSelect
          value={value.leaseId}
          onValueChange={(next) => set("leaseId", next)}
          load={loadLeases}
          leading={[
            {
              value: REGISTER_ANY,
              label: t("payments.reports.filters.allContracts", {
                defaultValue: "All contracts",
              }),
            },
          ]}
          placeholder={t("payments.reports.filters.allContracts", {
            defaultValue: "All contracts",
          })}
          triggerClassName={trigger}
          {...searchText}
        />,
      )}
    </>
  );
}

/** "2026-09" as the month's name in the reader's language. */
function monthName(key: string, language: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  try {
    return new Intl.DateTimeFormat(
      language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : language,
      { month: "long", year: "numeric" },
    ).format(new Date(year, month - 1, 1));
  } catch {
    return key;
  }
}

function methodText(method: string, t: Translate): string {
  return method === "unspecified"
    ? t("payments.statistics.noMethod", { defaultValue: "Not recorded" })
    : paymentMethodLabel(method, t);
}

/** The payment report's headline: received, refunded, and what is left. */
export function RegisterStatCards({ summary }: { summary: PaymentRegisterSummary }) {
  const { t, formatCurrency } = useLocalizationContext();
  return (
    <AnalyticsCardGrid className="lg:grid-cols-4">
      <AnalyticsCard
        title={t("payments.reports.stats.payments", { defaultValue: "Payments" })}
        value={String(summary.paymentCount)}
        icon={Receipt}
        iconColor="primary"
      />
      <AnalyticsCard
        title={t("payments.reports.stats.received", { defaultValue: "Received" })}
        value={formatCurrency(summary.totalReceived)}
        icon={Wallet}
        iconColor="success"
      />
      <AnalyticsCard
        title={t("payments.reports.stats.refunded", { defaultValue: "Refunded" })}
        value={formatCurrency(-summary.totalRefunded)}
        icon={RotateCcw}
        iconColor="warning"
        description={t("payments.statistics.refundCount", {
          defaultValue: "Refunds made: {count}",
          values: { count: summary.refundCount },
        })}
      />
      <AnalyticsCard
        title={t("payments.reports.stats.netCollected", { defaultValue: "Net collected" })}
        value={formatCurrency(summary.totalCollected)}
        icon={Wallet}
        iconColor="info"
      />
    </AnalyticsCardGrid>
  );
}

/** How many groups a breakdown shows before "Show all". */
const FOLDED = 6;

function BreakdownTable({
  title,
  icon: Icon,
  groups,
  label,
}: {
  title: string;
  icon: typeof Receipt;
  groups: PaymentRegisterGroup[];
  label: (group: PaymentRegisterGroup) => string;
}) {
  const { t, formatCurrency } = useLocalizationContext();
  const [open, setOpen] = useState(false);
  const shown = open ? groups : groups.slice(0, FOLDED);
  const anyRefund = groups.some((group) => group.refunded > 0);
  const cell = "px-3 py-1.5 align-top";
  return (
    <Card className="gap-2">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3">
        {groups.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">—</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className={cn(cell, "text-start font-normal")} />
                <th className={cn(cell, "text-center font-normal")}>
                  {t("payments.reports.columns.payments", { defaultValue: "Payments" })}
                </th>
                {anyRefund && (
                  <th className={cn(cell, "text-end font-normal")}>
                    {t("payments.reports.stats.refunded", { defaultValue: "Refunded" })}
                  </th>
                )}
                <th className={cn(cell, "text-end font-normal")}>
                  {t("payments.reports.columns.net", { defaultValue: "Net" })}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((group) => (
                <tr key={group.key} className="border-t border-gray-100 dark:border-gray-700">
                  <td className={cn(cell, "max-w-[160px] truncate font-medium")}>
                    <bdi>{label(group)}</bdi>
                  </td>
                  <td className={cn(cell, "text-center")}>{group.count}</td>
                  {anyRefund && (
                    <td className={cn(cell, "text-end text-orange-600")}>
                      {group.refunded > 0 ? formatCurrency(-group.refunded) : "—"}
                    </td>
                  )}
                  <td className={cn(cell, "text-end font-semibold")}>
                    {formatCurrency(group.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {groups.length > FOLDED && (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-3 py-1 text-xs"
            onClick={() => setOpen((previous) => !previous)}
          >
            {open
              ? t("payments.reports.showFewer", { defaultValue: "Show fewer" })
              : t("payments.reports.showAll", {
                  defaultValue: "Show all ({count})",
                  values: { count: groups.length },
                })}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** The six breakdowns, over every line the filters match. */
export function RegisterBreakdowns({ summary }: { summary: PaymentRegisterSummary }) {
  const { t, language } = useLocalizationContext();
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <BreakdownTable
        title={t("payments.reports.breakdown.method", { defaultValue: "By payment method" })}
        icon={CreditCard}
        groups={summary.byMethod}
        label={(group) => methodText(group.key, t)}
      />
      <BreakdownTable
        title={t("payments.reports.breakdown.receiver", {
          defaultValue: "By who received the money",
        })}
        icon={Wallet}
        groups={summary.byReceiver}
        label={(group) =>
          group.key === "owner"
            ? t("payments.reports.receiver.owner", { defaultValue: "Received by the owner" })
            : t("payments.reports.receiver.office", { defaultValue: "Received by the office" })
        }
      />
      <BreakdownTable
        title={t("payments.reports.breakdown.month", { defaultValue: "By month" })}
        icon={CalendarRange}
        groups={summary.byMonth}
        label={(group) => monthName(group.key, language)}
      />
      <BreakdownTable
        title={t("payments.reports.breakdown.building", { defaultValue: "By building" })}
        icon={Building2}
        groups={summary.byBuilding}
        label={(group) => group.label}
      />
      <BreakdownTable
        title={t("payments.reports.breakdown.tenant", { defaultValue: "By tenant" })}
        icon={Users}
        groups={summary.byTenant}
        label={(group) => group.label}
      />
      <BreakdownTable
        title={t("payments.reports.breakdown.type", { defaultValue: "By payment type" })}
        icon={Layers}
        groups={summary.byType}
        label={(group) => paymentTypeLabel(group.key, t)}
      />
    </div>
  );
}

/** The payment report's table: a line per payment received, and per refund. */
export function registerColumns(
  t: Translate,
  formatCurrency: (amount: number) => string,
  formatDate: (date: string) => string,
): DataTableColumn<CollectionRow>[] {
  const muted = <span className="text-xs text-muted-foreground">—</span>;
  return [
    {
      id: "number",
      header: t("payments.table.number", { defaultValue: "Payment No." }),
      cell: (row) =>
        row.paymentNumber ? (
          <Link
            href={`/dashboard/payments/${row.paymentId}`}
            className="whitespace-nowrap font-mono text-xs font-medium text-primary hover:underline"
            dir="ltr"
          >
            {row.paymentNumber}
          </Link>
        ) : (
          muted
        ),
      width: "min-w-[100px]",
    },
    {
      id: "date",
      header: t("payments.reports.columns.date", { defaultValue: "Date" }),
      cell: (row) => (
        <div className="text-sm">
          <span className="block">{formatDate(row.paidDate)}</span>
          {row.lineType === "refund" && (
            <Badge
              variant="outline"
              className="mt-1 border-orange-200 bg-orange-50 text-xs font-normal text-orange-700 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
            >
              {t("payments.reports.refundLine", { defaultValue: "Refund" })}
            </Badge>
          )}
        </div>
      ),
      width: "min-w-[100px]",
    },
    {
      id: "tenant",
      header: t("payments.reports.columns.tenant", { defaultValue: "Tenant" }),
      cell: (row) => <span className="text-sm">{row.tenantName || "—"}</span>,
      width: "min-w-[140px]",
    },
    {
      id: "mobile",
      header: t("payments.reports.columns.mobile", { defaultValue: "Mobile" }),
      cell: (row) =>
        row.tenantPhone ? (
          <span className="whitespace-nowrap text-sm" dir="ltr">
            <bdi>{row.tenantPhone}</bdi>
          </span>
        ) : (
          muted
        ),
    },
    {
      id: "building",
      header: t("payments.reports.columns.building", { defaultValue: "Building" }),
      cell: (row) => <span className="text-sm">{row.propertyName || "—"}</span>,
      visibility: "md",
      width: "min-w-[110px]",
    },
    {
      id: "unit",
      header: t("payments.reports.columns.unit", { defaultValue: "Unit" }),
      cell: (row) =>
        row.unitNumber ? <bdi className="text-sm">{row.unitNumber}</bdi> : muted,
      visibility: "md",
      width: "min-w-[80px]",
    },
    {
      // The contract, and the installment the money paid with its due date —
      // a late payment shows here, since the arrears registers list only
      // what is still owed.
      id: "contract",
      header: t("payments.reports.columns.contractInstallment", {
        defaultValue: "Contract / installment",
      }),
      cell: (row) =>
        row.contractNumber || row.invoiceNumber ? (
          <div className="max-w-[140px] space-y-0.5 whitespace-normal">
            {row.contractNumber && (
              <span className="block font-mono text-xs">{row.contractNumber}</span>
            )}
            {row.invoiceNumber && (
              <span className="block font-mono text-xs text-muted-foreground">
                {row.invoiceNumber}
              </span>
            )}
            {row.installmentDueDate && (
              <span className="block text-xs text-muted-foreground">
                {t("payments.reports.dueOn", {
                  defaultValue: "Due {date}",
                  values: { date: formatDate(row.installmentDueDate) },
                })}
              </span>
            )}
          </div>
        ) : (
          muted
        ),
      visibility: "lg",
      width: "min-w-[120px]",
    },
    {
      // How it was paid and so who ended up holding the money, the reference
      // that proves it, and who recorded it.
      id: "method",
      header: t("payments.reports.columns.methodDetails", {
        defaultValue: "Method / reference",
      }),
      cell: (row) => (
        <div className="space-y-0.5">
          <Badge variant="outline" className="text-xs font-normal">
            {methodText(row.method, t)}
          </Badge>
          <span className="block text-xs text-muted-foreground">
            {row.receiver === "owner"
              ? t("payments.reports.receiver.owner", { defaultValue: "Received by the owner" })
              : t("payments.reports.receiver.office", {
                  defaultValue: "Received by the office",
                })}
          </span>
          {row.reference && (
            <span
              className="block max-w-[160px] truncate font-mono text-xs text-muted-foreground"
              title={row.reference}
            >
              <bdi dir="ltr">{row.reference}</bdi>
            </span>
          )}
          {(row.recordedBy || row.online) && (
            <span className="block text-xs text-muted-foreground">
              {t("payments.table.recordedByName", {
                defaultValue: "By {name}",
                values: {
                  name:
                    row.recordedBy ??
                    t("payments.table.recordedOnline", { defaultValue: "Online" }),
                },
              })}
            </span>
          )}
        </div>
      ),
      width: "min-w-[130px]",
    },
    {
      id: "amount",
      header: t("payments.reports.columns.amount", { defaultValue: "Amount" }),
      cell: (row) => (
        <span
          className={cn(
            "whitespace-nowrap text-sm font-semibold",
            row.amount < 0 && "text-orange-600",
          )}
        >
          {formatCurrency(row.amount)}
        </span>
      ),
      align: "right",
      width: "min-w-[100px]",
    },
  ];
}

/** The total under the table, so the page always says what it adds up to. */
export function RegisterTotalLine({ summary }: { summary: PaymentRegisterSummary }) {
  const { t, formatCurrency } = useLocalizationContext();
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t pt-3 text-sm">
      <span className="text-muted-foreground">
        {t("payments.reports.stats.received", { defaultValue: "Received" })}:{" "}
        <span className="font-medium text-foreground">
          {formatCurrency(summary.totalReceived)}
        </span>
      </span>
      {summary.totalRefunded > 0 && (
        <span className="text-muted-foreground">
          {t("payments.reports.stats.refunded", { defaultValue: "Refunded" })}:{" "}
          <span className="font-medium text-orange-600">
            {formatCurrency(-summary.totalRefunded)}
          </span>
        </span>
      )}
      <span className="text-muted-foreground">
        {t("payments.reports.stats.netCollected", { defaultValue: "Net collected" })}:{" "}
        <span className="font-semibold text-foreground">
          {formatCurrency(summary.totalCollected)}
        </span>
      </span>
    </div>
  );
}

