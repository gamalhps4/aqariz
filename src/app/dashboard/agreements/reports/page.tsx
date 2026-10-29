"use client";

/**
 * PropertyPro - Agreement report (§3.4.2)
 *
 * Per agreement, for a chosen period: the rent, the management commission and
 * the settlement the client's statement carries — VAT on the fee, expenses,
 * who received the money and who owes whom — and below it every payment
 * behind the figures, one row each with its date and note. No row carries an
 * agreement's percentage: that belongs on the agreement's own statement.
 * Rent that no agreement governs is stated separately, so the report's total
 * is never mistaken for the whole portfolio.
 *
 * Narrowed by period, owner, compound, building, one agreement and status; the
 * filters are applied explicitly, live in the address, and Reset returns them —
 * the period included — to the year so far (see useReportFilters).
 */

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Building2,
  FileText,
  Handshake,
  Info,
  Loader2,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ReportExportButton } from "@/components/reports/export-button";
import {
  ReportFilterBar,
  type ReportFilterField,
} from "@/components/reports/report-filter-bar";
import {
  filterParams,
  useReportFilters,
  type FilterValues,
} from "@/components/reports/use-report-filters";
import { useReportFilterOptions } from "@/components/reports/use-report-filter-options";
import {
  StatementPaymentsTable,
  StatementSummary,
} from "@/components/statements/StatementSections";
import { yearToDate } from "@/lib/report-filters/period";
import type {
  AgreementReport,
  AgreementReportPayment,
  AgreementReportRow,
} from "@/types/agreement";

/**
 * Every filter this page has and the value it opens on: the year so far, and
 * nothing narrowed. Reset returns to exactly these.
 */
const FILTERS = {
  defaults: (): FilterValues => ({
    ...yearToDate(),
    ownerId: "",
    compoundId: "",
    propertyId: "",
    agreementId: "",
    status: "",
    includeInactive: "",
  }),
};

const FILTER_KEYS = [
  "startDate",
  "endDate",
  "ownerId",
  "compoundId",
  "propertyId",
  "agreementId",
  "status",
] as const;

const OPTION_LISTS = ["owners", "compounds", "buildings", "agreements"] as const;

const AGREEMENT_STATUSES = ["active", "expired", "terminated", "draft"] as const;

export default function AgreementReportPage() {
  // useSearchParams needs a boundary of its own under the dashboard layout.
  return (
    <Suspense fallback={null}>
      <AgreementReportView />
    </Suspense>
  );
}

function AgreementReportView() {
  const { t, formatCurrency } = useLocalizationContext();

  const { draft, applied, setField, apply, reset, pending, canReset } =
    useReportFilters(FILTERS);
  const {
    options,
    loading: optionsLoading,
    failed: optionsFailed,
  } = useReportFilterOptions(OPTION_LISTS);

  /**
   * What the report was last RUN with. The figures, the export and the address
   * follow this; the controls only edit a draft until Apply, so changing three
   * filters asks for the combination wanted — not once per control.
   */
  const params = useMemo(() => {
    const next = filterParams(applied, FILTER_KEYS);
    if (applied.includeInactive === "true") next.set("includeInactive", "true");
    return next;
  }, [applied]);
  const query = params.toString();

  const [result, setResult] = useState<{
    key: string;
    report: AgreementReport | null;
    error: string | null;
  } | null>(null);
  const loading = result?.key !== query;
  const report = result?.report ?? null;
  const error = result?.key === query ? result.error : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: { report: AgreementReport | null; error: string | null };
      try {
        const response = await fetch(`/api/agreements/reports?${query}`);
        const payload = await response.json();
        next = payload?.success
          ? { report: payload.data as AgreementReport, error: null }
          : {
              report: null,
              error:
                payload?.error ??
                t("agreements.report.loadError", {
                  defaultValue: "Could not generate the report",
                }),
            };
      } catch (loadError) {
        console.error("Failed to load agreement report:", loadError);
        next = {
          report: null,
          error: t("agreements.report.loadError", {
            defaultValue: "Could not generate the report",
          }),
        };
      }
      if (!cancelled) setResult({ key: query, ...next });
    })();
    return () => {
      cancelled = true;
    };
    // `t` changes with the language; the report does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fields: ReportFilterField[] = [
    { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
    { kind: "entity", entity: "owner" },
    { kind: "entity", entity: "compound" },
    { kind: "entity", entity: "building" },
    { kind: "entity", entity: "agreement" },
    {
      kind: "status",
      key: "status",
      options: AGREEMENT_STATUSES.map((status) => ({
        value: status,
        label: t(`agreements.status.${status}`, { defaultValue: status }),
      })),
    },
    {
      kind: "toggle",
      key: "includeInactive",
      label: t("agreements.report.includeInactive", {
        defaultValue: "Include ended agreements",
      }),
    },
  ];

  const summary = report?.summary;

  const columns: DataTableColumn<AgreementReportRow>[] = [
    {
      id: "agreement",
      header: t("agreements.table.agreement", { defaultValue: "Agreement" }),
      cell: (row) => (
        <Link
          href={`/dashboard/agreements/${row.agreementId}`}
          className="group inline-flex flex-col text-foreground"
        >
          <span className="text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {row.agreementNumber ??
              t("agreements.table.unnumbered", { defaultValue: "(no number)" })}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.ownerName} ·{" "}
            {row.kind === "investment"
              ? t("agreements.kind.investment", {
                  defaultValue: "Investment agreement",
                })
              : t("agreements.kind.management", {
                  defaultValue: "Management agreement",
                })}
          </span>
        </Link>
      ),
      width: "min-w-[180px]",
    },
    {
      id: "covers",
      header: t("agreements.table.covers", { defaultValue: "Covers" }),
      cell: (row) => (
        <div className="text-sm">
          <span className="block">
            {row.scopeType === "portfolio"
              ? t("agreements.scope.portfolio", { defaultValue: "Whole portfolio" })
              : row.scopeLabel}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("agreements.report.propertyCount", {
              defaultValue: "{count} properties",
              values: { count: row.propertyCount },
            })}
          </span>
        </div>
      ),
      visibility: "md",
      width: "min-w-[170px]",
    },
    {
      id: "collected",
      header: t("clients.statement.settlement.collected", {
        defaultValue: "Total collected",
      }),
      cell: (row) => (
        <div className="text-sm">
          <span className="block">{formatCurrency(row.rentCollected)}</span>
          {/* An investment agreement's figure is rent owed to the owner,
              not a fee the office earns. */}
          {row.kind === "investment" && (
            <span className="block text-xs text-muted-foreground">
              {t("agreements.investment.rent", {
                defaultValue: "Rent paid to the owner",
              })}
              {": "}
              {formatCurrency(row.investmentRent)}
            </span>
          )}
        </div>
      ),
      align: "right",
      width: "min-w-[130px]",
    },
    {
      id: "commission",
      header: t("agreements.report.commission", {
        defaultValue: "Commission",
      }),
      cell: (row) => (
        <div className="text-sm">
          <span className="block font-semibold text-info">
            {formatCurrency(row.commission)}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("agreements.report.vatOf", {
              defaultValue: "+ {amount} VAT",
              values: { amount: formatCurrency(row.commissionTax) },
            })}
          </span>
        </div>
      ),
      align: "right",
      width: "min-w-[140px]",
    },
    {
      id: "expenses",
      header: t("clients.statement.settlement.expenses", {
        defaultValue: "Expenses",
      }),
      cell: (row) => (
        <span className="text-sm">{formatCurrency(row.expenses)}</span>
      ),
      align: "right",
      visibility: "lg",
      width: "min-w-[110px]",
    },
    {
      // Who the money reached: the owner directly, or the office.
      id: "split",
      header: t("clients.statement.payments.receivedBy", {
        defaultValue: "Received by",
      }),
      cell: (row) => (
        <div className="text-xs">
          <span className="block">
            {t("clients.statement.payments.receivedByOwner", {
              defaultValue: "Owner",
            })}
            {": "}
            <span className="tabular-nums">
              {formatCurrency(row.collectedByOwner)}
            </span>
          </span>
          <span className="block text-muted-foreground">
            {t("clients.statement.payments.receivedByOffice", {
              defaultValue: "Office",
            })}
            {": "}
            <span className="tabular-nums">
              {formatCurrency(row.collectedByOperator)}
            </span>
          </span>
        </div>
      ),
      visibility: "md",
      width: "min-w-[150px]",
    },
    {
      // The closing balance of the agreement's statement: exactly one side
      // carries a figure, as on the owner's statement.
      id: "settlement",
      header: t("agreements.report.settlement", {
        defaultValue: "Settlement",
      }),
      cell: (row) =>
        row.dueToOperator > 0 ? (
          <div className="text-sm">
            <span className="block font-semibold">
              {formatCurrency(row.dueToOperator)}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t("clients.statement.settlement.dueToOperator", {
                defaultValue: "Due to the office",
              })}
            </span>
          </div>
        ) : (
          <div className="text-sm">
            <span className="block font-semibold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(row.dueToOwner)}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t("clients.statement.settlement.dueToOwner", {
                defaultValue: "Due to the owner",
              })}
            </span>
          </div>
        ),
      align: "right",
      width: "min-w-[140px]",
    },
    {
      id: "statement",
      header: "",
      cell: (row) => (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/dashboard/agreements/${row.agreementId}/statement`}>
            <FileText className="h-3.5 w-3.5" />
            {t("agreements.report.openStatement", {
              defaultValue: "Statement",
            })}
          </Link>
        </Button>
      ),
      align: "right",
      width: "w-32",
    },
  ];

  // Each payment names the agreement it counted under, and opens that
  // agreement's statement.
  const agreementColumn: DataTableColumn<AgreementReportPayment> = {
    id: "agreement",
    header: t("clients.statement.details.agreement", {
      defaultValue: "Agreement",
    }),
    cell: (row) => (
      <Link
        href={`/dashboard/agreements/${row.agreementId}/statement`}
        className="whitespace-nowrap text-sm hover:underline"
      >
        {row.agreementNumber ??
          t("agreements.table.unnumbered", { defaultValue: "(no number)" })}
      </Link>
    ),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("agreements.report.title", {
              defaultValue: "Agreement report",
            })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("agreements.report.subtitle", {
              defaultValue:
                "Total rent, management commission and the net amount, per agreement",
            })}
          </p>
        </div>
        <ReportExportButton
          endpoint="/api/agreements/reports"
          params={params}
          disabled={loading || !report?.rows.length}
        />
      </div>

      <Card className="gap-2">
        <CardHeader>
          <ReportFilterBar
            values={draft}
            onChange={setField}
            onApply={apply}
            onReset={reset}
            pending={pending}
            canReset={canReset}
            fields={fields}
            options={options}
            optionsLoading={optionsLoading}
            optionsFailed={optionsFailed}
          />
        </CardHeader>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("agreements.stats.total", { defaultValue: "Agreements" })}
          value={String(summary?.agreementCount ?? 0)}
          icon={Handshake}
          iconColor="primary"
          description={t("agreements.report.ownerCount", {
            defaultValue: "{count} owners",
            values: { count: summary?.ownerCount ?? 0 },
          })}
        />
        <AnalyticsCard
          title={t("clients.statement.settlement.collected", {
            defaultValue: "Total collected",
          })}
          value={formatCurrency(summary?.totalCollected ?? 0)}
          icon={TrendingUp}
          iconColor="success"
          description={t("agreements.report.propertyCount", {
            defaultValue: "{count} properties",
            values: { count: summary?.propertyCount ?? 0 },
          })}
        />
        <AnalyticsCard
          title={t("agreements.report.totalRent", {
            defaultValue: "Total rent",
          })}
          value={formatCurrency(summary?.totalRent ?? 0)}
          icon={Building2}
          iconColor="info"
          description={t("agreements.report.totalRentHint", {
            defaultValue: "Rent before VAT — what the commission is charged on",
          })}
        />
        <AnalyticsCard
          title={t("agreements.report.dues", { defaultValue: "Dues" })}
          value={formatCurrency(summary?.totalDueToOwner ?? 0)}
          icon={Wallet}
          iconColor="warning"
          description={t("agreements.report.duesHint", {
            defaultValue: "due to owners · {amount} due to the office",
            values: {
              amount: formatCurrency(summary?.totalDueToOperator ?? 0),
            },
          })}
        />
      </AnalyticsCardGrid>

      {/* The totals, in the statement's own rows — "received by the office"
          included, which the report used to leave out. */}
      {summary && (
        <StatementSummary
          figures={{
            collected: summary.totalCollected,
            commission: summary.totalCommission,
            commissionTax: summary.totalCommissionTax,
            expenses: summary.totalExpenses,
            investmentRent: summary.totalInvestmentRent,
            collectedByOwner: summary.totalCollectedByOwner,
            collectedByOperator: summary.totalCollectedByOperator,
            dueToOwner: summary.totalDueToOwner,
            dueToOperator: summary.totalDueToOperator,
          }}
          // Agreements charge different rates; each one's is on its statement.
          commissionPercentage={null}
        />
      )}

      {/* Without this the rent total silently understates the portfolio. */}
      {(summary?.unmanagedProperties ?? 0) > 0 && (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t("agreements.report.unmanaged", {
            defaultValue:
              "{count} propert(y/ies) earning {amount} fall under no agreement and are excluded above.",
            values: {
              count: summary?.unmanagedProperties ?? 0,
              amount: formatCurrency(summary?.unmanagedRent ?? 0),
            },
          })}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            {t("agreements.report.byAgreement", {
              defaultValue: "By agreement",
            })}
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
              data={report?.rows ?? []}
              loading={false}
              getRowKey={(row) => row.agreementId}
              emptyState={{
                icon: <Handshake className="h-10 w-10 text-muted-foreground" />,
                title: t("agreements.report.empty.title", {
                  defaultValue: "No agreements in this period",
                }),
                description: t("agreements.report.empty.description", {
                  defaultValue:
                    "Nothing was in force for the dates selected",
                }),
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Every payment behind the figures, with its date and note. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            {t("clients.statement.payments.title", { defaultValue: "Payments" })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StatementPaymentsTable<AgreementReportPayment>
            payments={report?.payments ?? []}
            loading={loading}
            leadingColumns={[agreementColumn]}
            receiptLinks
          />
        </CardContent>
      </Card>
    </div>
  );
}
