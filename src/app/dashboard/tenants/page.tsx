"use client";

import Link from "next/link";
import { ReportExportButton } from "@/components/reports/export-button";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { useState, useEffect, useCallback } from "react";
import { ErrorAlert } from "@/components/ui/error-alert";
import TenantCard from "@/components/tenants/TenantCard";
import TenantStats from "@/components/tenants/TenantStats";
import { useSearchParams, useRouter } from "next/navigation";
import { GlobalPagination } from "@/components/ui/global-pagination";
import BulkStatusDialog from "@/components/tenants/BulkStatusDialog";
import TenantStatusBadge from "@/components/tenants/TenantStatusBadge";
import TenantDeleteDialog from "@/components/tenants/TenantDeleteDialog";
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
import TenantStatusDialog from "@/components/tenants/TenantStatusDialog";
import type { TenantRecord, TenantStatus } from "@/components/tenants/types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import type { SortDirection } from "@/lib/table-sort";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Plus,
  MoreHorizontal,
  Edit,
  Eye,
  Trash2,
  Phone,
  Mail,
  Calendar,
  List,
  LayoutGrid,
  RefreshCw,
  Users,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { GlobalSearch } from "@/components/ui/global-search";
import { formatCurrency, formatDate } from "@/lib/utils/formatting";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { useAuthorization } from "@/hooks/useAuthorization";

const currencyDisplayOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
} as const;

const formatTenantDate = (value?: string) =>
  value ? formatDate(value, { format: "medium" }) : "-";

const formatIncome = (amount?: number) =>
  typeof amount === "number"
    ? formatCurrency(amount, undefined, currencyDisplayOptions)
    : null;
type Tenant = TenantRecord;

export default function TenantsPage() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { isCompanyStaff } = useAuthorization();
  const router = useRouter();
  const { t } = useLocalizationContext();
  const canDelete = isCompanyStaff;
  const deleteBlockedMessage = t("tenants.delete.blockedActiveLease", {
    defaultValue:
      "This tenant has an active lease. Terminate the lease before deleting the tenant.",
  });
  const hasActiveLease = (tenant: Tenant) =>
    tenant.hasActiveLease || (tenant.activeLeaseCount ?? 0) > 0;

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [allTenants, setAllTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const viewMode = useViewPreferencesStore((state) => state.tenantsView);
  const setViewMode = useViewPreferencesStore((state) => state.setTenantsView);

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [selectedTenantForStatus, setSelectedTenantForStatus] =
    useState<Tenant | null>(null);

  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
  const [bulkStatusDialogOpen, setBulkStatusDialogOpen] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTenantForDelete, setSelectedTenantForDelete] =
    useState<Tenant | null>(null);

  const [activeLeaseBlockDialogOpen, setActiveLeaseBlockDialogOpen] =
    useState(false);
  const [tenantBlockedFromDelete, setTenantBlockedFromDelete] =
    useState<Tenant | null>(null);

  const [currentPage, setCurrentPage] = useState(
    parseInt(searchParams.get("page") || "1")
  );
  const itemsPerPage = parseInt(searchParams.get("limit") || "12");
  // A header's order, as /api/tenants names it (a field of the person) and
  // applies to every page; no key: newest first.
  const [sort, setSort] = useState<{ key: string | null; direction: SortDirection }>({
    key: null,
    direction: "asc",
  });
  const [totalTenants, setTotalTenants] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const fetchAllTenants = useCallback(async () => {
    try {
      setIsStatsLoading(true);

      const params = new URLSearchParams();
      params.set("limit", "1000");

      const response = await fetch(`/api/tenants?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch all tenants`);
      }

      const data = await response.json();
      const allTenantsData = data?.data;
      setAllTenants(allTenantsData || []);
    } catch (error) {
      setAllTenants([]);
    } finally {
      setIsStatsLoading(false);
    }
  }, []);

  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const handleStatusChange = (tenant: Tenant) => {
    setSelectedTenantForStatus(tenant);
    setStatusDialogOpen(true);
  };

  const handleStatusUpdate = (newStatus: TenantStatus) => {
    setTenants((prev) =>
      prev.map((tenant) =>
        tenant._id === selectedTenantForStatus?._id
          ? { ...tenant, tenantStatus: newStatus }
          : tenant
      )
    );

    setAllTenants((prev) =>
      prev.map((tenant) =>
        tenant._id === selectedTenantForStatus?._id
          ? { ...tenant, tenantStatus: newStatus }
          : tenant
      )
    );

    setSelectedTenantForStatus(null);
  };

  const handleTenantSelect = (tenantId: string, selected: boolean) => {
    setSelectedTenants((prev) =>
      selected ? [...prev, tenantId] : prev.filter((id) => id !== tenantId)
    );
  };

  const handleSelectAll = (selected: boolean) => {
    setSelectedTenants(selected ? tenants.map((t) => t._id) : []);
  };

  const handleBulkStatusUpdate = (
    tenantIds: string[],
    newStatus: TenantStatus
  ) => {
    setTenants((prev) =>
      prev.map((tenant) =>
        tenantIds.includes(tenant._id)
          ? { ...tenant, tenantStatus: newStatus }
          : tenant
      )
    );

    setAllTenants((prev) =>
      prev.map((tenant) =>
        tenantIds.includes(tenant._id)
          ? { ...tenant, tenantStatus: newStatus }
          : tenant
      )
    );

    setSelectedTenants([]);
  };

  const handleDeleteTenant = (tenant: Tenant) => {
    if (hasActiveLease(tenant)) {
      setTenantBlockedFromDelete(tenant);
      setActiveLeaseBlockDialogOpen(true);
      return;
    }

    setSelectedTenantForDelete(tenant);
    setDeleteDialogOpen(true);
  };

  const handleTenantDeleted = (tenantId: string) => {
    setTenants((prev) => prev.filter((tenant) => tenant._id !== tenantId));
    setAllTenants((prev) => prev.filter((tenant) => tenant._id !== tenantId));
    setSelectedTenantForDelete(null);
    setSelectedTenants((prev) => prev.filter((id) => id !== tenantId));
  };

  // Define columns for DataTable
  const tenantColumns: DataTableColumn<Tenant>[] = [
    {
      id: "tenant",
      sortKey: "firstName",
      header: t("tenants.table.tenant"),
      cell: (tenant) => (
        <Link
          href={`/dashboard/tenants/${tenant._id}`}
          className="group inline-flex items-center space-x-3 text-foreground transition-colors"
        >
          <Avatar className="h-10 w-10">
            <AvatarImage
              src={tenant.avatar}
              alt={`${tenant.firstName} ${tenant.lastName}`}
            />
            <AvatarFallback>
              {tenant.firstName.charAt(0)}
              {tenant.lastName.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {tenant.firstName} {tenant.lastName}
            </div>
            <div className="text-sm text-muted-foreground">{tenant.email}</div>
          </div>
        </Link>
      ),
    },
    {
      id: "status",
      sortKey: "tenantStatus",
      header: t("tenants.table.status"),
      cell: (tenant) => (
        <TenantStatusBadge
          status={tenant.tenantStatus}
          showIcon={true}
          size="default"
        />
      ),
    },
    {
      id: "contact",
      sortKey: "phone",
      header: t("tenants.table.contact"),
      cell: (tenant) => (
        <div className="space-y-1">
          <div className="flex items-center text-sm">
            <Phone className="h-3 w-3 me-1" />
            {tenant.phone}
          </div>
          <div className="flex items-center text-sm text-muted-foreground">
            <Mail className="h-3 w-3 me-1" />
            {tenant.email}
          </div>
        </div>
      ),
      visibility: "md" as const,
    },
    {
      id: "employment",
      header: t("tenants.table.employment"),
      cell: (tenant) =>
        tenant.employmentInfo ? (
          <div className="space-y-1">
            <div className="text-sm font-medium">
              {tenant.employmentInfo.employer}
            </div>
            <div className="text-sm text-muted-foreground">
              {tenant.employmentInfo.position}
            </div>
            <div className="text-sm text-muted-foreground">
              {formatIncome(tenant.employmentInfo.income) ?? "-"}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
      visibility: "lg" as const,
    },
    {
      id: "creditScore",
      header: t("tenants.table.creditScore"),
      cell: (tenant) =>
        tenant.creditScore !== undefined && tenant.creditScore !== null ? (
          <span className="font-medium">{tenant.creditScore}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
      visibility: "lg" as const,
    },
    {
      id: "applicationDate",
      sortKey: "applicationDate",
      header: t("tenants.table.applicationDate"),
      cell: (tenant) => (
        <div className="flex items-center text-sm">
          <Calendar className="h-3 w-3 me-1" />
          {formatTenantDate(tenant.applicationDate)}
        </div>
      ),
      visibility: "md" as const,
    },
    {
      id: "moveInOut",
      sortKey: "moveInDate",
      header: t("tenants.table.moveInOut"),
      cell: (tenant) => (
        <div className="space-y-1">
          {tenant.moveInDate && (
            <div className="text-sm">
              In: {formatTenantDate(tenant.moveInDate)}
            </div>
          )}
          {tenant.moveOutDate && (
            <div className="text-sm text-muted-foreground">
              Out: {formatTenantDate(tenant.moveOutDate)}
            </div>
          )}
          {!tenant.moveInDate && !tenant.moveOutDate && (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
      ),
      visibility: "lg" as const,
    },
    {
      id: "actions",
      header: t("tenants.table.actions"),
      align: "right" as const,
      cell: (tenant) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">
                {t("common.openMenu", { defaultValue: "Open menu" })}
              </span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t("tenants.menu.actions")}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => router.push(`/dashboard/tenants/${tenant._id}`)}
            >
              <Eye className="me-2 h-4 w-4" />
              {t("tenants.menu.viewDetails")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                router.push(`/dashboard/tenants/${tenant._id}/edit`)
              }
            >
              <Edit className="me-2 h-4 w-4" />
              {t("tenants.menu.editTenant")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleStatusChange(tenant)}>
              <RefreshCw className="me-2 h-4 w-4" />
              {t("tenants.menu.changeStatus")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {canDelete && (
              <DropdownMenuItem
                className="text-red-600"
                onClick={() => handleDeleteTenant(tenant)}
              >
                <Trash2 className="me-2 h-4 w-4" />
                {t("tenants.menu.deleteTenant")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // Fetch tenants - not wrapped in useCallback, using explicit deps in useEffect
  const fetchTenants = async () => {
    try {
      // Only show main loading on initial load
      if (!searchTerm) {
        setIsLoading(true);
      }
      setIsSearching(true);
      clearError();

      const params = new URLSearchParams();
      params.set("page", currentPage.toString());
      params.set("limit", itemsPerPage.toString());
      if (searchTerm) params.set("search", searchTerm);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (sort.key) {
        params.set("sortBy", sort.key);
        params.set("sortOrder", sort.direction);
      }

      console.log("🔍 Fetching tenants with params:", {
        page: currentPage,
        limit: itemsPerPage,
        search: searchTerm,
        status: statusFilter,
        url: `/api/tenants?${params.toString()}`,
      });

      const response = await fetch(`/api/tenants?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: Failed to fetch tenants`);
      }

      const data = await response.json();
      const tenantsData = data?.data;
      console.log("✅ Received tenants:", tenantsData?.length, "tenants");
      setTenants(tenantsData || []);

      if (data?.pagination) {
        setTotalTenants(data.pagination.total);
        setTotalPages(data.pagination.totalPages);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("tenants.list.loadFailed", { defaultValue: "Could not load the tenants" });
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
      setIsSearching(false);
    }
  };

  const handleRetry = () => {
    clearError();
    void fetchTenants();
    void fetchAllTenants();
  };

  // Effect to fetch tenants when search/filter/pagination changes
  useEffect(() => {
    void fetchTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, itemsPerPage, searchTerm, statusFilter, sort]);

  useEffect(() => {
    void fetchAllTenants();
  }, [fetchAllTenants]);

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(totalTenants / itemsPerPage));
    if (currentPage > tp) {
      setCurrentPage(1);
    }
  }, [totalTenants, itemsPerPage, currentPage]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (pageSize: number) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("limit", pageSize.toString());
    params.set("page", "1");
    router.push(`/dashboard/tenants?${params.toString()}`);
    setCurrentPage(1);
  };

  // Handler for debounced search from GlobalSearch component
  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    setCurrentPage(1); // Reset to first page on search
  }, []);

  const handleStatusFilterChange = (value: string) => {
    console.log("🎯 Status filter changed to:", value);
    setStatusFilter(value);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("tenants.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("tenants.header.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Carries the filters on screen, so the file and the table
              describe the same set of people. */}
          <ReportExportButton
            endpoint="/api/tenants"
            params={(() => {
              const params = new URLSearchParams();
              if (searchTerm) params.set("search", searchTerm);
              if (statusFilter && statusFilter !== "all")
                params.set("status", statusFilter);
              return params;
            })()}
          />
          <Link href="/dashboard/tenants/new">
            <Button size="sm">
              <Plus className="me-2 h-4 w-4" />
              {t("tenants.actions.addTenant.full")}
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorAlert
            title={t("tenants.error.loadingTenant")}
            message={error}
            onRetry={handleRetry}
            onDismiss={clearError}
          />
        </div>
      )}

      <TenantStats tenants={allTenants} />

      <Card className="gap-2">
        <CardHeader>
          {/* Main Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("tenants.header.title")} ({totalTenants})
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("tenants.pagination.summary", {
                    values: {
                      from: (currentPage - 1) * itemsPerPage + 1,
                      to: Math.min(currentPage * itemsPerPage, totalTenants),
                      total: totalTenants,
                    },
                  })}
                </p>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center border rounded-lg p-1 w-full sm:w-auto">
              <Button
                variant={viewMode === "table" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("table")}
                className="h-8 flex-1 sm:flex-none sm:px-3"
              >
                <List className="h-4 w-4 me-2" />
                {t("tenants.view.table")}
              </Button>
              <Button
                variant={viewMode === "cards" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("cards")}
                className="h-8 flex-1 sm:flex-none sm:px-3"
              >
                <LayoutGrid className="h-4 w-4 me-2" />
                {t("tenants.view.cards")}
              </Button>
            </div>
          </div>

          {/* Integrated Filters Bar */}
          <div className="flex flex-col gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            {/* Search and Status Filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Global Search Component with 300ms debounce */}
              <GlobalSearch
                placeholder={t("tenants.filters.searchPlaceholder")}
                initialValue={searchTerm}
                debounceDelay={300}
                onSearch={handleSearch}
                isLoading={isSearching}
                className="flex-1"
                ariaLabel={t("tenants.list.searchAria", { defaultValue: "Search tenants" })}
              />

              <Select
                value={statusFilter}
                onValueChange={handleStatusFilterChange}
              >
                <SelectTrigger className="h-10 w-full sm:w-[180px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("tenants.filters.status.all")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("tenants.filters.status.all")}
                  </SelectItem>
                  <SelectItem value="pending">
                    {t("tenants.filters.status.pending")}
                  </SelectItem>
                  <SelectItem value="approved">
                    {t("tenants.filters.status.approved")}
                  </SelectItem>
                  <SelectItem value="active">
                    {t("tenants.filters.status.active")}
                  </SelectItem>
                  <SelectItem value="inactive">
                    {t("tenants.filters.status.inactive")}
                  </SelectItem>
                  <SelectItem value="moved_out">
                    {t("tenants.filters.status.movedOut")}
                  </SelectItem>
                  <SelectItem value="terminated">
                    {t("tenants.filters.status.terminated")}
                  </SelectItem>
                  <SelectItem value="application_submitted">
                    {t("tenants.filters.status.applicationSubmitted")}
                  </SelectItem>
                  <SelectItem value="under_review">
                    {t("tenants.filters.status.underReview")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Clear Button - only show when filters are active */}
              {(searchTerm || statusFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    handleSearch("");
                    handleStatusFilterChange("all");
                  }}
                  className="h-10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  <XCircle className="h-4 w-4 me-2" />
                  {t("tenants.filters.clear") || "Clear"}
                </Button>
              )}
            </div>
          </div>

          {/* Bulk Selection Bar */}
          {selectedTenants.length > 0 && (
            <div className="mt-4 px-4 py-3 bg-muted/50 rounded-lg border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {t("tenants.bulk.selected", {
                      values: { count: selectedTenants.length },
                    })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedTenants([])}
                  >
                    {t("tenants.filters.clear")}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkStatusDialogOpen(true)}
                  >
                    <RefreshCw className="h-4 w-4 me-2" />
                    {t("tenants.actions.changeStatus")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            viewMode === "cards" ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <div className="h-12 w-12 bg-muted rounded-full animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                        <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-3 bg-muted rounded animate-pulse" />
                      <div className="h-3 bg-muted rounded w-2/3 animate-pulse" />
                      <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center space-x-4 p-4 border rounded-lg"
                  >
                    <div className="h-4 w-4 bg-muted rounded animate-pulse" />
                    <div className="h-10 w-10 bg-muted rounded-full animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded animate-pulse" />
                      <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
                    </div>
                    <div className="h-6 w-16 bg-muted rounded animate-pulse" />
                    <div className="h-8 w-8 bg-muted rounded animate-pulse" />
                  </div>
                ))}
              </div>
            )
          ) : tenants.length === 0 ? (
            <div className="text-center py-8">
              <h3 className="text-lg font-semibold mb-2">
                {t("tenants.empty.title")}
              </h3>
              <p className="text-muted-foreground mb-4">
                {t("tenants.empty.description")}
              </p>
              <Link href="/dashboard/tenants/new">
                <Button>
                  <Plus className="h-4 w-4 me-2" />
                  {t("tenants.actions.addFirstTenant")}
                </Button>
              </Link>
            </div>
          ) : viewMode === "cards" ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {tenants.map((tenant) => (
                <TenantCard
                  key={tenant._id}
                  tenant={tenant}
                  onEdit={(id) => router.push(`/dashboard/tenants/${id}/edit`)}
                  onDelete={handleDeleteTenant}
                />
              ))}
            </div>
          ) : (
            <DataTable<Tenant>
              columns={tenantColumns}
              data={tenants}
              getRowKey={(tenant) => tenant._id}
              // Sorted by the API across every page: the name by first name,
              // contact by the mobile shown first, the dates as they read.
              // Employment and credit score are not on the person record the
              // API orders, so their headers stay plain.
              sort={{
                key: sort.key,
                direction: sort.direction,
                onSortChange: (key, direction) => {
                  setSort({ key, direction });
                  setCurrentPage(1);
                },
              }}
              selection={{
                enabled: true,
                selectedIds: selectedTenants,
                onSelectAll: handleSelectAll,
                onSelectRow: handleTenantSelect,
                getRowId: (tenant) => tenant._id,
                selectAllLabel: t("tenants.table.selectAll"),
                selectRowLabel: (tenant) =>
                  t("tenants.table.selectTenant", {
                    values: { name: `${tenant.firstName} ${tenant.lastName}` },
                  }),
              }}
              emptyState={{
                icon: <Users className="h-12 w-12 text-muted-foreground" />,
                title: t("tenants.empty.title"),
                description: t("tenants.empty.description"),
              }}
              striped
            />
          )}

          {totalTenants > 0 && (
            <GlobalPagination
              currentPage={currentPage}
              totalPages={Math.max(1, Math.ceil(totalTenants / itemsPerPage))}
              totalItems={totalTenants}
              pageSize={itemsPerPage}
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
              disabled={isLoading || isSearching}
            />
          )}
        </CardContent>
      </Card>

      {selectedTenantForStatus && (
        <TenantStatusDialog
          isOpen={statusDialogOpen}
          onClose={() => {
            setStatusDialogOpen(false);
            setSelectedTenantForStatus(null);
          }}
          tenant={selectedTenantForStatus}
          onStatusChange={handleStatusUpdate}
          userRole={session?.user?.role || ""}
        />
      )}

      <BulkStatusDialog
        isOpen={bulkStatusDialogOpen}
        onClose={() => setBulkStatusDialogOpen(false)}
        selectedTenants={selectedTenants.map((id) => {
          const tenant = tenants.find((t) => t._id === id);
          return tenant
            ? {
                _id: tenant._id,
                firstName: tenant.firstName,
                lastName: tenant.lastName,
                tenantStatus: tenant.tenantStatus,
              }
            : { _id: id, firstName: "", lastName: "" };
        })}
        onBulkStatusChange={handleBulkStatusUpdate}
        userRole={session?.user?.role || ""}
      />

      <TenantDeleteDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        tenant={
          selectedTenantForDelete || { _id: "", firstName: "", lastName: "" }
        }
        onDelete={handleTenantDeleted}
        userRole={session?.user?.role || ""}
      />

      {/* Active Lease Delete Block Dialog */}
      <AlertDialog
        open={activeLeaseBlockDialogOpen}
        onOpenChange={setActiveLeaseBlockDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              {t("tenants.delete.blockedTitle", {
                defaultValue: "Cannot Delete Tenant",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{deleteBlockedMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = tenantBlockedFromDelete?._id;
                setActiveLeaseBlockDialogOpen(false);
                if (id) router.push(`/dashboard/tenants/${id}`);
              }}
            >
              {t("tenants.actions.viewDetails", {
                defaultValue: "View Details",
              })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
