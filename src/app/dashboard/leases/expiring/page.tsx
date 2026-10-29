"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ReportExportButton } from "@/components/reports/export-button";
import { businessDaysUntil } from "@/lib/dates/business-day";
import { useState, useEffect, useCallback } from "react";
import { showSimpleError } from "@/lib/toast-notifications";
import { GlobalSearch } from "@/components/ui/global-search";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { keepSorted } from "@/lib/server-sort";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertTriangle,
  Plus,
  Grid3X3,
  List,
  Calendar,
  Clock,
  RotateCcw,
  FileText,
  Eye,
  MoreHorizontal,
  Home,
  Download,
} from "lucide-react";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { LeaseStatus } from "@/types";
import {
  leaseService,
  LeaseResponse,
  PaginatedLeasesResponse,
  LeaseQueryParams,
} from "@/lib/services/lease.service";
import { LeaseCard } from "@/components/leases/LeaseCard";
import { ContractRent } from "@/components/leases/ContractRent";
import { LeaseInvoiceModal } from "@/components/invoices";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { GlobalPagination } from "@/components/ui/global-pagination";

/**
 * The list's query: contracts still running whose last day falls within
 * `expiring` days, today's included. The server answers it — the same rule
 * the file is cut by — rather than the page reading the first hundred active
 * contracts and doing the sum on the browser's clock.
 */
type ExpiringQuery = LeaseQueryParams & { expiring?: number };

export default function ExpiringLeasesPage() {
  const router = useRouter();
  const { t, formatDate } = useLocalizationContext();
  const [leases, setLeases] = useState<LeaseResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 12,
    total: 0,
    pages: 0,
    hasNext: false,
    hasPrev: false,
  });
  const [filters, setFilters] = useState<LeaseQueryParams>({
    page: 1,
    limit: 12,
    search: "",
    status: LeaseStatus.ACTIVE,
    sortBy: "endDate",
    sortOrder: "asc",
  });
  const viewMode = useViewPreferencesStore((state) => state.expiringLeasesView);
  const setViewMode = useViewPreferencesStore(
    (state) => state.setExpiringLeasesView,
  );
  const [timeFilter, setTimeFilter] = useState<"30" | "60" | "90">("30");
  const [stats, setStats] = useState({
    expiring30Days: 0,
    expiring60Days: 0,
    expiring90Days: 0,
    totalExpiring: 0,
    // Of the 30-day count, the contracts that already have a renewal waiting
    // or in force. Null until counted, so the card never shows a made-up 0.
    withRenewal: null as number | null,
  });

  const fetchExpiringLeases = useCallback(
    async (
      currentFilters: LeaseQueryParams,
      currentTimeFilter: string,
      showFullLoading = false,
    ) => {
      try {
        // Only show full skeleton loaders on initial load, not during search
        if (showFullLoading) {
          setLoading(true);
        }
        setIsSearching(true);

        const baseParams: ExpiringQuery = {
          search: currentFilters.search,
          status: currentFilters.status,
          sortBy: currentFilters.sortBy,
          sortOrder: currentFilters.sortOrder,
          expiring: parseInt(currentTimeFilter),
          page: currentFilters.page || 1,
          limit: currentFilters.limit || 12,
        };
        // The server searches, orders and pages: the table, its total and
        // the file all describe the same contracts.
        const response: PaginatedLeasesResponse =
          await leaseService.getLeases(baseParams);
        const page = baseParams.page ?? 1;
        const limit = baseParams.limit ?? 12;
        const total = response.pagination?.total ?? response.data.length;
        const pages = Math.max(1, Math.ceil(total / limit));
        if (response.data.length === 0 && total > 0 && page > pages) {
          setFilters((prev) => ({ ...prev, page: pages }));
          return;
        }
        setLeases(response.data);
        setPagination({
          page,
          limit,
          total,
          pages,
          hasNext: page < pages,
          hasPrev: page > 1,
        });
      } catch {
        showSimpleError(
          t("leases.expiring.toasts.loadErrorTitle"),
          t("leases.expiring.toasts.fetchError"),
        );
      } finally {
        setLoading(false);
        setIsSearching(false);
        setIsInitialLoad(false);
      }
    },
    [t],
  );

  const fetchStats = async () => {
    try {
      // How many contracts end within each window — counted by the server, on
      // the office's calendar, over every active contract rather than the
      // first hundred of them.
      const count = async (days: number) => {
        const response = await leaseService.getLeases({
          status: LeaseStatus.ACTIVE,
          expiring: days,
          page: 1,
          limit: 1,
        } as ExpiringQuery);
        return response.pagination?.total ?? response.data?.length ?? 0;
      };
      const withRenewal = async () => {
        const response = await fetch(
          "/api/leases?expiring=30&countWithRenewal=true",
          { credentials: "include" },
        );
        if (!response.ok) return null;
        const body = await response.json();
        return typeof body?.data?.count === "number"
          ? (body.data.count as number)
          : null;
      };
      const [count30, count60, count90, renewals] = await Promise.all([
        count(30),
        count(60),
        count(90),
        withRenewal(),
      ]);

      setStats({
        expiring30Days: count30,
        expiring60Days: count60,
        expiring90Days: count90,
        totalExpiring: count30,
        withRenewal: renewals,
      });
    } catch {
      // Failed to fetch lease stats
    }
  };

  // Initial load effect - runs once on mount
  useEffect(() => {
    fetchExpiringLeases(filters, timeFilter, true); // Show full loading on initial load
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect to refetch when filters or timeFilter change (but not on initial mount)
  useEffect(() => {
    if (!isInitialLoad) {
      fetchExpiringLeases(filters, timeFilter, false); // Don't show full loading during search
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, timeFilter]);

  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    setFilters((prev) => ({ ...prev, search: value, page: 1 }));
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchTerm("");
    setFilters((prev) => ({ ...prev, search: "", page: 1 }));
  }, []);

  const handleSort = (sortBy: string, sortOrder: "asc" | "desc") => {
    setFilters((prev) => ({ ...prev, sortBy, sortOrder, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  };
  const handlePageSizeChange = (newLimit: number) => {
    setFilters((prev) => ({ ...prev, limit: newLimit, page: 1 }));
  };

  const handleLeaseUpdate = () => {
    fetchExpiringLeases(filters, timeFilter, false);
    fetchStats();
  };

  // Calendar days to the last day, on the office's calendar: 0 on the day
  // itself. The file's "Days remaining" is worked out the same way.
  const getDaysUntilExpiry = (endDate: string) => businessDaysUntil(endDate);

  const getUrgencyColor = (days: number) => {
    if (days <= 7) return "text-red-600";
    if (days <= 30) return "text-orange-600";
    return "text-yellow-600";
  };

  // Helper function to get urgency badge
  const getUrgencyBadge = (days: number) => {
    if (days <= 7) {
      return (
        <Badge variant="destructive">
          {t("leases.expiring.urgency.critical", { defaultValue: "Critical" })}
        </Badge>
      );
    } else if (days <= 30) {
      return (
        <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
          {t("leases.expiring.urgency.warning", { defaultValue: "Warning" })}
        </Badge>
      );
    } else {
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
          {t("leases.expiring.urgency.upcoming", { defaultValue: "Upcoming" })}
        </Badge>
      );
    }
  };

  // Define columns for the DataTable
  const leaseColumns: DataTableColumn<LeaseResponse>[] = [
    {
      id: "property",
      header: t("leases.expiring.table.property", { defaultValue: "Property" }),
      cell: (lease) => (
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0">
            <Home className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <div className="font-medium">
              {lease.propertyId?.name ||
                t("leases.labels.propertyNotAvailable")}
              {lease.unit && (
                <span className="ms-2 text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded">
                  {t("leases.labels.unit")} {lease.unit.unitNumber}
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {lease.propertyId?.address ? (
                <>
                  {lease.propertyId.address.street},{" "}
                  {lease.propertyId.address.city}
                </>
              ) : (
                <span className="text-gray-400 italic">
                  {t("leases.labels.addressNotAvailable")}
                </span>
              )}
            </div>
          </div>
        </div>
      ),
      className: "min-w-[200px]",
    },
    {
      id: "tenant",
      header: t("leases.expiring.table.tenant", { defaultValue: "Tenant" }),
      cell: (lease) => (
        <div className="flex items-center space-x-3">
          <Avatar className="h-8 w-8">
            <AvatarImage
              src={lease.tenantId?.avatar}
              alt={`${lease.tenantId?.firstName || ""} ${
                lease.tenantId?.lastName || ""
              }`}
            />
            <AvatarFallback>
              {lease.tenantId?.firstName?.[0] || "T"}
              {lease.tenantId?.lastName?.[0] || ""}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium">
              {lease.tenantId?.firstName && lease.tenantId?.lastName
                ? `${lease.tenantId.firstName} ${lease.tenantId.lastName}`
                : t("leases.labels.unknownTenant")}
            </div>
            <div className="text-sm text-muted-foreground">
              {lease.tenantId?.email || t("leases.labels.noEmail")}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "rentAmount",
      sortKey: "terms.rentAmount",
      header: t("leases.expiring.table.rent", { defaultValue: "Rent" }),
      visibility: "md",
      cell: (lease) => <ContractRent lease={lease} />,
    },
    {
      id: "expiryDate",
      sortKey: "endDate",
      header: t("leases.expiring.table.expiryDate", {
        defaultValue: "Expiry Date",
      }),
      visibility: "lg",
      cell: (lease) => (
        <div className="text-sm">{formatDate(lease.endDate)}</div>
      ),
    },
    {
      id: "daysLeft",
      sortKey: "endDate",
      header: t("leases.expiring.table.daysLeft", {
        defaultValue: "Days Left",
      }),
      visibility: "md",
      cell: (lease) => {
        const days = getDaysUntilExpiry(lease.endDate);
        return (
          <div className={`text-sm font-medium ${getUrgencyColor(days)}`}>
            {t("leases.expiring.labels.daysLeft", { values: { days } })}
          </div>
        );
      },
    },
    {
      id: "urgency",
      sortKey: "endDate",
      header: t("leases.expiring.table.urgency", { defaultValue: "Urgency" }),
      visibility: "md",
      cell: (lease) => {
        const days = getDaysUntilExpiry(lease.endDate);
        return getUrgencyBadge(days);
      },
    },
    {
      id: "actions",
      header: t("leases.expiring.table.actions", { defaultValue: "Actions" }),
      align: "right",
      cell: (lease) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {t("leases.expiring.table.actionsLabel", {
                defaultValue: "Actions",
              })}
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/leases/${lease._id}`}>
                <Eye className="me-2 h-4 w-4" />
                {t("leases.expiring.table.viewDetails", {
                  defaultValue: "View Details",
                })}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/leases/${lease._id}?action=renew`}>
                <RotateCcw className="me-2 h-4 w-4" />
                {t("leases.expiring.table.renewLease", {
                  defaultValue: "Renew Lease",
                })}
              </Link>
            </DropdownMenuItem>
            <LeaseInvoiceModal
              lease={lease}
              trigger={
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <Download className="me-2 h-4 w-4" />
                  {t("leases.expiring.table.downloadPdf", {
                    defaultValue: "Download PDF",
                  })}
                </DropdownMenuItem>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("leases.expiring.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("leases.expiring.header.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* The list as it stands on screen — the window, the search, the
              order — to Excel, PDF or CSV. */}
          <ReportExportButton
            endpoint="/api/leases"
            params={(() => {
              const params = new URLSearchParams();
              params.set("expiring", timeFilter);
              if (filters.status) params.set("status", String(filters.status));
              if (filters.search) params.set("search", filters.search);
              if (filters.sortBy) params.set("sortBy", filters.sortBy);
              if (filters.sortOrder) params.set("sortOrder", filters.sortOrder);
              return params;
            })()}
            disabled={loading}
          />
          <Button size="sm" onClick={() => router.push("/dashboard/leases/new")}>
            <Plus className="h-4 w-4" />
            {t("leases.actions.createLease")}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("leases.expiring.stats.next30Days")}
          value={stats.expiring30Days}
          icon={AlertTriangle}
          iconColor="error"
        />

        <AnalyticsCard
          title={t("leases.expiring.stats.next60Days")}
          value={stats.expiring60Days}
          icon={Calendar}
          iconColor="warning"
        />

        <AnalyticsCard
          title={t("leases.expiring.stats.next90Days")}
          value={stats.expiring90Days}
          icon={Clock}
          iconColor="warning"
        />

        <AnalyticsCard
          title={t("leases.expiring.stats.renewalReady")}
          value={stats.withRenewal ?? "—"}
          // Counted, not estimated: say what it counts.
          description={t("leases.expiring.stats.renewalReadyDescription")}
          icon={RotateCcw}
          iconColor="info"
        />
      </AnalyticsCardGrid>

      {/* Expiring Leases Display with Integrated Filters */}
      <Card className="gap-2">
        <CardHeader>
          {/* Main Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-50 dark:bg-orange-900/30 rounded-lg border border-orange-100 dark:border-orange-800">
                <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("leases.expiring.card.title", {
                    values: { count: pagination.total },
                    defaultValue: `Expiring Leases (${pagination.total})`,
                  })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("leases.expiring.card.subtitle", {
                    defaultValue: "Leases expiring soon that require attention",
                  })}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* View Mode Toggle */}
              <div className="flex items-center border rounded-lg p-1 w-full sm:w-auto">
                <Button
                  variant={viewMode === "grid" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("grid")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <Grid3X3 className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Integrated Filters Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            {/* Search - Using GlobalSearch with 300ms debounce */}
            <GlobalSearch
              placeholder={t("leases.expiring.filters.searchPlaceholder")}
              initialValue={searchTerm}
              debounceDelay={300}
              onSearch={handleSearch}
              onClear={handleClearSearch}
              isLoading={isSearching}
              className="flex-1 min-w-0"
              ariaLabel={t("leases.expiring.filters.searchAriaLabel")}
            />

            {/* Filter Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Time Range Filter */}
              <Select
                value={timeFilter}
                onValueChange={(value: "30" | "60" | "90") => {
                  setTimeFilter(value);
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
              >
                <SelectTrigger className="w-[140px] h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t(
                      "leases.expiring.filters.timeRangePlaceholder",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">
                    {t("leases.expiring.filters.next30Days")}
                  </SelectItem>
                  <SelectItem value="60">
                    {t("leases.expiring.filters.next60Days")}
                  </SelectItem>
                  <SelectItem value="90">
                    {t("leases.expiring.filters.next90Days")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Sort */}
              <Select
                value={`${filters.sortBy}-${filters.sortOrder}`}
                onValueChange={(value) => {
                  const [sortBy, sortOrder] = value.split("-");
                  handleSort(sortBy, sortOrder as "asc" | "desc");
                }}
              >
                <SelectTrigger className="w-40 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("leases.filters.sort")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="endDate-asc">
                    {t("leases.sort.endDateSoonest")}
                  </SelectItem>
                  <SelectItem value="endDate-desc">
                    {t("leases.sort.endDateLatest")}
                  </SelectItem>
                  <SelectItem value="terms.rentAmount-desc">
                    {t("leases.sort.rentHighToLow")}
                  </SelectItem>
                  <SelectItem value="terms.rentAmount-asc">
                    {t("leases.sort.rentLowToHigh")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Expiring Leases Grid/List/Table */}
          {leases.length === 0 ? (
            <Card className="p-0">
              <CardContent className="p-12 text-center">
                <Calendar className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  {t("leases.expiring.empty.noExpiringLeases")}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {filters.search
                    ? t("leases.expiring.empty.noMatches")
                    : t("leases.expiring.empty.noUpcomingInRange", {
                        values: { days: Number(timeFilter) },
                      })}
                </p>
                <Button onClick={() => router.push("/dashboard/leases")}>
                  <FileText className="me-2 h-4 w-4" />
                  {t("leases.expiring.actions.viewAllLeases")}
                </Button>
              </CardContent>
            </Card>
          ) : viewMode === "grid" ? (
            /* Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {leases?.map((lease) => {
                const daysUntilExpiry = getDaysUntilExpiry(lease.endDate);
                return (
                  <div key={lease._id} className="relative">
                    <LeaseCard
                      lease={lease}
                      onUpdate={handleLeaseUpdate}
                      onDelete={() => {}}
                    />
                    <div className="absolute top-2 end-2">
                      <Badge
                        variant="destructive"
                        className={`${getUrgencyColor(
                          daysUntilExpiry,
                        )} bg-white border`}
                      >
                        {t("leases.expiring.labels.daysLeft", {
                          values: { days: daysUntilExpiry },
                        })}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Table View */
            <DataTable<LeaseResponse>
              columns={leaseColumns}
              data={leases}
              loading={loading}
              getRowKey={(lease) => lease._id}
              // The headers and the sort menu are one order, which the API
              // applies across every page; days left and urgency both read
              // the end date. The list is always in some order (the menu has
              // no "none"), so a click on the sorted column turns it round.
              sort={{
                key: filters.sortBy ?? null,
                direction: filters.sortOrder ?? "asc",
                onSortChange: (key, direction) => {
                  const next = keepSorted(
                    { key: filters.sortBy ?? "endDate", direction: filters.sortOrder ?? "asc" },
                    { key, direction },
                  );
                  handleSort(next.key, next.direction);
                },
              }}
              emptyState={{
                icon: <Calendar className="h-8 w-8 text-gray-400" />,
                title: t("leases.expiring.empty.noExpiringLeases"),
                description: filters.search
                  ? t("leases.expiring.empty.noMatches")
                  : t("leases.expiring.empty.noUpcomingInRange", {
                      values: { days: Number(timeFilter) },
                    }),
                action: (
                  <Button onClick={() => router.push("/dashboard/leases")}>
                    <FileText className="me-2 h-4 w-4" />
                    {t("leases.expiring.actions.viewAllLeases")}
                  </Button>
                ),
              }}
            />
          )}
          {pagination.total > 0 && (
            <GlobalPagination
              currentPage={filters.page || 1}
              totalPages={pagination.pages}
              totalItems={pagination.total}
              pageSize={filters.limit ?? 10}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              showingLabel={t("common.showing", { defaultValue: "Showing" })}
              previousLabel={t("common.previous", { defaultValue: "Previous" })}
              nextLabel={t("common.next", { defaultValue: "Next" })}
              pageLabel={t("common.page", { defaultValue: "Page" })}
              ofLabel={t("common.of", { defaultValue: "of" })}
              itemsPerPageLabel={t("common.perPage", {
                defaultValue: "per page",
              })}
              disabled={loading || isSearching}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
