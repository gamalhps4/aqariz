"use client";

/**
 * PropertyPro - Compounds (residential complexes)
 *
 * Lists the compounds an organization manages with a portfolio rollup per row.
 * The properties inside a compound stay fully independent — this screen groups
 * and reports on them, it does not take over managing them.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ReportExportButton } from "@/components/reports/export-button";
import { useRouter } from "next/navigation";
import {
  Building,
  Building2,
  DoorOpen,
  Edit,
  Eye,
  Home,
  MapPin,
  MoreHorizontal,
  Plus,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import type { SortDirection } from "@/lib/table-sort";
import GlobalSearch from "@/components/ui/global-search";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import type { CompoundListItem } from "@/types/compound";

export default function CompoundsPage() {
  const router = useRouter();
  const { t, formatCurrency } = useLocalizationContext();

  const [compounds, setCompounds] = useState<CompoundListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(12);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearch] = useState("");
  // A header's order — by name or by city, all the API sorts by — applied
  // to every page; no key: newest first.
  const [sort, setSort] = useState<{ key: string | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });
  const [pendingDelete, setPendingDelete] = useState<CompoundListItem | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const fetchCompounds = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (search) params.set("search", search);
      if (sort.key) {
        params.set("sortBy", sort.key);
        params.set("sortOrder", sort.direction);
      }

      const response = await fetch(`/api/compounds?${params}`);
      const payload = await response.json();

      if (payload?.success) {
        setCompounds(payload.data ?? []);
        setTotalPages(payload.pagination?.totalPages ?? 1);
        setTotalItems(payload.pagination?.total ?? 0);
      }
    } catch (error) {
      console.error("Failed to fetch compounds:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, sort]);

  useEffect(() => {
    fetchCompounds();
  }, [fetchCompounds]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/compounds/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setPendingDelete(null);
        fetchCompounds();
      }
    } catch (error) {
      console.error("Failed to delete compound:", error);
    } finally {
      setDeleting(false);
    }
  };

  const totals = compounds.reduce(
    (acc, compound) => ({
      properties: acc.properties + (compound.stats?.propertyCount ?? 0),
      units: acc.units + (compound.stats?.unitCount ?? 0),
      occupied: acc.occupied + (compound.stats?.occupiedUnits ?? 0),
      rent: acc.rent + (compound.stats?.monthlyRent ?? 0),
    }),
    { properties: 0, units: 0, occupied: 0, rent: 0 },
  );

  const columns: DataTableColumn<CompoundListItem>[] = [
    {
      id: "name",
      sortKey: "name",
      header: t("compounds.table.name", { defaultValue: "Compound" }),
      cell: (row) => (
        <Link
          href={`/dashboard/compounds/${row.id}`}
          className="group inline-flex flex-col text-foreground"
        >
          <span className="text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {row.name}
          </span>
          {row.code && (
            <span className="font-mono text-xs text-muted-foreground">
              {row.code}
            </span>
          )}
        </Link>
      ),
      width: "min-w-[180px]",
    },
    {
      id: "location",
      sortKey: "city",
      header: t("compounds.table.location", { defaultValue: "Location" }),
      cell: (row) => (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {[row.address?.city, row.address?.state]
              .filter(Boolean)
              .join(", ") || "—"}
          </span>
        </div>
      ),
      visibility: "md",
      width: "min-w-[150px]",
    },
    {
      id: "properties",
      header: t("compounds.table.properties", { defaultValue: "Properties" }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal">
          {row.stats?.propertyCount ?? 0}
        </Badge>
      ),
      align: "center",
      width: "min-w-[100px]",
    },
    {
      id: "units",
      header: t("compounds.table.units", { defaultValue: "Units" }),
      cell: (row) => (
        <span className="text-sm">{row.stats?.unitCount ?? 0}</span>
      ),
      align: "center",
      visibility: "lg",
      width: "min-w-[90px]",
    },
    {
      id: "occupancy",
      header: t("compounds.table.occupancy", { defaultValue: "Occupancy" }),
      cell: (row) => (
        <span className="text-sm font-medium">
          {(row.stats?.occupancyRate ?? 0).toFixed(1)}%
        </span>
      ),
      align: "center",
      visibility: "lg",
      width: "min-w-[110px]",
    },
    {
      id: "rent",
      header: t("compounds.table.monthlyRent", {
        defaultValue: "Monthly Rent",
      }),
      cell: (row) => (
        <span className="text-sm font-semibold">
          {formatCurrency(row.stats?.monthlyRent ?? 0)}
        </span>
      ),
      align: "right",
      width: "min-w-[130px]",
    },
    {
      id: "owner",
      header: t("compounds.table.owner", { defaultValue: "Owner" }),
      cell: (row) =>
        row.owner ? (
          <span className="text-sm">
            {row.owner.firstName} {row.owner.lastName}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
      visibility: "lg",
      width: "min-w-[140px]",
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => router.push(`/dashboard/compounds/${row.id}`)}
            >
              <Eye className="h-4 w-4 me-2" />
              {t("common.view", { defaultValue: "View" })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push(`/dashboard/compounds/${row.id}/edit`)}
            >
              <Edit className="h-4 w-4 me-2" />
              {t("common.edit", { defaultValue: "Edit" })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setPendingDelete(row)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 me-2" />
              {t("common.delete", { defaultValue: "Delete" })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      width: "w-10",
      align: "center",
    },
  ];

  const portfolioOccupancy =
    totals.units > 0 ? (totals.occupied / totals.units) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("nav.compounds", { defaultValue: "Compounds" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("compounds.header.subtitle", {
              defaultValue:
                "Group related buildings and villas into a residential complex",
            })}
          </p>
        </div>
        <div className="flex gap-2">
          {/* The file carries the list as filtered, not the page of it on
              screen — see the export branch in /api/compounds. */}
          <ReportExportButton
            endpoint="/api/compounds"
            params={(() => {
              const params = new URLSearchParams();
              if (search) params.set("search", search);
              if (sort.key) {
                params.set("sortBy", sort.key);
                params.set("sortOrder", sort.direction);
              }
              return params;
            })()}
            disabled={loading}
          />
          <Button
            size="sm"
            onClick={() => router.push("/dashboard/compounds/new")}
          >
            <Plus className="h-4 w-4" />
            {t("compounds.actions.add", { defaultValue: "Add Compound" })}
          </Button>
        </div>
      </div>

      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("compounds.stats.compounds", { defaultValue: "Compounds" })}
          value={String(totalItems)}
          icon={Building}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("compounds.stats.properties", { defaultValue: "Properties" })}
          value={String(totals.properties)}
          icon={Building2}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("compounds.stats.units", { defaultValue: "Units" })}
          value={String(totals.units)}
          icon={DoorOpen}
          iconColor="warning"
          description={t("compounds.stats.occupancyValue", {
            defaultValue: "{rate}% occupied",
            values: { rate: portfolioOccupancy.toFixed(1) },
          })}
        />
        <AnalyticsCard
          title={t("compounds.stats.monthlyRent", {
            defaultValue: "Monthly Rent",
          })}
          value={formatCurrency(totals.rent)}
          icon={TrendingUp}
          iconColor="success"
        />
      </AnalyticsCardGrid>

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <Building className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("nav.compounds", { defaultValue: "Compounds" })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("compounds.header.subtitle", {
                    defaultValue:
                      "Group related buildings and villas into a residential complex",
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <GlobalSearch
                placeholder={t("compounds.filters.searchPlaceholder", {
                  defaultValue: "Search compounds...",
                })}
                initialValue={search}
                debounceDelay={300}
                onSearch={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
                isLoading={loading}
                className="flex-1 min-w-0"
                inputClassName="h-10 border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500 bg-white dark:bg-gray-800"
                ariaLabel={t("compounds.filters.searchAriaLabel", {
                  defaultValue: "Search compounds",
                })}
              />

              {search && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("common.clear", { defaultValue: "Clear" })}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <DataTable
            columns={columns}
            data={compounds}
            loading={loading}
            getRowKey={(row) => row.id}
            // Sorted by the API across every page. The counts and the owner
            // are worked out per compound and have no order there, so their
            // headers stay plain.
            sort={{
              key: sort.key,
              direction: sort.direction,
              onSortChange: (key, direction) => {
                setSort({ key, direction });
                setPage(1);
              },
            }}
            emptyState={{
              icon: <Home className="h-12 w-12 text-muted-foreground" />,
              title: t("compounds.empty.title", {
                defaultValue: "No compounds yet",
              }),
              description: search
                ? t("compounds.empty.filtered", {
                    defaultValue: "Try adjusting your search",
                  })
                : t("compounds.empty.default", {
                    defaultValue:
                      "Create a compound to group related properties together",
                  }),
              action: (
                <Button
                  onClick={() => router.push("/dashboard/compounds/new")}
                  size="sm"
                >
                  <Plus className="h-4 w-4 me-2" />
                  {t("compounds.actions.add", { defaultValue: "Add Compound" })}
                </Button>
              ),
            }}
          />
          {!loading && totalItems > 0 && (
            <GlobalPagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={limit}
              onPageChange={setPage}
              onPageSizeChange={(newLimit) => {
                setLimit(newLimit);
                setPage(1);
              }}
              showingLabel={t("common.showing", { defaultValue: "Showing" })}
              previousLabel={t("common.previous", { defaultValue: "Previous" })}
              nextLabel={t("common.next", { defaultValue: "Next" })}
              pageLabel={t("common.page", { defaultValue: "Page" })}
              ofLabel={t("common.of", { defaultValue: "of" })}
              itemsPerPageLabel={t("common.perPage", {
                defaultValue: "per page",
              })}
              disabled={loading}
            />
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("compounds.delete.title", { defaultValue: "Delete compound?" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("compounds.delete.description", {
                defaultValue:
                  '"{name}" will be removed. Its {count} propert(y/ies) are kept and simply detached — contracts, units and payments are untouched.',
                values: {
                  name: pendingDelete?.name ?? "",
                  count: pendingDelete?.stats?.propertyCount ?? 0,
                },
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {t("common.delete", { defaultValue: "Delete" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
