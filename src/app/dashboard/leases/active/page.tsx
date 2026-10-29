"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { showSimpleError } from "@/lib/toast-notifications";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/ui/global-search";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { keepSorted } from "@/lib/server-sort";

// The sort menu's own orders. A header can choose one it does not list (the
// building, the tenant); the menu then shows its placeholder rather than a
// choice that is not the one in force.
const SORT_MENU_VALUES = [
  "endDate-asc",
  "endDate-desc",
  "startDate-desc",
  "terms.rentAmount-desc",
  "terms.rentAmount-asc",
];
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText,
  Plus,
  Grid3X3,
  List,
  CheckCircle,
  Calendar,
  DollarSign,
  Home,
  Eye,
  Edit,
  MoreHorizontal,
  X,
} from "lucide-react";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";

import {
  leaseService,
  LeaseResponse,
  PaginatedLeasesResponse,
  LeaseQueryParams,
} from "@/lib/services/lease.service";
import { LeaseCard } from "@/components/leases/LeaseCard";
import { ContractRent } from "@/components/leases/ContractRent";
import { leaseRentAmount } from "@/lib/lease-money";
import { leaseAnnualRent } from "@/lib/lease-installments";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { formatDisplayDate } from "@/lib/utils/formatting";

export default function ActiveLeasesPage() {
  const router = useRouter();
  const [leases, setLeases] = useState<LeaseResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  // Track if this is the initial load (for showing skeleton loaders only on first load)
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 12,
    total: 0,
    pages: 0,
    hasNext: false,
    hasPrev: false,
  });
  const [filters, setFilters] = useState<Omit<LeaseQueryParams, "status">>({
    page: 1,
    limit: 12,
    search: "",
    sortBy: "endDate",
    sortOrder: "asc",
  });
  const viewMode = useViewPreferencesStore((state) => state.activeLeasesView);
  const setViewMode = useViewPreferencesStore(
    (state) => state.setActiveLeasesView
  );
  const { t, formatCurrency } = useLocalizationContext();
  const [stats, setStats] = useState({
    total: 0,
    expiringThisMonth: 0,
    expiringNext30Days: 0,
    totalRentValue: 0,
  });

  const fetchActiveLeases = useCallback(
    async (
      currentFilters: Omit<LeaseQueryParams, "status">,
      showFullLoading = false
    ) => {
      try {
        // Only show full skeleton loaders on initial load, not during search
        if (showFullLoading) {
          setLoading(true);
        }
        // Fetch a large page and paginate client-side for consistent behavior
        const baseParams: Omit<LeaseQueryParams, "status"> = {
          search: currentFilters.search, // server may filter; we still apply client-side
          sortBy: currentFilters.sortBy,
          sortOrder: currentFilters.sortOrder,
          page: 1,
          limit: 1000,
        };

        const response: PaginatedLeasesResponse =
          await leaseService.getActiveLeases(baseParams);
        const allLeases = Array.isArray(response.data) ? response.data : [];

        // Client-side search filter (robust across nested fields)
        const search = (currentFilters.search || "").toLowerCase().trim();
        const filtered = allLeases.filter((lease) => {
          if (!search) return true;
          const haystack = [
            lease.propertyId?.name,
            lease.propertyId?.address?.street,
            lease.propertyId?.address?.city,
            lease.tenantId?.firstName,
            lease.tenantId?.lastName,
            lease.tenantId?.email,
            lease.unit?.unitNumber,
            lease.status,
          ]
            .filter(Boolean)
            .map((v) => String(v).toLowerCase());
          return haystack.some((v) => v.includes(search));
        });

        // Client-side sort (same approach as leases page)
        const sortBy = currentFilters.sortBy || "endDate";
        const sortOrder = currentFilters.sortOrder || "asc";
        const get = (obj: any, path: string) =>
          path
            .split(".")
            .reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
        const getSortVal = (lease: LeaseResponse) => {
          if (sortBy === "terms.rentAmount") {
            return leaseRentAmount(lease);
          }
          const v = get(lease, sortBy);
          if (!v) return 0;
          const key = sortBy.toLowerCase();
          if (
            key.includes("date") ||
            key.includes("createdat") ||
            key.includes("updatedat")
          ) {
            const t = new Date(v as any).getTime();
            return Number.isNaN(t) ? 0 : t;
          }
          return typeof v === "number" ? v : String(v).toLowerCase();
        };
        const sorted = [...filtered].sort((a, b) => {
          const av = getSortVal(a);
          const bv = getSortVal(b);
          if (typeof av === "number" && typeof bv === "number") {
            return sortOrder === "asc" ? av - bv : bv - av;
          }
          return sortOrder === "asc"
            ? String(av).localeCompare(String(bv))
            : String(bv).localeCompare(String(av));
        });

        // Client-side pagination
        const page = currentFilters.page || 1;
        const limit = currentFilters.limit || 10;
        const total = sorted.length;
        const pages = Math.max(1, Math.ceil(total / limit));
        const start = (page - 1) * limit;
        const paginated = sorted.slice(start, start + limit);

        setLeases(paginated);
        setPagination({
          page,
          limit,
          total,
          pages,
          hasNext: page < pages,
          hasPrev: page > 1,
        });

        // A month's worth of each contract's rent, whatever its cycle: a
        // quarterly 3,000 adds 1,000 here, not 3,000.
        const totalRentValue = filtered.reduce(
          (sum, lease) => sum + leaseAnnualRent(lease) / 12,
          0
        );

        setStats((prev) => ({
          ...prev,
          totalRentValue,
        }));
      } catch (error) {
        console.error("Error fetching active leases:", error);
        showSimpleError("Load Error", t("leases.active.toasts.fetchError"));
        setLeases([]);
        setStats((prev) => ({
          ...prev,
          totalRentValue: 0,
        }));
      } finally {
        setLoading(false);
        setIsSearching(false);
        setIsInitialLoad(false);
      }
    },
    [t]
  );

  const fetchStats = useCallback(async () => {
    try {
      const statsData = await leaseService.getLeaseStats();
      setStats((prev) => ({
        ...prev,
        total: statsData.active,
        expiringThisMonth: statsData.expiringThisMonth,
        expiringNext30Days: statsData.expiringThisMonth,
      }));
    } catch {
      setStats((prev) => ({
        ...prev,
        total: 0,
        expiringThisMonth: 0,
        expiringNext30Days: 0,
      }));
    }
  }, []);

  // Initial load effect - runs once on mount
  useEffect(() => {
    fetchActiveLeases(filters, true); // Show full loading on initial load
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect to refetch when filters change (but not on initial mount)
  useEffect(() => {
    if (!isInitialLoad) {
      fetchActiveLeases(filters, false); // Don't show full loading during search
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const handleSearch = useCallback((value: string) => {
    setIsSearching(true);
    setSearchTerm(value);
    setFilters((prev) => ({ ...prev, search: value, page: 1 }));
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
    fetchActiveLeases(filters, false);
    fetchStats();
  };

  // Helper function to calculate days remaining
  const getDaysRemaining = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  // Helper function to get urgency badge
  const getUrgencyBadge = (daysRemaining: number) => {
    if (daysRemaining <= 7) {
      return (
        <Badge variant="destructive">
          {t("leases.active.urgency.critical")}
        </Badge>
      );
    } else if (daysRemaining <= 30) {
      return (
        <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
          {t("leases.active.urgency.warning")}
        </Badge>
      );
    } else {
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
          {t("leases.active.urgency.normal")}
        </Badge>
      );
    }
  };

  // Define columns for the DataTable
  const leaseColumns: DataTableColumn<LeaseResponse>[] = [
    {
      id: "propertyUnit",
      sortKey: "propertyId.name",
      header: t("leases.table.propertyUnit"),
      cell: (lease) => {
        const propertyContent = (
          <>
            <div className="flex-shrink-0">
              <Home className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <div className="font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
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
          </>
        );

        if (!lease.propertyId?._id) {
          return (
            <div className="flex items-center space-x-3">{propertyContent}</div>
          );
        }

        return (
          <Link
            href={`/dashboard/properties/${lease.propertyId._id}`}
            className="group flex items-center space-x-3 text-foreground transition-colors"
          >
            {propertyContent}
          </Link>
        );
      },
      className: "min-w-[200px]",
    },
    {
      id: "tenant",
      sortKey: "tenantId.firstName",
      header: t("leases.table.tenant"),
      cell: (lease) => {
        const tenantContent = (
          <>
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
              <div className="font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {lease.tenantId?.firstName && lease.tenantId?.lastName
                  ? `${lease.tenantId.firstName} ${lease.tenantId.lastName}`
                  : t("leases.labels.unknownTenant")}
              </div>
              <div className="text-sm text-muted-foreground">
                {lease.tenantId?.email || t("leases.labels.noEmail")}
              </div>
            </div>
          </>
        );

        if (!lease.tenantId?._id) {
          return <div className="flex items-center space-x-3">{tenantContent}</div>;
        }

        return (
          <Link
            href={`/dashboard/tenants/${lease.tenantId._id}`}
            className="group flex items-center space-x-3 text-foreground transition-colors"
          >
            {tenantContent}
          </Link>
        );
      },
    },
    {
      id: "rentAmount",
      sortKey: "terms.rentAmount",
      header: t("leases.table.rentAmount"),
      visibility: "md",
      cell: (lease) => <ContractRent lease={lease} />,
    },
    {
      id: "startDate",
      sortKey: "startDate",
      header: t("leases.table.startDate"),
      visibility: "lg",
      cell: (lease) => (
        <div className="text-sm">
          {formatDisplayDate(lease.startDate)}
        </div>
      ),
    },
    {
      id: "endDate",
      sortKey: "endDate",
      header: t("leases.table.endDate"),
      visibility: "lg",
      cell: (lease) => (
        <div className="text-sm">
          {formatDisplayDate(lease.endDate)}
        </div>
      ),
    },
    {
      id: "daysRemaining",
      sortKey: "endDate",
      header: t("leases.table.daysRemaining"),
      visibility: "md",
      cell: (lease) => {
        const days = getDaysRemaining(lease.endDate);
        return (
          <div
            className={`text-sm font-medium ${
              days < 0
                ? "text-red-600"
                : days <= 30
                ? "text-orange-600"
                : "text-green-600"
            }`}
          >
            {days < 0
              ? t("leases.labels.expired")
              : t("leases.labels.days", { values: { days } })}
          </div>
        );
      },
    },
    {
      id: "urgency",
      sortKey: "endDate",
      header: t("leases.active.table.urgency"),
      visibility: "md",
      cell: (lease) => {
        const days = getDaysRemaining(lease.endDate);
        return getUrgencyBadge(days);
      },
    },
    {
      id: "actions",
      header: t("leases.table.actions"),
      align: "right",
      cell: (lease) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => router.push(`/dashboard/leases/${lease._id}`)}
            >
              <Eye className="h-4 w-4 me-2" />
              {t("leases.actions.viewDetails")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => router.push(`/dashboard/leases/${lease._id}/edit`)}
            >
              <Edit className="h-4 w-4 me-2" />
              {t("leases.actions.edit")}
            </DropdownMenuItem>
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
            {t("leases.active.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("leases.active.header.subtitle")}
          </p>
        </div>
        <Button size="sm" onClick={() => router.push("/dashboard/leases/new")}>
          <Plus className="h-4 w-4" />
          {t("leases.actions.createLease")}
        </Button>
      </div>

      {/* Stats Cards */}
      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("leases.active.stats.activeLeases")}
          value={stats.total}
          icon={CheckCircle}
          iconColor="success"
        />

        <AnalyticsCard
          title={t("leases.active.stats.expiringSoon")}
          value={stats.expiringNext30Days}
          icon={Calendar}
          iconColor="warning"
        />

        <AnalyticsCard
          title={t("leases.active.stats.monthlyRent")}
          value={formatCurrency(stats.totalRentValue)}
          icon={DollarSign}
          iconColor="info"
        />

        <AnalyticsCard
          title={t("leases.active.stats.thisMonth")}
          value={stats.expiringThisMonth}
          icon={FileText}
          iconColor="primary"
        />
      </AnalyticsCardGrid>

      {/* Active Leases Display with Integrated Filters */}
      <Card className="gap-2">
        <CardHeader>
          {/* Main Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 dark:bg-green-900/30 rounded-lg border border-green-100 dark:border-green-800">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("leases.active.card.title", {
                    values: { count: pagination.total },
                  })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("leases.active.card.subtitle")}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* View Mode Toggle */}
              <div className="flex items-center border rounded-lg p-1 w-full sm:w-auto">
                <Button
                  variant={viewMode === "cards" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("cards")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <Grid3X3 className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "table" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("table")}
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
              placeholder={t("leases.active.filters.searchPlaceholder")}
              initialValue={searchTerm}
              debounceDelay={300}
              onSearch={handleSearch}
              isLoading={isSearching}
              className="flex-1 min-w-0"
              ariaLabel={t("search.activeLeases", { defaultValue: "Search active leases" })}
            />

            {/* Filter Controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Sort */}
              <Select
                value={
                  SORT_MENU_VALUES.includes(`${filters.sortBy}-${filters.sortOrder}`)
                    ? `${filters.sortBy}-${filters.sortOrder}`
                    : ""
                }
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
                    {t("leases.sort.endDateLatest", {
                      defaultValue: "End Date (Latest)",
                    })}
                  </SelectItem>
                  <SelectItem value="startDate-desc">
                    {t("leases.sort.startDateLatest")}
                  </SelectItem>
                  <SelectItem value="terms.rentAmount-desc">
                    {t("leases.sort.rentHighToLow")}
                  </SelectItem>
                  <SelectItem value="terms.rentAmount-asc">
                    {t("leases.sort.rentLowToHigh")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Clear Filters */}
              {searchTerm && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setFilters((prev) => ({
                      ...prev,
                      search: "",
                      page: 1,
                    }));
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("leases.filters.clear") || "Clear"}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {viewMode === "cards" ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {loading && leases.length === 0 ? (
                [...Array(6)].map((_, i) => (
                  <Card key={i} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-5 w-5 rounded" />
                            <Skeleton className="h-5 w-32" />
                          </div>
                          <div className="flex items-center gap-1">
                            <Skeleton className="h-4 w-24" />
                            <span>•</span>
                            <Skeleton className="h-4 w-20" />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-6 w-16 rounded-full" />
                          <Skeleton className="h-8 w-8 rounded" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-1">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Skeleton className="h-3 w-16" />
                          <Skeleton className="h-4 w-20" />
                        </div>
                        <div className="space-y-1">
                          <Skeleton className="h-3 w-12" />
                          <Skeleton className="h-4 w-16" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Skeleton className="h-3 w-14" />
                          <Skeleton className="h-4 w-18" />
                        </div>
                        <div className="space-y-1">
                          <Skeleton className="h-3 w-12" />
                          <Skeleton className="h-4 w-16" />
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <Skeleton className="h-6 w-20 rounded-full" />
                        <Skeleton className="h-8 w-20 rounded" />
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : leases.length === 0 ? (
                <div className="col-span-full text-center py-8">
                  <div className="text-muted-foreground">
                    {filters.search
                      ? t("leases.active.empty.noMatches")
                      : t("leases.active.empty.noActiveLeases")}
                  </div>
                </div>
              ) : (
                leases.map((lease) => (
                  <LeaseCard
                    key={lease._id}
                    lease={lease}
                    onUpdate={handleLeaseUpdate}
                    // onDelete={() => {}}
                  />
                ))
              )}
            </div>
          ) : (
            <DataTable<LeaseResponse>
              columns={leaseColumns}
              data={leases}
              loading={loading}
              getRowKey={(lease) => lease._id}
              // The table holds one page of a list this page sorts itself, in
              // full, before paging it: the headers and the sort menu drive
              // that one order (days left and urgency both read the end
              // date). The list always has an order, so a click on the
              // sorted column turns it round.
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
                icon: <FileText className="h-8 w-8 text-gray-400" />,
                title: filters.search
                  ? t("leases.active.empty.noMatches")
                  : t("leases.active.empty.noActiveLeases"),
                description: t("leases.active.empty.description"),
                action: (
                  <Button onClick={() => router.push("/dashboard/leases/new")}>
                    <Plus className="me-2 h-4 w-4" />
                    {t("leases.actions.createLease")}
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
              pageSize={filters.limit ?? 12}
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
