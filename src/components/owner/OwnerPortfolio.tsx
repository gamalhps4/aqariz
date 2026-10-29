"use client";

/**
 * PropertyPro - Owner portal
 *
 * What a property owner sees when they sign in: their own buildings, what those
 * buildings earned over a period, who received the money, and who owes whom
 * once the office has taken its expenses, its commission and the VAT on it.
 *
 * Deliberately one screen. An owner is a client, not an operator — they want
 * the number at the bottom and the means to check how it was reached: their
 * statement of account, laid out as the office's copy is — the office's
 * letterhead, the title, whose statement and for which period, the summary,
 * every payment with its date and note, and every expense — and its
 * download. Every figure comes from the endpoints the office's own owner
 * statement uses (`/api/owners/[id]` and `/api/owners/[id]/statement`), so the
 * two can never disagree; what differs is that those endpoints narrow to the
 * caller's own record when the caller is an owner (lib/db/scopes.ts).
 *
 * There is no "net to you" figure any more: it ignored the VAT on the
 * commission and who was holding the money, so it could not say what the
 * owner is actually owed. The dues do.
 */

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Building2,
  Loader2,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  StatementDocument,
  useOwnerStatementDetails,
} from "@/components/statements/StatementSections";
import {
  ReportFilterBar,
  type ReportFilterField,
} from "@/components/reports/report-filter-bar";
import {
  filterParams,
  useReportFilters,
  type FilterValues,
} from "@/components/reports/use-report-filters";
import { usePropertyCategories } from "@/hooks/use-property-categories";
import type { FilterOptions } from "@/lib/report-filters/options";
import { yearToDate } from "@/lib/report-filters/period";
import type { OwnerDetail, OwnerProperty, OwnerStatement } from "@/types/owner";

type PropertyLine = OwnerStatement["byProperty"][number];

/**
 * What the owner's statement can be narrowed by: its period, which opens on
 * the year so far, and one of their buildings. Reset returns to exactly this.
 */
const STATEMENT_FILTERS = {
  defaults: (): FilterValues => ({ ...yearToDate(), propertyId: "" }),
};

const STATEMENT_FIELDS: ReportFilterField[] = [
  { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
  { kind: "entity", entity: "building" },
];

const STATEMENT_KEYS = ["startDate", "endDate", "propertyId"] as const;

export function OwnerPortfolio() {
  // The statement's filters live in the address, and useSearchParams needs a
  // boundary of its own — this renders on the dashboard's home page too.
  return (
    <Suspense fallback={null}>
      <OwnerPortfolioView />
    </Suspense>
  );
}

function OwnerPortfolioView() {
  const { data: session } = useSession();
  const { t, formatCurrency } = useLocalizationContext();
  const { labelFor: categoryLabelFor } = usePropertyCategories("property");

  const ownerId = session?.user?.id ?? null;

  const [owner, setOwner] = useState<OwnerDetail | null>(null);
  const [statement, setStatement] = useState<OwnerStatement | null>(null);
  // What the statement was last run with is `applied`; the controls edit
  // `draft` until Apply.
  const { draft, applied, setField, apply, reset, pending, canReset } =
    useReportFilters(STATEMENT_FILTERS);
  const statementParams = useMemo(
    () => filterParams(applied, STATEMENT_KEYS),
    [applied],
  );
  const statementQuery = statementParams.toString();
  // The buildings to choose among are the owner's own — the list the page
  // shows below, which the API has already scoped to them.
  const buildingOptions = useMemo<FilterOptions | undefined>(
    () =>
      owner
        ? {
            buildings: owner.properties.map((property) => ({
              id: property.id,
              label: property.name,
              hint:
                [property.compoundName, property.city]
                  .filter(Boolean)
                  .join(" · ") || null,
              compoundId: null,
              ownerId: owner.userId,
            })),
          }
        : undefined,
    [owner],
  );
  const [loading, setLoading] = useState(true);
  // A flag rather than a message: keeping the translated string out of the
  // fetch lets `load` depend on nothing but the ids and dates, which is what
  // the React compiler needs to memoize it.
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (isStale: () => boolean = () => false) => {
      if (!ownerId) return;
      try {
        const [ownerResponse, statementResponse] = await Promise.all([
          fetch(`/api/owners/${ownerId}`),
          fetch(`/api/owners/${ownerId}/statement?${statementQuery}`),
        ]);

        if (!ownerResponse.ok) {
          throw new Error(String(ownerResponse.status));
        }
        const ownerPayload = await ownerResponse.json();
        const statementPayload = statementResponse.ok
          ? await statementResponse.json()
          : null;
        // Figures for filters that have since been replaced are not the ones
        // on screen: they must not land after the newer ones.
        if (isStale()) return;
        setOwner(ownerPayload?.data ?? null);
        setStatement(statementPayload?.data ?? null);
        setFailed(false);
      } catch {
        if (!isStale()) setFailed(true);
      } finally {
        if (!isStale()) setLoading(false);
      }
    },
    [ownerId, statementQuery],
  );

  useEffect(() => {
    let stale = false;
    void load(() => stale);
    return () => {
      stale = true;
    };
  }, [load]);

  const propertyColumns: DataTableColumn<OwnerProperty>[] = [
    {
      id: "name",
      header: t("clients.owners.properties.name", { defaultValue: "Property" }),
      cell: (row) => (
        <Link
          href={`/dashboard/properties/${row.id}`}
          className="group inline-flex flex-col text-foreground"
        >
          <span className="text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {row.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {[categoryLabelFor(row.type), row.city, row.compoundName]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </Link>
      ),
      width: "min-w-[230px]",
    },
    {
      id: "units",
      header: t("clients.owners.properties.units", { defaultValue: "Units" }),
      cell: (row) => <span className="text-sm">{row.totalUnits}</span>,
      align: "center",
      width: "min-w-[90px]",
    },
    {
      id: "status",
      header: t("clients.owners.properties.status", { defaultValue: "Status" }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal capitalize">
          {t(`properties.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
      align: "center",
      width: "min-w-[110px]",
    },
  ];

  const moneyColumns: DataTableColumn<PropertyLine>[] = [
    {
      id: "property",
      header: t("clients.owners.properties.name", { defaultValue: "Property" }),
      cell: (row) => <span className="text-sm">{row.propertyName}</span>,
      width: "min-w-[200px]",
    },
    {
      id: "collected",
      header: t("clients.owners.statement.collected", {
        defaultValue: "Rent collected",
      }),
      cell: (row) => (
        <span className="text-sm">{formatCurrency(row.rentCollected)}</span>
      ),
      align: "right",
    },
    {
      id: "byOwner",
      header: t("clients.owners.statement.byOwner", {
        defaultValue: "Received by you",
      }),
      cell: (row) => (
        <span className="text-sm">{formatCurrency(row.collectedByOwner)}</span>
      ),
      align: "right",
    },
    {
      id: "expenses",
      header: t("clients.owners.statement.expenses", {
        defaultValue: "Expenses",
      }),
      cell: (row) => (
        <span className="text-sm">{formatCurrency(row.expenses)}</span>
      ),
      align: "right",
    },
    {
      id: "commission",
      header: t("clients.owners.statement.commission", {
        defaultValue: "Commission",
      }),
      cell: (row) => (
        <span className="text-sm">{formatCurrency(row.commission)}</span>
      ),
      align: "right",
    },
    {
      id: "commissionTax",
      header: t("clients.statement.settlement.commissionTax", {
        defaultValue: "VAT on commission",
      }),
      cell: (row) => (
        <span className="text-sm">{formatCurrency(row.commissionTax)}</span>
      ),
      align: "right",
    },
    {
      // What the building leaves the owner, VAT included — whoever is holding
      // the money; the dues above say who pays whom.
      id: "share",
      header: t("clients.owners.statement.share", { defaultValue: "Your share" }),
      cell: (row) => (
        <span className="text-sm font-semibold">
          {formatCurrency(row.ownerShare)}
        </span>
      ),
      align: "right",
    },
  ];

  // Whose statement and for which period — the details its download prints.
  const statementDetails = useOwnerStatementDetails(statement);

  if (loading && !owner) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totals = statement?.totals;
  // An owner managing their own buildings pays no commission, so the card would
  // otherwise read a bare zero. Saying why is more useful than showing nothing.
  const noAgreement = statement?.commissionSource === "none";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("clients.owners.portal.title", { defaultValue: "My portfolio" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {owner?.companyName || owner?.name || ""}
          </p>
        </div>
      </div>

      <ReportFilterBar
        values={draft}
        onChange={setField}
        onApply={apply}
        onReset={reset}
        pending={pending}
        canReset={canReset}
        fields={STATEMENT_FIELDS}
        options={buildingOptions}
        optionsLoading={!owner}
      />

      {failed && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("clients.owners.portal.loadFailed", {
            defaultValue: "We could not load your portfolio. Please try again.",
          })}
        </div>
      )}

      <AnalyticsCardGrid>
        <AnalyticsCard
          title={t("clients.owners.portal.buildings", {
            defaultValue: "Buildings",
          })}
          value={owner?.propertyCount ?? 0}
          icon={Building2}
          description={t("clients.owners.portal.unitCount", {
            defaultValue: "{count} units",
            values: { count: owner?.unitCount ?? 0 },
          })}
        />
        <AnalyticsCard
          title={t("clients.owners.portal.occupancy", {
            defaultValue: "Occupancy",
          })}
          value={`${owner?.occupancyRate ?? 0}%`}
          icon={TrendingUp}
          description={t("clients.owners.portal.occupiedUnits", {
            defaultValue: "{count} occupied",
            values: { count: owner?.occupiedUnits ?? 0 },
          })}
        />
        <AnalyticsCard
          title={t("clients.owners.statement.collected", {
            defaultValue: "Rent collected",
          })}
          value={formatCurrency(totals?.rentCollected ?? 0)}
          icon={Banknote}
          description={t("clients.owners.portal.outstanding", {
            defaultValue: "{amount} outstanding",
            values: { amount: formatCurrency(totals?.outstanding ?? 0) },
          })}
        />
        {/* Who owes whom — exactly one of the two carries a figure. */}
        <AnalyticsCard
          title={
            (totals?.dueToOperator ?? 0) > 0
              ? t("clients.statement.settlement.dueToOperator", {
                  defaultValue: "Due to the office",
                })
              : t("clients.statement.settlement.dueToOwner", {
                  defaultValue: "Due to the owner",
                })
          }
          value={formatCurrency(
            (totals?.dueToOperator ?? 0) > 0
              ? (totals?.dueToOperator ?? 0)
              : (totals?.dueToOwner ?? 0),
          )}
          icon={Wallet}
          iconColor={(totals?.dueToOperator ?? 0) > 0 ? "warning" : "success"}
          description={t("clients.owners.portal.split", {
            defaultValue: "You received {owner} · the office {office}",
            values: {
              owner: formatCurrency(totals?.collectedByOwner ?? 0),
              office: formatCurrency(totals?.collectedByOperator ?? 0),
            },
          })}
        />
      </AnalyticsCardGrid>

      {/* An owner managing their own buildings pays no commission, so the
          summary would otherwise read a bare zero. */}
      {noAgreement && (
        <Badge variant="outline" className="font-normal">
          <Receipt className="me-1 h-3.5 w-3.5" />
          {t("clients.owners.portal.selfManaged", {
            defaultValue: "You manage these buildings yourself",
          })}
        </Badge>
      )}

      {/* The statement itself, as the office's copy lays it out — and the
          download beside its payments. */}
      <StatementDocument
        statement={statement}
        letterhead={statement?.letterhead}
        title={t("clients.statement.document.ownerTitle", {
          defaultValue: "Owner statement of account",
        })}
        details={statementDetails}
        loading={loading && !statement}
        exportEndpoint={ownerId ? `/api/owners/${ownerId}/statement` : undefined}
        exportParams={statementParams}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("clients.owners.portal.buildings", {
              defaultValue: "Buildings",
            })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={propertyColumns}
            data={owner?.properties ?? []}
            loading={!owner && !failed}
            getRowKey={(row) => row.id}
            emptyState={{
              icon: <Building2 className="h-10 w-10 text-muted-foreground" />,
              title: t("clients.owners.portal.noBuildings", {
                defaultValue: "No buildings are registered to you yet",
              }),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("clients.owners.portal.byProperty", {
              defaultValue: "By building",
            })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={moneyColumns}
            data={statement?.byProperty ?? []}
            loading={loading && !statement}
            getRowKey={(row) => row.propertyId}
            emptyState={{
              icon: <Receipt className="h-10 w-10 text-muted-foreground" />,
              title: t("clients.owners.portal.noActivity", {
                defaultValue: "No activity in this period",
              }),
            }}
          />
        </CardContent>
      </Card>

    </div>
  );
}
