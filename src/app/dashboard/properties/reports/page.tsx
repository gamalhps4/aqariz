"use client";

/**
 * PropertyPro - Occupancy report
 *
 * "Occupancy Report must clearly show vacant and occupied/leased units",
 * filtered by owner, building and date, and exportable. Which is why the
 * table leads with the unit's state rather than burying it behind a
 * percentage: the office's next action is about a particular empty unit, not
 * about the rate.
 *
 * Filters are applied explicitly, as on the other report pages — picking an
 * owner, then a building, then a date should ask one question rather than
 * three — and what was applied lives in the address, with the report chosen
 * (see useReportFilters): a reload keeps them, and so does a shared link.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Building2, DoorOpen, Percent, TriangleAlert } from "lucide-react";

import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportExportButton } from "@/components/reports/export-button";
import {
  replaceQuery,
  useReportFilters,
  type FilterValues,
} from "@/components/reports/use-report-filters";
import { StatementDocumentLayout } from "@/components/statements/StatementSections";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useSession } from "@/lib/auth-client";
import { UserRole } from "@/types";
import type { LineTranslate } from "@/lib/statements/line-text";
import {
  breakdownLabel,
  breakdownStatus,
  breakdownTitle,
  entityStatementDetails,
  entityStatementTitle,
} from "@/lib/statements/entity-details";
import {
  maintenanceCategoryText,
  maintenancePriorityText,
  maintenanceStatusText,
} from "@/lib/maintenance-labels";
import type {
  EntityStatement,
  EntityStatementBreakdownRow,
  StatementSubjectKind,
} from "@/types/entity-statement";

const ANY = "__any__";

type PropertyReportType =
  | "occupancy"
  | "maintenance"
  | "compound-statement"
  | "property-statement"
  | "unit-statement";

const REPORTS: Array<{ type: PropertyReportType; labelKey: string; fallback: string }> = [
  { type: "occupancy", labelKey: "occupancy.title", fallback: "Occupancy" },
  { type: "maintenance", labelKey: "maintenanceReport.title", fallback: "Maintenance" },
  {
    type: "compound-statement",
    labelKey: "statements.compound.title",
    fallback: "Compound statement",
  },
  {
    type: "property-statement",
    labelKey: "statements.property.title",
    fallback: "Property statement",
  },
  {
    type: "unit-statement",
    labelKey: "statements.unit.title",
    fallback: "Unit statement",
  },
];

/** Which picker a statement needs, and which list fills it. */
const STATEMENT_SUBJECTS: Record<
  string,
  { field: "compounds" | "properties" | "units"; labelKey: string; fallback: string }
> = {
  "compound-statement": {
    field: "compounds",
    labelKey: "payments.filters.compound",
    fallback: "Compound",
  },
  "property-statement": {
    field: "properties",
    labelKey: "payments.filters.property",
    fallback: "Building",
  },
  "unit-statement": {
    field: "units",
    labelKey: "payments.filters.unit",
    fallback: "Unit",
  },
};

function isStatement(type: PropertyReportType): boolean {
  return type.endsWith("-statement");
}

/** "unit-statement" → "unit". */
function subjectKindOf(type: PropertyReportType): StatementSubjectKind {
  return type === "compound-statement"
    ? "compound"
    : type === "property-statement"
      ? "property"
      : "unit";
}

interface MaintenanceRow {
  requestId: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  propertyName: string;
  compoundName: string | null;
  unitNumber: string | null;
  tenantName: string;
  assigneeName: string | null;
  raisedOn: string;
  ageDays: number;
  open: boolean;
  actualCost: number | null;
  estimatedCost: number | null;
}

interface MaintenanceSummary {
  totalRequests: number;
  openRequests: number;
  completedRequests: number;
  emergencyOpen: number;
  averageResolutionDays: number | null;
  oldestOpenDays: number | null;
  estimatedTotal: number;
  actualTotal: number;
  costVariance: number;
}

interface OccupancyRow {
  unitId: string;
  unitNumber: string;
  unitType: string;
  propertyName: string;
  compoundName: string | null;
  district: string | null;
  city: string;
  ownerName: string;
  occupancy: "leased" | "vacant" | "maintenance";
  storedStatus: string;
  statusMismatch: boolean;
  tenantName: string | null;
  contractEnd: string | null;
  rentAmount: number;
}

interface OccupancySummary {
  totalUnits: number;
  leasedUnits: number;
  vacantUnits: number;
  maintenanceUnits: number;
  occupancyRate: number;
  contractedRent: number;
  vacantAskingRent: number;
  mismatchCount: number;
}

interface Option {
  id: string;
  label: string;
}

/** Which units the occupancy report lists. */
type OccupancyFilter = "all" | "leased" | "vacant" | "maintenance";
const OCCUPANCY_FILTERS: OccupancyFilter[] = [
  "all",
  "leased",
  "vacant",
  "maintenance",
];

/**
 * Every filter the page has and the value it opens on — Reset returns to
 * exactly these. Each report reads the ones that mean something for it (see
 * `query`): occupancy is read at a day, maintenance and the statements over a
 * period, and a statement about one subject. An empty value is no filter; an
 * empty period is the report's own (twelve months, or the year so far).
 */
const FILTERS = {
  defaults: (): FilterValues => ({
    ownerId: "",
    compoundId: "",
    propertyId: "",
    occupancy: "all",
    asOf: "",
    subjectId: "",
    startDate: "",
    endDate: "",
  }),
};

/**
 * The menu links to each report by `?type=` — and to the vacant and leased
 * lists by `&occupancy=`. The report is read from the address on every
 * render and the filters follow it (useReportFilters), so moving from one
 * link to another changes what is on screen without a reload.
 */
export default function OccupancyReportPage() {
  // useSearchParams needs a boundary of its own under the dashboard layout.
  return (
    <Suspense fallback={null}>
      <PropertyReports />
    </Suspense>
  );
}

function PropertyReports() {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const search = useSearchParams();
  const { data: session } = useSession();
  // The receipt page is the office's; an owner reads the number only.
  const isOwner = session?.user?.role === UserRole.OWNER;
  // The screen's `t`, in the shape the shared wording helpers take — the
  // same helpers the exports word their cells with.
  const lineText: LineTranslate = useCallback(
    (key, english, values) => t(key, { defaultValue: english, values }),
    [t],
  );

  // The menu links straight to a report, so the page opens on the one that
  // was asked for rather than on its default and a second click.
  const typeParam = search.get("type");
  const reportType: PropertyReportType = REPORTS.some(
    (entry) => entry.type === typeParam,
  )
    ? (typeParam as PropertyReportType)
    : "occupancy";

  // What the controls show is `draft`; only Apply moves `applied`, which the
  // report, the export and the address follow. "Vacant units" and "Leased
  // units" in the menu open the occupancy report already narrowed to them —
  // `&occupancy=` is one of the filters.
  const { draft, applied, setField, apply, reset, pending, canReset } =
    useReportFilters(FILTERS);
  const occupancy: OccupancyFilter = OCCUPANCY_FILTERS.includes(
    draft.occupancy as OccupancyFilter,
  )
    ? (draft.occupancy as OccupancyFilter)
    : "all";

  const [properties, setProperties] = useState<Option[]>([]);
  const [owners, setOwners] = useState<Option[]>([]);
  const [compounds, setCompounds] = useState<Option[]>([]);
  const [subjects, setSubjects] = useState<{
    compounds: Option[];
    properties: Option[];
    units: Option[];
  }>({ compounds: [], properties: [], units: [] });
  const [statement, setStatement] = useState<EntityStatement | null>(null);

  const [rows, setRows] = useState<OccupancyRow[]>([]);
  const [summary, setSummary] = useState<OccupancySummary | null>(null);
  const [maintenanceRows, setMaintenanceRows] = useState<MaintenanceRow[]>([]);
  const [maintenanceSummary, setMaintenanceSummary] =
    useState<MaintenanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ type: reportType });

    // A statement asks a different question — one subject, one window — so it
    // carries its own parameters rather than reusing the register's filters.
    if (isStatement(reportType)) {
      if (applied.subjectId) params.set("subjectId", applied.subjectId);
      if (applied.startDate) params.set("startDate", applied.startDate);
      if (applied.endDate) params.set("endDate", applied.endDate);
      return params;
    }

    if (applied.propertyId) params.set("propertyId", applied.propertyId);
    if (applied.ownerId) params.set("ownerId", applied.ownerId);
    if (applied.compoundId) params.set("compoundId", applied.compoundId);
    // Occupancy is read at a moment; maintenance over a period, from the
    // day raised to the day asked.
    if (reportType === "occupancy") {
      if (applied.asOf) params.set("asOf", applied.asOf);
      // An address naming something else lists every unit, as "all" does.
      if (
        applied.occupancy !== "all" &&
        OCCUPANCY_FILTERS.includes(applied.occupancy as OccupancyFilter)
      ) {
        params.set("occupancy", applied.occupancy);
      }
    } else {
      if (applied.startDate) params.set("startDate", applied.startDate);
      if (applied.endDate) params.set("endDate", applied.endDate);
    }
    return params;
  }, [applied, reportType]);

  /** A statement cannot run until its subject is chosen. */
  const awaitingSubject = isStatement(reportType) && !applied.subjectId;

  // The pickers offer only what the caller can reach — the endpoint is
  // scoped, so a narrowed employee cannot filter by someone else's building.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/payments/filter-options");
      const result = await response.json().catch(() => null);
      if (cancelled || !response.ok || !result?.success) return;
      setProperties(result.data.properties ?? []);
      setOwners(result.data.owners ?? []);
      setCompounds(result.data.compounds ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Statement subjects come from their own endpoint: the payments panel
  // derives units from contracts, so a unit never let would be missing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/properties/statement-subjects");
      const result = await response.json().catch(() => null);
      if (cancelled || !response.ok || !result?.success) return;
      setSubjects({
        compounds: result.data.compounds ?? [],
        properties: result.data.properties ?? [],
        units: result.data.units ?? [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    const response = await fetch(`/api/properties/reports?${query}`);
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) {
      return { error: result?.error ?? t("errors.ui.loadFailed", { defaultValue: "Could not load this. Try again." }) } as const;
    }
    return { data: result.data } as const;
  }, [query, t]);

  useEffect(() => {
    let cancelled = false;

    // Nothing to ask for yet — an unchosen subject is a prompt, not an error.
    if (awaitingSubject) {
      setStatement(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    void (async () => {
      const outcome = await load();
      if (cancelled) return;
      if ("error" in outcome) {
        setError(outcome.error);
      } else if (isStatement(reportType)) {
        setStatement(outcome.data as EntityStatement);
        setError(null);
      } else if (reportType === "maintenance") {
        setMaintenanceRows(outcome.data.rows ?? []);
        setMaintenanceSummary(outcome.data.summary ?? null);
        setError(null);
      } else {
        setRows(outcome.data.rows ?? []);
        setSummary(outcome.data.summary ?? null);
        setError(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load, reportType, awaitingSubject]);

  const columns: DataTableColumn<OccupancyRow>[] = useMemo(
    () => [
      {
        id: "unit",
        header: t("occupancy.table.unit", { defaultValue: "Unit" }),
        cell: (row) => (
          <div>
            <div className="font-medium">{row.unitNumber}</div>
            <div className="text-xs text-muted-foreground">
              {row.propertyName}
              {row.compoundName ? ` · ${row.compoundName}` : ""}
            </div>
          </div>
        ),
      },
      {
        id: "location",
        header: t("occupancy.table.location", { defaultValue: "Location" }),
        visibility: "lg" as const,
        cell: (row) =>
          [row.district, row.city].filter(Boolean).join(" · ") || "—",
      },
      {
        id: "occupancy",
        header: t("occupancy.table.state", { defaultValue: "State" }),
        cell: (row) => (
          <div className="flex items-center gap-2">
            <Badge
              variant={row.occupancy === "leased" ? "default" : "secondary"}
            >
              {t(`occupancy.state.${row.occupancy}`, {
                defaultValue: row.occupancy,
              })}
            </Badge>
            {/* The report derives occupancy from contracts; when the unit's
                own status disagrees, somebody has to go and correct it, and
                they can only do that if the row says so. */}
            {row.statusMismatch && (
              <span
                className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                title={t("occupancy.table.mismatchHint", {
                  defaultValue:
                    "The unit record still says “{status}”. Contracts say otherwise.",
                  values: { status: row.storedStatus },
                })}
              >
                <TriangleAlert className="h-3 w-3" />
                {row.storedStatus}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "tenant",
        header: t("occupancy.table.tenant", { defaultValue: "Tenant" }),
        cell: (row) => row.tenantName ?? "—",
      },
      {
        id: "until",
        header: t("occupancy.table.until", { defaultValue: "Contract ends" }),
        visibility: "md" as const,
        cell: (row) => (row.contractEnd ? formatDate(row.contractEnd) : "—"),
      },
      {
        id: "rent",
        header: t("occupancy.table.rent", { defaultValue: "Rent" }),
        cell: (row) => (
          <div>
            <div className="font-medium">{formatCurrency(row.rentAmount)}</div>
            {row.occupancy !== "leased" && (
              <div className="text-xs text-muted-foreground">
                {t("occupancy.table.asking", { defaultValue: "asking" })}
              </div>
            )}
          </div>
        ),
      },
    ],
    [t, formatCurrency, formatDate],
  );

  const maintenanceColumns: DataTableColumn<MaintenanceRow>[] = useMemo(
    () => [
      {
        id: "request",
        header: t("maintenanceReport.table.request", { defaultValue: "Request" }),
        cell: (row) => (
          <div>
            <div className="font-medium">{row.title}</div>
            <div className="text-xs text-muted-foreground">
              {maintenanceCategoryText(row.category, lineText)}
            </div>
          </div>
        ),
      },
      {
        id: "unit",
        header: t("maintenanceReport.table.unit", { defaultValue: "Unit" }),
        cell: (row) => (
          <div>
            <div>{row.unitNumber ?? "—"}</div>
            <div className="text-xs text-muted-foreground">
              {row.propertyName}
              {row.compoundName ? ` · ${row.compoundName}` : ""}
            </div>
          </div>
        ),
      },
      {
        id: "priority",
        header: t("maintenanceReport.table.priority", { defaultValue: "Priority" }),
        cell: (row) => (
          <Badge variant={row.priority === "emergency" ? "destructive" : "secondary"}>
            {maintenancePriorityText(row.priority, lineText)}
          </Badge>
        ),
      },
      {
        id: "status",
        header: t("maintenanceReport.table.status", { defaultValue: "Status" }),
        cell: (row) => (
          <Badge variant={row.open ? "outline" : "default"}>
            {maintenanceStatusText(row.status, lineText)}
          </Badge>
        ),
      },
      {
        id: "age",
        header: t("maintenanceReport.table.age", { defaultValue: "Age" }),
        cell: (row) => (
          <div>
            <div>
              {t("maintenanceReport.table.days", {
                defaultValue: "{days} days",
                values: { days: row.ageDays },
              })}
            </div>
            {/* For an open request this is how long it has been waiting,
                which is not the same thing as how long it took. */}
            <div className="text-xs text-muted-foreground">
              {row.open
                ? t("maintenanceReport.table.waiting", { defaultValue: "waiting" })
                : t("maintenanceReport.table.toResolve", { defaultValue: "to resolve" })}
            </div>
          </div>
        ),
      },
      {
        id: "assignee",
        header: t("maintenanceReport.table.assignee", { defaultValue: "Assigned to" }),
        visibility: "lg" as const,
        cell: (row) => row.assigneeName ?? "—",
      },
      {
        id: "cost",
        header: t("maintenanceReport.table.cost", { defaultValue: "Cost" }),
        cell: (row) =>
          row.actualCost !== null ? (
            formatCurrency(row.actualCost)
          ) : row.estimatedCost !== null ? (
            <span className="text-muted-foreground">
              {t("maintenanceReport.table.estimated", {
                defaultValue: "{amount} est.",
                values: { amount: formatCurrency(row.estimatedCost) },
              })}
            </span>
          ) : (
            "—"
          ),
      },
    ],
    [t, formatCurrency, lineText],
  );

  const breakdownColumns: DataTableColumn<EntityStatementBreakdownRow>[] = useMemo(
    () => [
      {
        id: "subject",
        header:
          statement?.breakdownKind === "property"
            ? t("statements.columns.building", { defaultValue: "Building" })
            : t("statements.columns.unit", { defaultValue: "Unit" }),
        cell: (row) => (
          <div>
            <div className="font-medium">{breakdownLabel(row, lineText)}</div>
            {row.status && (
              <div className="text-xs text-muted-foreground">
                {breakdownStatus(row, lineText)}
              </div>
            )}
          </div>
        ),
      },
      {
        id: "billed",
        header: t("statements.columns.billed", { defaultValue: "Billed" }),
        visibility: "md" as const,
        cell: (row) => formatCurrency(row.rentBilled),
      },
      {
        id: "collected",
        header: t("statements.columns.collected", { defaultValue: "Collected" }),
        cell: (row) => formatCurrency(row.rentCollected),
      },
      {
        id: "expenses",
        header: t("statements.columns.expenses", { defaultValue: "Expenses" }),
        visibility: "lg" as const,
        cell: (row) => formatCurrency(row.expenses),
      },
      {
        id: "commission",
        header: t("statements.columns.commission", {
          defaultValue: "Commission",
        }),
        visibility: "lg" as const,
        cell: (row) => formatCurrency(row.commission),
      },
      {
        id: "commissionTax",
        header: t("clients.statement.settlement.commissionTax", {
          defaultValue: "VAT on commission",
        }),
        visibility: "lg" as const,
        cell: (row) => formatCurrency(row.commissionTax),
      },
      ...(statement?.breakdown.some((row) => row.investmentRent > 0)
        ? [
            {
              id: "investmentRent",
              header: t("clients.statement.settlement.investmentRent", {
                defaultValue: "Investment rent owed to the owner",
              }),
              visibility: "lg" as const,
              cell: (row: EntityStatementBreakdownRow) =>
                formatCurrency(row.investmentRent),
            },
          ]
        : []),
      {
        id: "share",
        header: t("statements.columns.ownerShare", {
          defaultValue: "Owner's share",
        }),
        cell: (row) => (
          <span className="font-medium">{formatCurrency(row.ownerShare)}</span>
        ),
      },
    ],
    [t, formatCurrency, lineText, statement],
  );

  // What the statement is for, whose it is, where and for which dates —
  // the details its download prints, in the same words.
  const statementDetails = statement
    ? entityStatementDetails(statement, lineText, {
        period: t("agreements.statement.term", {
          defaultValue: "{start} to {end}",
          values: {
            start: formatDate(statement.period.startDate),
            end: formatDate(statement.period.endDate),
          },
        }),
        money: (amount) => formatCurrency(amount),
      }).map(([label, value]) => ({ label, value }))
    : [];

  const activeReport =
    REPORTS.find((entry) => entry.type === reportType) ?? REPORTS[0];
  const subjectConfig = STATEMENT_SUBJECTS[reportType];

  /** A picker over one filter of the draft; "Any" is the empty value. */
  const picker = (
    label: string,
    key: "ownerId" | "compoundId" | "propertyId" | "subjectId",
    options: Option[],
  ) => (
    <div className="min-w-[190px] space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={draft[key] || ANY}
        onValueChange={(next) => setField({ [key]: next === ANY ? "" : next })}
      >
        <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>
            {t("common.all", { defaultValue: "Any" })}
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {isStatement(reportType)
              ? t(activeReport.labelKey, { defaultValue: activeReport.fallback })
              : reportType === "maintenance"
                ? t("maintenanceReport.title", { defaultValue: "Maintenance" })
                : t("occupancy.title", { defaultValue: "Occupancy" })}
          </h1>
          <p className="text-muted-foreground">
            {isStatement(reportType)
              ? // "Reports should clearly identify the selected
                // owner/property/compound/unit and the reporting period" —
                // so the subject line is the subtitle, not a caption
                // somewhere further down.
                statement
                ? [
                    statement.subject.parentName,
                    statement.subject.name,
                    statement.subject.ownerName,
                    `${formatDate(statement.period.startDate)} — ${formatDate(
                      statement.period.endDate,
                    )}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : t("statements.chooseSubject", {
                    defaultValue:
                      "Choose what the statement is for, then apply.",
                  })
              : reportType === "maintenance"
                ? t("maintenanceReport.subtitle", {
                    defaultValue:
                      "What was raised, what is still open, and what it cost",
                  })
                : t("occupancy.subtitle", {
                    defaultValue:
                      "Which units are let and which are standing empty",
                  })}
          </p>
        </div>
        <ReportExportButton
          endpoint="/api/properties/reports"
          params={query}
          disabled={loading || awaitingSubject}
        />
      </div>

      {isStatement(reportType) ? (
        statement && (
          <AnalyticsCardGrid className="lg:grid-cols-4">
            <AnalyticsCard
              title={t("statements.stats.collected", {
                defaultValue: "Collected",
              })}
              value={formatCurrency(statement.totals.rentCollected)}
              description={t("statements.stats.ofBilled", {
                defaultValue: "of {billed} billed",
                values: {
                  billed: formatCurrency(statement.totals.rentBilled),
                },
              })}
              icon={Percent}
              iconColor="success"
            />
            <AnalyticsCard
              title={t("statements.stats.outstanding", {
                defaultValue: "Outstanding",
              })}
              value={formatCurrency(statement.totals.outstanding)}
              description={t("statements.stats.outstandingHint", {
                defaultValue: "Still owed at the end of the period",
              })}
              icon={TriangleAlert}
              iconColor={
                statement.totals.outstanding > 0 ? "warning" : "info"
              }
            />
            <AnalyticsCard
              title={t("statements.stats.expenses", {
                defaultValue: "Expenses",
              })}
              value={formatCurrency(statement.totals.expenses)}
              description={t("statements.stats.plusCommission", {
                defaultValue: "plus {commission} commission",
                values: {
                  commission: formatCurrency(statement.totals.commission),
                },
              })}
              icon={Building2}
              iconColor="info"
            />
            {/* Who owes whom — exactly one of the two carries a figure. */}
            <AnalyticsCard
              title={
                statement.settlement.dueToOperator > 0
                  ? t("clients.statement.settlement.dueToOperator", {
                      defaultValue: "Due to the office",
                    })
                  : t("clients.statement.settlement.dueToOwner", {
                      defaultValue: "Due to the owner",
                    })
              }
              value={formatCurrency(
                statement.settlement.dueToOperator > 0
                  ? statement.settlement.dueToOperator
                  : statement.settlement.dueToOwner,
              )}
              description={t("statements.stats.units", {
                defaultValue: "{occupied} of {total} units occupied",
                values: {
                  occupied: statement.occupiedUnits,
                  total: statement.unitCount,
                },
              })}
              icon={DoorOpen}
              iconColor={
                statement.settlement.dueToOperator > 0 ? "warning" : "success"
              }
            />
          </AnalyticsCardGrid>
        )
      ) : reportType === "maintenance" ? (
        <AnalyticsCardGrid className="lg:grid-cols-4">
          <AnalyticsCard
            title={t("maintenanceReport.stats.open", { defaultValue: "Open" })}
            value={String(maintenanceSummary?.openRequests ?? 0)}
            description={t("maintenanceReport.stats.ofTotal", {
              defaultValue: "of {total} raised",
              values: { total: maintenanceSummary?.totalRequests ?? 0 },
            })}
            icon={TriangleAlert}
            iconColor="warning"
          />
          <AnalyticsCard
            title={t("maintenanceReport.stats.emergencies", {
              defaultValue: "Emergencies open",
            })}
            value={String(maintenanceSummary?.emergencyOpen ?? 0)}
            description={t("maintenanceReport.stats.oldest", {
              defaultValue: "oldest open {days} days",
              values: { days: maintenanceSummary?.oldestOpenDays ?? 0 },
            })}
            icon={TriangleAlert}
            iconColor="error"
          />
          <AnalyticsCard
            title={t("maintenanceReport.stats.resolve", {
              defaultValue: "Average to resolve",
            })}
            value={
              maintenanceSummary?.averageResolutionDays === null ||
              maintenanceSummary === null
                ? "—"
                : t("maintenanceReport.table.days", {
                    defaultValue: "{days} days",
                    values: { days: maintenanceSummary.averageResolutionDays },
                  })
            }
            // Said out loud, because an average over open work would be a
            // flattering number rather than a true one.
            description={t("maintenanceReport.stats.resolveHint", {
              defaultValue: "completed work only",
            })}
            icon={Percent}
            iconColor="primary"
          />
          <AnalyticsCard
            title={t("maintenanceReport.stats.spend", { defaultValue: "Spend" })}
            value={formatCurrency(maintenanceSummary?.actualTotal ?? 0)}
            description={t("maintenanceReport.stats.variance", {
              defaultValue: "{amount} against estimate",
              values: {
                amount: formatCurrency(maintenanceSummary?.costVariance ?? 0),
              },
            })}
            icon={Building2}
            iconColor="info"
          />
        </AnalyticsCardGrid>
      ) : (
      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("occupancy.stats.rate", { defaultValue: "Occupancy" })}
          value={`${summary?.occupancyRate ?? 0}%`}
          description={t("occupancy.stats.rateHint", {
            defaultValue: "{leased} of {lettable} lettable units",
            values: {
              leased: summary?.leasedUnits ?? 0,
              lettable:
                (summary?.leasedUnits ?? 0) + (summary?.vacantUnits ?? 0),
            },
          })}
          icon={Percent}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("occupancy.stats.leased", { defaultValue: "Leased" })}
          value={String(summary?.leasedUnits ?? 0)}
          description={formatCurrency(summary?.contractedRent ?? 0)}
          icon={Building2}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("occupancy.stats.vacant", { defaultValue: "Vacant" })}
          value={String(summary?.vacantUnits ?? 0)}
          description={t("occupancy.stats.vacantHint", {
            defaultValue: "{amount} asking",
            values: { amount: formatCurrency(summary?.vacantAskingRent ?? 0) },
          })}
          icon={DoorOpen}
          iconColor="warning"
        />
        <AnalyticsCard
          title={t("occupancy.stats.maintenance", {
            defaultValue: "Out of service",
          })}
          value={String(summary?.maintenanceUnits ?? 0)}
          description={t("occupancy.stats.maintenanceHint", {
            defaultValue: "Excluded from the rate",
          })}
          icon={TriangleAlert}
          iconColor="info"
        />
      </AnalyticsCardGrid>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
            <div className="min-w-[200px] space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t("payments.reports.reportLabel", { defaultValue: "Report" })}
              </Label>
              <Select
                value={reportType}
                onValueChange={(value) => {
                  // The filters stay; the subject does not — a compound's id
                  // names nothing in a unit statement.
                  setField({ subjectId: "" });
                  replaceQuery({
                    type: value === "occupancy" ? null : value,
                    subjectId: null,
                  });
                }}
              >
                <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORTS.map((entry) => (
                    <SelectItem key={entry.type} value={entry.type}>
                      {t(entry.labelKey, { defaultValue: entry.fallback })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isStatement(reportType) && subjectConfig ? (
              <>
                {picker(
                  t(subjectConfig.labelKey, {
                    defaultValue: subjectConfig.fallback,
                  }),
                  "subjectId",
                  subjects[subjectConfig.field],
                )}
                <div className="min-w-[170px] space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {t("reports.filters.from", { defaultValue: "From" })}
                  </Label>
                  <Input
                    type="date"
                    className="h-10 bg-white dark:bg-gray-800"
                    value={draft.startDate}
                    max={draft.endDate || undefined}
                    onChange={(event) =>
                      setField({ startDate: event.target.value })
                    }
                  />
                </div>
                <div className="min-w-[170px] space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    {t("reports.filters.to", { defaultValue: "To" })}
                  </Label>
                  <Input
                    type="date"
                    className="h-10 bg-white dark:bg-gray-800"
                    value={draft.endDate}
                    min={draft.startDate || undefined}
                    onChange={(event) => setField({ endDate: event.target.value })}
                  />
                </div>
              </>
            ) : (
              <>
                {picker(
                  t("payments.filters.owner", { defaultValue: "Owner" }),
                  "ownerId",
                  owners,
                )}
                {picker(
                  t("payments.filters.compound", { defaultValue: "Compound" }),
                  "compoundId",
                  compounds,
                )}
                {picker(
                  t("payments.filters.property", { defaultValue: "Building" }),
                  "propertyId",
                  properties,
                )}
                {reportType === "occupancy" && (
                  <div className="min-w-[170px] space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t("occupancy.filters.units", { defaultValue: "Units" })}
                    </Label>
                    <Select
                      value={occupancy}
                      onValueChange={(value) => setField({ occupancy: value })}
                    >
                      <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          {t("occupancy.filters.allUnits", {
                            defaultValue: "All units",
                          })}
                        </SelectItem>
                        <SelectItem value="leased">
                          {t("occupancy.filters.leasedUnits", {
                            defaultValue: "Leased units",
                          })}
                        </SelectItem>
                        <SelectItem value="vacant">
                          {t("occupancy.filters.vacantUnits", {
                            defaultValue: "Vacant units",
                          })}
                        </SelectItem>
                        <SelectItem value="maintenance">
                          {t("occupancy.filters.outOfService", {
                            defaultValue: "Out of service",
                          })}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {reportType === "maintenance" ? (
                  // Raised between two days — the register is read over a
                  // period, as its export says.
                  <>
                    <div className="min-w-[170px] space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("maintenanceReport.filters.from", {
                          defaultValue: "Raised since",
                        })}
                      </Label>
                      <Input
                        type="date"
                        className="h-10 bg-white dark:bg-gray-800"
                        value={draft.startDate}
                        max={draft.endDate || undefined}
                        onChange={(event) =>
                          setField({ startDate: event.target.value })
                        }
                      />
                    </div>
                    <div className="min-w-[170px] space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("maintenanceReport.filters.to", {
                          defaultValue: "Raised until",
                        })}
                      </Label>
                      <Input
                        type="date"
                        className="h-10 bg-white dark:bg-gray-800"
                        value={draft.endDate}
                        min={draft.startDate || undefined}
                        onChange={(event) =>
                          setField({ endDate: event.target.value })
                        }
                      />
                    </div>
                  </>
                ) : (
                  <div className="min-w-[170px] space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t("occupancy.filters.asOf", { defaultValue: "As at" })}
                    </Label>
                    <Input
                      type="date"
                      className="h-10 bg-white dark:bg-gray-800"
                      value={draft.asOf}
                      onChange={(event) => setField({ asOf: event.target.value })}
                    />
                  </div>
                )}
              </>
            )}

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-10"
                disabled={!pending}
                onClick={apply}
              >
                {t("reports.applyFilters", { defaultValue: "Apply filters" })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-10"
                disabled={!canReset}
                onClick={reset}
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
        {/* A statement is a document of its own, below the filters. */}
        {!isStatement(reportType) && (
          <CardContent>
            {error ? (
              <p className="py-8 text-center text-sm text-destructive">{error}</p>
            ) : (
              <>
                {reportType === "occupancy" &&
                  (summary?.mismatchCount ?? 0) > 0 && (
                  <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {t("occupancy.mismatchBanner", {
                      defaultValue:
                        "{count} unit records disagree with their contracts. This report follows the contracts.",
                      values: { count: summary?.mismatchCount ?? 0 },
                    })}
                  </p>
                )}
                {reportType === "maintenance" ? (
                  <DataTable<MaintenanceRow>
                    columns={maintenanceColumns}
                    data={maintenanceRows}
                    loading={loading}
                    getRowKey={(row) => row.requestId}
                  />
                ) : (
                  <DataTable<OccupancyRow>
                    columns={columns}
                    data={rows}
                    loading={loading}
                    getRowKey={(row) => row.unitId}
                  />
                )}
              </>
            )}
          </CardContent>
        )}
      </Card>

      {isStatement(reportType) &&
        (error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : awaitingSubject ? (
          <Card>
            <CardContent>
              <p className="py-12 text-center text-sm text-muted-foreground">
                {t("statements.chooseSubject", {
                  defaultValue: "Choose what the statement is for, then apply.",
                })}
              </p>
            </CardContent>
          </Card>
        ) : (
          // Laid out as the owner's statement: letterhead, title, details,
          // summary — then a compound's buildings or a building's units, every
          // payment and every expense. The export above downloads exactly
          // this.
          <StatementDocumentLayout
            letterhead={statement?.letterhead}
            title={entityStatementTitle(
              statement?.subject.kind ?? subjectKindOf(reportType),
              lineText,
            )}
            details={statementDetails}
            figures={
              statement
                ? {
                    collected: statement.settlement.collected,
                    commission: statement.settlement.commission,
                    commissionTax: statement.settlement.commissionTax,
                    expenses: statement.settlement.expenses,
                    investmentRent: statement.settlement.investmentRent,
                    collectedByOwner: statement.settlement.collectedByOwner,
                    collectedByOperator: statement.settlement.collectedByOperator,
                    dueToOwner: statement.settlement.dueToOwner,
                    dueToOperator: statement.settlement.dueToOperator,
                  }
                : null
            }
            commissionPercentage={statement?.commissionPercentage ?? null}
            payments={statement?.payments ?? []}
            expenses={statement?.expenses ?? []}
            loading={loading}
            receiptLinks={!isOwner}
          >
            {statement && statement.breakdownKind !== "none" && (
              <section className="space-y-3">
                <h3 className="text-base font-semibold">
                  {breakdownTitle(statement, lineText)}
                </h3>
                <DataTable<EntityStatementBreakdownRow>
                  columns={breakdownColumns}
                  data={statement.breakdown}
                  loading={loading}
                  getRowKey={(row) => row.id}
                />
              </section>
            )}
          </StatementDocumentLayout>
        ))}
    </div>
  );
}
