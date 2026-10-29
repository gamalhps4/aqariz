"use client";

/**
 * PropertyPro - Owners
 *
 * The list is whoever actually owns property, so a landlord who manages their
 * own buildings appears here from day one without creating anything. A
 * "profile" is optional enrichment — bank details and tax numbers a
 * management office needs for a third-party owner.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ReportExportButton } from "@/components/reports/export-button";
import { useRouter } from "next/navigation";
import {
  Building2,
  DoorOpen,
  FileSpreadsheet,
  IdCard,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import GlobalSearch from "@/components/ui/global-search";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  AddOwnerDialog,
  type CreatedOwner,
} from "@/components/owners/AddOwnerDialog";
import { useAuthorization } from "@/hooks/useAuthorization";
import { hasAnyPermission } from "@/lib/permissions-manager";
import { toast } from "sonner";
import type { OwnerSummary } from "@/types/owner";

export default function OwnersPage() {
  const router = useRouter();
  const { t, formatCurrency } = useLocalizationContext();
  const { permissions } = useAuthorization();
  // The rights POST /api/owners asks for — the button is not offered to
  // someone it would only refuse.
  const canAddOwner = hasAnyPermission(permissions, [
    "owner_create",
    "owner_management",
  ]);

  const [owners, setOwners] = useState<OwnerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const response = await fetch(`/api/owners?${params}`);
      const payload = await response.json();
      if (payload?.success) {
        setOwners(payload.data ?? []);
        setError(null);
      } else {
        setError(payload?.error ?? t("errors.ui.loadFailed", { defaultValue: "Could not load this. Try again." }));
      }
    } catch (loadError) {
      console.error("Failed to load owners:", loadError);
      setError("Could not load owners");
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Straight to the new owner's page — unless the reader is narrowed to some
  // buildings, none of which the new owner holds yet, when that page would
  // answer "not found". They are told why instead.
  const openCreated = (userId: string, created: CreatedOwner) => {
    if (created.inReach) {
      router.push(`/dashboard/clients/owners/${userId}`);
      return;
    }
    toast.success(
      t("clients.owners.add.createdOutOfReach", {
        defaultValue:
          "{name} was added. They appear in your list once they own a building you manage.",
        values: { name: created.name },
      }),
    );
    void load();
  };

  const totals = owners.reduce(
    (acc, owner) => ({
      properties: acc.properties + owner.propertyCount,
      units: acc.units + owner.unitCount,
      rent: acc.rent + owner.monthlyRent,
      outstanding: acc.outstanding + owner.outstandingBalance,
    }),
    { properties: 0, units: 0, rent: 0, outstanding: 0 },
  );

  const columns: DataTableColumn<OwnerSummary>[] = [
    {
      id: "name",
      header: t("clients.owners.table.owner", { defaultValue: "Owner" }),
      cell: (row) => (
        <Link
          href={`/dashboard/clients/owners/${row.userId}`}
          className="group inline-flex flex-col text-foreground"
        >
          <span className="flex items-center gap-2 text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {row.companyName ?? row.name}
            {/* The self-managing landlord: their own row in their own list. */}
            {row.isSelf && (
              <Badge variant="outline" className="text-[10px] font-normal">
                {t("clients.owners.you", { defaultValue: "You" })}
              </Badge>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.companyName ? row.name : row.email}
          </span>
        </Link>
      ),
      width: "min-w-[200px]",
    },
    {
      id: "profile",
      header: t("clients.owners.table.profile", { defaultValue: "Profile" }),
      cell: (row) =>
        row.ownerProfileId ? (
          <Badge
            variant="outline"
            className="border-success/20 bg-success/10 text-xs font-normal text-success"
          >
            <IdCard className="me-1 h-3 w-3" />
            {t("clients.owners.hasProfile", { defaultValue: "On file" })}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("clients.owners.noProfile", { defaultValue: "Not needed" })}
          </span>
        ),
      visibility: "lg",
      width: "min-w-[120px]",
    },
    {
      id: "portfolio",
      header: t("clients.owners.table.portfolio", {
        defaultValue: "Portfolio",
      }),
      cell: (row) => (
        <div className="text-sm">
          <span className="block">
            {t("clients.owners.propertyCount", {
              defaultValue: "{count} properties",
              values: { count: row.propertyCount },
            })}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("clients.owners.unitCount", {
              defaultValue: "{units} units · {rate}% occupied",
              values: { units: row.unitCount, rate: row.occupancyRate },
            })}
          </span>
        </div>
      ),
      width: "min-w-[170px]",
    },
    {
      id: "rent",
      header: t("clients.owners.table.rent", { defaultValue: "Rent" }),
      cell: (row) => (
        <span className="text-sm font-medium">
          {formatCurrency(row.monthlyRent)}
        </span>
      ),
      align: "right",
      visibility: "md",
      width: "min-w-[130px]",
    },
    {
      id: "outstanding",
      header: t("clients.owners.table.outstanding", {
        defaultValue: "Outstanding",
      }),
      cell: (row) => (
        <span
          className={`text-sm ${row.outstandingBalance > 0 ? "font-semibold text-warning" : ""}`}
        >
          {formatCurrency(row.outstandingBalance)}
        </span>
      ),
      align: "right",
      width: "min-w-[130px]",
    },
    {
      id: "statement",
      header: "",
      cell: (row) => (
        <Button variant="ghost" size="sm" asChild className="h-8">
          <Link href={`/dashboard/clients/owners/${row.userId}`}>
            <FileSpreadsheet className="h-4 w-4" />
            <span className="sr-only">
              {t("clients.owners.statement", { defaultValue: "Statement" })}
            </span>
          </Link>
        </Button>
      ),
      width: "w-12",
      align: "center",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("nav.clients.owners", { defaultValue: "Owners" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("clients.owners.subtitle", {
              defaultValue:
                "Everyone who owns property here, with their portfolio and statement of account",
            })}
          </p>
        </div>
        {/* The file carries the list as searched. Payout details are left out
            of it deliberately — see the export branch in /api/owners. */}
        <ReportExportButton
          endpoint="/api/owners"
          params={(() => {
            const params = new URLSearchParams();
            if (search) params.set("search", search);
            return params;
          })()}
          disabled={loading}
        />
      </div>

      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("clients.owners.stats.owners", { defaultValue: "Owners" })}
          value={String(owners.length)}
          icon={Users}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("clients.owners.stats.properties", {
            defaultValue: "Properties",
          })}
          value={String(totals.properties)}
          icon={Building2}
          iconColor="info"
          description={t("clients.owners.stats.units", {
            defaultValue: "{count} units",
            values: { count: totals.units },
          })}
        />
        <AnalyticsCard
          title={t("clients.owners.stats.rent", { defaultValue: "Rent roll" })}
          value={formatCurrency(totals.rent)}
          icon={TrendingUp}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("clients.owners.stats.outstanding", {
            defaultValue: "Outstanding",
          })}
          value={formatCurrency(totals.outstanding)}
          icon={Wallet}
          iconColor="warning"
        />
      </AnalyticsCardGrid>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="gap-2">
        <CardHeader>
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-2 dark:border-blue-800 dark:bg-blue-900/30">
              <UserRound className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t("nav.clients.owners", { defaultValue: "Owners" })}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("clients.owners.listHint", {
                  defaultValue:
                    "Owners of record appear automatically; add one here before their properties are entered",
                })}
              </p>
            </div>

            {/* Straight to the new owner's page, which is where payout and
                tax details are filled in. */}
            {canAddOwner && <AddOwnerDialog onCreated={openCreated} />}
          </div>

          <div className="flex flex-col gap-4 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <GlobalSearch
                placeholder={t("clients.owners.searchPlaceholder", {
                  defaultValue: "Search owners...",
                })}
                initialValue={search}
                debounceDelay={300}
                onSearch={setSearch}
                isLoading={loading}
                className="min-w-0 flex-1"
                inputClassName="h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                ariaLabel={t("clients.owners.searchPlaceholder", {
                  defaultValue: "Search owners...",
                })}
              />
              {search && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearch("")}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="me-1 h-4 w-4" />
                  {t("common.clear", { defaultValue: "Clear" })}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <DataTable
            columns={columns}
            data={owners}
            loading={loading}
            getRowKey={(row) => row.userId}
            emptyState={{
              icon: <DoorOpen className="h-12 w-12 text-muted-foreground" />,
              title: t("clients.owners.empty.title", {
                defaultValue: "No owners yet",
              }),
              description: t("clients.owners.empty.description", {
                defaultValue:
                  "Add an owner, or add a property and whoever owns it appears here automatically",
              }),
              action: (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {canAddOwner && <AddOwnerDialog onCreated={openCreated} />}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push("/dashboard/properties/new")}
                  >
                    {t("clients.owners.empty.action", {
                      defaultValue: "Add a property",
                    })}
                  </Button>
                </div>
              ),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
