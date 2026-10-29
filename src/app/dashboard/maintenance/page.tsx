"use client";

import Link from "next/link";
import { ReportExportButton } from "@/components/reports/export-button";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Wrench,
  Plus,
  Search,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  User,
  Play,
  X,
  Image,
  Grid3X3,
  List,
  AlertCircle,
} from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useRouter, useSearchParams } from "next/navigation";
import { MaintenancePriority, MaintenanceStatus } from "@/types";
import { useMaintenanceStaff } from "@/hooks/use-maintenance-staff";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { keepSorted } from "@/lib/server-sort";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { MaintenanceStatusManager } from "@/components/maintenance/maintenance-status-manager";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { formatDisplayDateTime } from "@/lib/utils/formatting";
import {
  businessDay,
  businessPresetRange,
  type DayPreset,
} from "@/lib/dates/business-day";
import {
  isUrgentRequest,
  maintenanceDaysOverdue,
} from "@/lib/reports/maintenance-list";

/**
 * The date filter's options as the windows they name — the file is cut by the
 * same ones (`?date=` on /api/maintenance). "This week" and "this month" were
 * options the filter did not know, so they showed every request.
 */
const DATE_FILTER_PRESETS: Record<string, DayPreset> = {
  TODAY: "today",
  THIS_WEEK: "week",
  THIS_MONTH: "month",
};

interface MaintenanceRequestWithPopulated {
  _id: string;
  title: string;
  description: string;
  category: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  estimatedCost?: number;
  actualCost?: number;
  scheduledDate?: Date;
  completedDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  images: string[];
  property: {
    _id?: string;
    name: string;
    address: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
    };
  };
  propertyId?: string | { _id?: string };
  unit?: {
    _id: string;
    unitNumber: string;
    unitType: string;
    status: string;
  };
  tenant: {
    user: {
      _id?: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
    };
  };
  tenantId?: string | { _id?: string };
  assignedTo?: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
}

export default function MaintenancePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { isTenant } = useAuthorization();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL_STATUSES");
  const [priorityFilter, setPriorityFilter] =
    useState<string>("ALL_PRIORITIES");
  const [categoryFilter, setCategoryFilter] =
    useState<string>("ALL_CATEGORIES");
  const [dateFilter, setDateFilter] = useState<string>("ALL_DATES");
  const [assignedFilter, setAssignedFilter] = useState<string>("ALL_ASSIGNED");
  const [overdueFilter, setOverdueFilter] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const { t, formatCurrency: formatMoney } = useLocalizationContext();
  const viewMode = useViewPreferencesStore((state) => state.maintenanceView);
  const setViewMode = useViewPreferencesStore(
    (state) => state.setMaintenanceView,
  );
  const [maintenanceRequests, setMaintenanceRequests] = useState<
    MaintenanceRequestWithPopulated[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const searchParams = useSearchParams();
  const [urgentFilter, setUrgentFilter] = useState<boolean>(false);

  // Fetch available maintenance staff for assignment
  const { staff: availableStaff } = useMaintenanceStaff();

  // Redirect tenants to their my-requests page
  useEffect(() => {
    if (session?.user && isTenant) {
      toast.info(t("maintenance.list.redirectingTenant", { defaultValue: "Opening your maintenance requests…" }));
      router.push("/dashboard/maintenance/my-requests");
    }
  }, [session, isTenant, router]);

  useEffect(() => {
    // Only fetch if not a tenant (tenants are redirected)
    if (session && !isTenant) {
      const filterParam = searchParams?.get("filter");
      if (filterParam === "urgent") {
        setUrgentFilter(true);
      } else {
        setUrgentFilter(false);
      }
      fetchMaintenanceRequests();
    }
  }, [session, isTenant, searchParams]);

  // Handle status updates
  const handleStatusUpdate = (
    requestId: string,
    newStatus: MaintenanceStatus,
  ) => {
    setMaintenanceRequests((prev) =>
      prev.map((request) =>
        request._id === requestId ? { ...request, status: newStatus } : request,
      ),
    );
  };

  // Handle request updates (refresh data)
  const handleRequestUpdate = () => {
    fetchMaintenanceRequests();
  };

  const fetchMaintenanceRequests = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/maintenance?limit=100");

      if (!response.ok) {
        throw new Error("Failed to fetch maintenance requests");
      }

      const data = await response.json();
      setMaintenanceRequests(data?.data ?? []);
    } catch (error: any) {
      const errorMessage =
        error.message || "Failed to load maintenance requests";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Calendar days past the priority's allowance, on the office's calendar —
  // the same count the file's "Days overdue" column carries.
  const getDaysOverdue = (
    createdAt: Date | string | undefined,
    priority: MaintenancePriority | undefined,
    status: MaintenanceStatus | undefined,
  ) => maintenanceDaysOverdue({ createdAt, priority, status });

  const filteredAndSortedRequests = maintenanceRequests
    .filter((request: MaintenanceRequestWithPopulated) => {
      const matchesSearch =
        (request?.title?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        ) ||
        (request?.description?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        ) ||
        (request?.category?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        ) ||
        (request?.property?.name?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        ) ||
        (request?.tenant?.user?.firstName?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        ) ||
        (request?.tenant?.user?.lastName?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        );

      const matchesStatus =
        statusFilter === "ALL_STATUSES" || request?.status === statusFilter;
      const matchesPriority =
        priorityFilter === "ALL_PRIORITIES" ||
        request?.priority === priorityFilter;
      const matchesCategory =
        categoryFilter === "ALL_CATEGORIES" ||
        request?.category === categoryFilter;

      const matchesUrgent = !urgentFilter || isUrgentRequest(request);

      // Date filter: the day it was raised falls in the window.
      const matchesDate = (() => {
        const preset = DATE_FILTER_PRESETS[dateFilter];
        if (!preset) return true;
        const window = businessPresetRange(preset);
        const raised = businessDay(request?.createdAt);
        return raised >= window.from && raised <= window.to;
      })();

      // Assignment filter
      const matchesAssigned = (() => {
        if (assignedFilter === "ALL_ASSIGNED") return true;
        if (assignedFilter === "ASSIGNED") return !!request?.assignedTo;
        if (assignedFilter === "UNASSIGNED") return !request?.assignedTo;
        return true;
      })();

      // Overdue filter
      const matchesOverdue =
        !overdueFilter ||
        getDaysOverdue(request?.createdAt, request?.priority, request?.status) >
          0;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPriority &&
        matchesCategory &&
        matchesDate &&
        matchesAssigned &&
        matchesOverdue &&
        matchesUrgent
      );
    })
    .sort((a, b) => {
      let aValue: any, bValue: any;

      switch (sortBy) {
        case "title":
          aValue = a?.title || "";
          bValue = b?.title || "";
          break;
        case "priority":
          const priorityOrder = {
            [MaintenancePriority.EMERGENCY]: 4,
            [MaintenancePriority.HIGH]: 3,
            [MaintenancePriority.MEDIUM]: 2,
            [MaintenancePriority.LOW]: 1,
          };
          aValue = priorityOrder[a?.priority as MaintenancePriority] || 0;
          bValue = priorityOrder[b?.priority as MaintenancePriority] || 0;
          break;
        case "status":
          aValue = a?.status || "";
          bValue = b?.status || "";
          break;
        // The names the building, tenant and assignee columns show.
        case "property":
          aValue = a?.property?.name || "";
          bValue = b?.property?.name || "";
          break;
        case "tenant":
          aValue = a?.tenant?.user?.firstName || "";
          bValue = b?.tenant?.user?.firstName || "";
          break;
        case "assignedTo":
          aValue = a?.assignedTo?.firstName || "";
          bValue = b?.assignedTo?.firstName || "";
          break;
        case "createdAt":
          aValue = new Date(a?.createdAt || "").getTime();
          bValue = new Date(b?.createdAt || "").getTime();
          break;
        case "cost":
          aValue = a?.estimatedCost ?? a?.actualCost ?? 0;
          bValue = b?.estimatedCost ?? b?.actualCost ?? 0;
          break;
        default:
          aValue = new Date(a?.createdAt || "").getTime();
          bValue = new Date(b?.createdAt || "").getTime();
      }

      if (sortOrder === "asc") {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

  // Use the filtered and sorted requests for display
  const filteredRequests = filteredAndSortedRequests;

  const totalItems = filteredRequests.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const visibleRequests = filteredRequests.slice(startIndex, endIndex);
  const hasActiveFilters =
    !!searchTerm ||
    statusFilter !== "ALL_STATUSES" ||
    priorityFilter !== "ALL_PRIORITIES" ||
    categoryFilter !== "ALL_CATEGORIES" ||
    dateFilter !== "ALL_DATES" ||
    assignedFilter !== "ALL_ASSIGNED" ||
    overdueFilter ||
    urgentFilter;
  const showEmptyState = filteredRequests.length === 0 && !loading;
  const emptyStateDescription = hasActiveFilters
    ? t("maintenance.empty.description")
    : t("maintenance.empty.descriptionStart");
  const emptyStateAction =
    showEmptyState && !hasActiveFilters ? (
      <Link href="/dashboard/maintenance/new">
        <Button>
          <Plus className="me-2 h-4 w-4" />
          {t("maintenance.actions.createFirstRequest")}
        </Button>
      </Link>
    ) : undefined;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalItems, pageSize, currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    statusFilter,
    priorityFilter,
    categoryFilter,
    dateFilter,
    assignedFilter,
    overdueFilter,
    sortBy,
    sortOrder,
  ]);

  const handlePageChange = (page: number) => setCurrentPage(page);
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const getPriorityColor = (priority: MaintenancePriority | undefined) => {
    if (!priority) return "outline";

    switch (priority) {
      case MaintenancePriority.EMERGENCY:
        return "destructive";
      case MaintenancePriority.HIGH:
        return "destructive";
      case MaintenancePriority.MEDIUM:
        return "default";
      case MaintenancePriority.LOW:
        return "secondary";
      default:
        return "outline";
    }
  };

  const getStatusColor = (status: MaintenanceStatus | undefined) => {
    if (!status) return "outline";

    switch (status) {
      case MaintenanceStatus.SUBMITTED:
        return "default";
      case MaintenanceStatus.ASSIGNED:
        return "secondary";
      case MaintenanceStatus.IN_PROGRESS:
        return "default";
      case MaintenanceStatus.COMPLETED:
        return "secondary";
      case MaintenanceStatus.CANCELLED:
        return "outline";
      default:
        return "outline";
    }
  };

  const getStatusIcon = (status: MaintenanceStatus | undefined) => {
    if (!status) return Clock;

    switch (status) {
      case MaintenanceStatus.SUBMITTED:
        return Clock;
      case MaintenanceStatus.ASSIGNED:
        return User;
      case MaintenanceStatus.IN_PROGRESS:
        return Play;
      case MaintenanceStatus.COMPLETED:
        return CheckCircle;
      case MaintenanceStatus.CANCELLED:
        return X;
      default:
        return Clock;
    }
  };

  // In the organization's currency, like every other amount — this was
  // hard-coded to US dollars.
  const formatCurrency = (amount: number | undefined) => {
    if (amount === undefined || amount === null) return "-";
    return formatMoney(amount);
  };

  const formatDate = (date: Date | string | undefined) => formatDisplayDateTime(date);

  const truncateWords = (text: string | undefined, maxWords: number) => {
    if (!text) return "N/A";

    const trimmedText = text.trim();
    if (!trimmedText) return "N/A";

    const words = trimmedText.split(/\s+/);
    if (words.length <= maxWords) return trimmedText;

    return `${words.slice(0, maxWords).join(" ")}...`;
  };

  // Define columns for DataTable
  const maintenanceColumns: DataTableColumn<MaintenanceRequestWithPopulated>[] =
    [
      {
        id: "request",
        sortKey: "title",
        header: t("maintenance.table.headers.request"),
        cell: (request) => (
          <Link
            href={`/dashboard/maintenance/${request._id}`}
            className="group inline-flex flex-col space-y-1 text-foreground transition-colors"
          >
            <div className="font-medium text-sm line-clamp-2 transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {truncateWords(request?.title, 3)}
            </div>
            <div className="text-xs text-muted-foreground line-clamp-1">
              {request?.category || "N/A"}
            </div>
            {(request?.images?.length || 0) > 0 && (
              <div className="flex items-center text-xs text-muted-foreground">
                <Image className="h-3 w-3 me-1" />
                {t("maintenance.labels.images", {
                  values: { count: request?.images?.length || 0 },
                })}
              </div>
            )}
          </Link>
        ),
      },
      {
        id: "property",
        sortKey: "property",
        header: t("maintenance.table.headers.property"),
        visibility: "lg" as const,
        cell: (request) => {
          const propertyId =
            request?.property?._id ||
            (typeof request?.propertyId === "string"
              ? request.propertyId
              : request?.propertyId?._id);

          const propertyContent = (
            <>
              <div className="font-medium text-sm truncate transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {truncateWords(request?.property?.name, 4)}
              </div>
              {request?.unit && (
                <div className="text-xs text-blue-600 truncate">
                  {t("maintenance.labels.unit", {
                    values: { number: request.unit.unitNumber },
                  })}{" "}
                  ({request.unit.unitType})
                </div>
              )}
              <div className="text-xs text-muted-foreground truncate">
                {request?.property?.address?.city || "N/A"},{" "}
                {request?.property?.address?.state || "N/A"}
              </div>
            </>
          );

          if (!propertyId) {
            return <div>{propertyContent}</div>;
          }

          return (
            <Link
              href={`/dashboard/properties/${propertyId}`}
              className="group inline-flex flex-col text-foreground transition-colors"
            >
              {propertyContent}
            </Link>
          );
        },
      },
      {
        id: "tenant",
        sortKey: "tenant",
        header: t("maintenance.table.headers.tenant"),
        visibility: "xl" as const,
        cell: (request) => {
          const tenantId =
            request?.tenant?.user?._id ||
            (typeof request?.tenantId === "string"
              ? request.tenantId
              : request?.tenantId?._id);

          const tenantContent = (
            <>
              <div className="font-medium text-sm truncate transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {request?.tenant?.user?.firstName || "N/A"}{" "}
                {request?.tenant?.user?.lastName || ""}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {request?.tenant?.user?.email || "N/A"}
              </div>
            </>
          );

          if (!tenantId) {
            return <div>{tenantContent}</div>;
          }

          return (
            <Link
              href={`/dashboard/tenants/${tenantId}`}
              className="group inline-flex flex-col text-foreground transition-colors"
            >
              {tenantContent}
            </Link>
          );
        },
      },
      {
        id: "priority",
        sortKey: "priority",
        header: t("maintenance.table.headers.priority"),
        cell: (request) => (
          <Badge
            variant={getPriorityColor(request?.priority)}
            className="capitalize text-xs"
          >
            {request?.priority === MaintenancePriority.EMERGENCY && (
              <AlertTriangle className="h-3 w-3 me-1" />
            )}
            <span className="truncate">
              {request?.priority === MaintenancePriority.EMERGENCY
                ? "Emerg"
                : request?.priority || "N/A"}
            </span>
          </Badge>
        ),
      },
      {
        id: "status",
        sortKey: "status",
        header: t("maintenance.table.headers.status"),
        cell: (request) => {
          const StatusIcon = getStatusIcon(request?.status);
          return (
            <Badge
              variant={getStatusColor(request?.status)}
              className="flex items-center gap-1 w-fit text-xs"
            >
              <StatusIcon className="h-3 w-3" />
              <span className="truncate">
                {request?.status?.replace("_", " ") || "N/A"}
              </span>
            </Badge>
          );
        },
      },
      {
        id: "assignedTo",
        sortKey: "assignedTo",
        header: t("maintenance.table.headers.assignedTo"),
        visibility: "lg" as const,
        cell: (request) =>
          request?.assignedTo ? (
            <div className="font-medium text-sm truncate">
              {request?.assignedTo?.firstName || "N/A"}{" "}
              {request?.assignedTo?.lastName || ""}
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">
              {t("maintenance.labels.unassigned")}
            </span>
          ),
      },
      {
        id: "cost",
        sortKey: "cost",
        header: t("maintenance.table.headers.cost"),
        visibility: "xl" as const,
        cell: (request) => (
          <div className="space-y-1">
            {request?.estimatedCost && (
              <div className="text-xs">
                {t("maintenance.labels.est")}{" "}
                {formatCurrency(request.estimatedCost)}
              </div>
            )}
            {request?.actualCost && (
              <div className="text-xs font-medium">
                {formatCurrency(request.actualCost)}
              </div>
            )}
            {!request?.estimatedCost && !request?.actualCost && (
              <span className="text-muted-foreground text-xs">-</span>
            )}
          </div>
        ),
      },
      {
        id: "created",
        sortKey: "createdAt",
        header: t("maintenance.table.headers.created"),
        visibility: "lg" as const,
        cell: (request) => (
          <div className="flex items-center space-x-1 text-xs">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            <span className="truncate">{formatDate(request?.createdAt)}</span>
          </div>
        ),
      },
      {
        id: "overdue",
        header: t("maintenance.table.headers.overdue"),
        visibility: "xl" as const,
        cell: (request) => {
          const daysOverdue = getDaysOverdue(
            request?.createdAt,
            request?.priority,
            request?.status,
          );
          return daysOverdue > 0 ? (
            <div className="text-xs text-red-600 font-medium">
              {daysOverdue}d
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">-</span>
          );
        },
      },
      {
        id: "actions",
        header: t("maintenance.table.headers.actions"),
        align: "right" as const,
        cell: (request) => (
          <MaintenanceStatusManager
            request={request as any}
            onStatusUpdate={handleStatusUpdate}
            onRequestUpdate={handleRequestUpdate}
            availableStaff={availableStaff}
          />
        ),
      },
    ];

  // Calculate statistics
  const stats = {
    total: filteredRequests.length,
    emergency: filteredRequests.filter(
      (r: MaintenanceRequestWithPopulated) =>
        r?.priority === MaintenancePriority.EMERGENCY &&
        (r?.status === MaintenanceStatus.SUBMITTED ||
          r?.status === MaintenanceStatus.ASSIGNED ||
          r?.status === MaintenanceStatus.IN_PROGRESS),
    ).length,
    inProgress: filteredRequests.filter(
      (r: MaintenanceRequestWithPopulated) =>
        r?.status === MaintenanceStatus.IN_PROGRESS,
    ).length,
    overdue: filteredRequests.filter(
      (r: MaintenanceRequestWithPopulated) =>
        getDaysOverdue(r?.createdAt, r?.priority, r?.status) > 0,
    ).length,
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("maintenance.header.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("maintenance.header.subtitle")}
            </p>
          </div>
          <Link href="/dashboard/maintenance/new">
            <Button>
              <Plus className="me-2 h-4 w-4" />
              {t("maintenance.newRequestButton")}
            </Button>
          </Link>
        </div>
        <div className="flex flex-col items-center justify-center min-h-100 space-y-4">
          <AlertTriangle className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">
            {t("maintenance.error.failedToLoad")}
          </h2>
          <p className="text-muted-foreground text-center">{error}</p>
          <Button onClick={fetchMaintenanceRequests}>
            {t("maintenance.error.tryAgain")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("maintenance.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("maintenance.header.subtitle")}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {/* The file carries the list as filtered — see the export branch
              in /api/maintenance. */}
          <ReportExportButton
            endpoint="/api/maintenance"
            params={(() => {
              const params = new URLSearchParams();
              if (searchTerm) params.set("search", searchTerm);
              if (statusFilter !== "ALL_STATUSES")
                params.set("status", statusFilter);
              if (priorityFilter !== "ALL_PRIORITIES")
                params.set("priority", priorityFilter);
              if (categoryFilter !== "ALL_CATEGORIES")
                params.set("category", categoryFilter);
              const preset = DATE_FILTER_PRESETS[dateFilter];
              if (preset) params.set("date", preset);
              if (assignedFilter === "ASSIGNED") params.set("assigned", "assigned");
              if (assignedFilter === "UNASSIGNED") params.set("assigned", "unassigned");
              if (overdueFilter) params.set("overdue", "true");
              if (urgentFilter) params.set("urgent", "true");
              // The table's order, so the file reads the way the list does.
              params.set("sortBy", sortBy);
              params.set("sortOrder", sortOrder);
              return params;
            })()}
            disabled={loading}
          />
          <Link href="/dashboard/maintenance/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              {t("maintenance.newRequestButton")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <AnalyticsCardGrid className="md:grid-cols-4 lg:grid-cols-4">
        <AnalyticsCard
          title={t("maintenance.stats.totalRequests")}
          value={stats.total}
          description={t("maintenance.stats.activeRequests")}
          icon={Wrench}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("maintenance.stats.emergency")}
          value={stats.emergency}
          description={t("maintenance.stats.urgentAttention")}
          icon={AlertTriangle}
          iconColor="error"
        />
        <AnalyticsCard
          title={t("maintenance.stats.inProgress")}
          value={stats.inProgress}
          description={t("maintenance.stats.currentlyWorking")}
          icon={Clock}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("maintenance.stats.overdue")}
          value={stats.overdue}
          description={t("maintenance.stats.pastSla")}
          icon={AlertCircle}
          iconColor="warning"
        />
      </AnalyticsCardGrid>

      {/* Maintenance Requests with Integrated Filters */}
      <Card className="gap-2">
        <CardHeader>
          {/* Main Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <Wrench className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("maintenance.table.title", {
                    values: { count: filteredRequests.length },
                  })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("maintenance.table.subtitle")}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* View Mode Toggle */}
              <div className="flex items-center border rounded-lg p-1 w-full sm:w-auto">
                <Button
                  variant={viewMode === "table" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("table")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "cards" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("cards")}
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <Grid3X3 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Integrated Filters Bar - Single Row */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <Input
                placeholder={t("maintenance.filters.searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10 h-10 border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500 bg-white dark:bg-gray-800"
              />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 w-35 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("maintenance.filters.statusPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL_STATUSES">
                    {t("maintenance.filters.options.allStatuses")}
                  </SelectItem>
                  <SelectItem value={MaintenanceStatus.SUBMITTED}>
                    {t("maintenance.status.submitted")}
                  </SelectItem>
                  <SelectItem value={MaintenanceStatus.ASSIGNED}>
                    {t("maintenance.status.assigned")}
                  </SelectItem>
                  <SelectItem value={MaintenanceStatus.IN_PROGRESS}>
                    {t("maintenance.status.inProgress")}
                  </SelectItem>
                  <SelectItem value={MaintenanceStatus.COMPLETED}>
                    {t("maintenance.status.completed")}
                  </SelectItem>
                  <SelectItem value={MaintenanceStatus.CANCELLED}>
                    {t("maintenance.status.cancelled")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="h-10 w-35 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("maintenance.filters.priorityPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL_PRIORITIES">
                    {t("maintenance.filters.options.allPriorities")}
                  </SelectItem>
                  <SelectItem value={MaintenancePriority.LOW}>
                    {t("maintenance.priority.low")}
                  </SelectItem>
                  <SelectItem value={MaintenancePriority.MEDIUM}>
                    {t("maintenance.priority.medium")}
                  </SelectItem>
                  <SelectItem value={MaintenancePriority.HIGH}>
                    {t("maintenance.priority.high")}
                  </SelectItem>
                  <SelectItem value={MaintenancePriority.EMERGENCY}>
                    {t("maintenance.priority.emergency")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-10 w-37.5 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("maintenance.filters.categoryPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL_CATEGORIES">
                    {t("maintenance.filters.options.allCategories")}
                  </SelectItem>
                  <SelectItem value="Plumbing">
                    {t("maintenance.category.plumbing")}
                  </SelectItem>
                  <SelectItem value="HVAC">
                    {t("maintenance.category.hvac")}
                  </SelectItem>
                  <SelectItem value="Electrical">
                    {t("maintenance.category.electrical")}
                  </SelectItem>
                  <SelectItem value="General Repair">
                    {t("maintenance.category.generalRepair")}
                  </SelectItem>
                  <SelectItem value="Appliances">
                    {t("maintenance.category.appliances")}
                  </SelectItem>
                  <SelectItem value="Flooring">
                    {t("maintenance.category.flooring")}
                  </SelectItem>
                  <SelectItem value="Painting">
                    {t("maintenance.category.painting")}
                  </SelectItem>
                  <SelectItem value="Roofing">
                    {t("maintenance.category.roofing")}
                  </SelectItem>
                  <SelectItem value="Windows">
                    {t("maintenance.category.windows")}
                  </SelectItem>
                  <SelectItem value="Doors">
                    {t("maintenance.category.doors")}
                  </SelectItem>
                  <SelectItem value="Landscaping">
                    {t("maintenance.category.landscaping")}
                  </SelectItem>
                  <SelectItem value="Pest Control">
                    {t("maintenance.category.pestControl")}
                  </SelectItem>
                  <SelectItem value="Security">
                    {t("maintenance.category.security")}
                  </SelectItem>
                  <SelectItem value="Emergency">
                    {t("maintenance.category.emergency")}
                  </SelectItem>
                  <SelectItem value="Other">
                    {t("maintenance.category.other")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="h-10 w-27.5 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("maintenance.filters.datePlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL_DATES">
                    {t("maintenance.filters.options.allDates")}
                  </SelectItem>
                  <SelectItem value="TODAY">
                    {t("maintenance.filters.options.today")}
                  </SelectItem>
                  <SelectItem value="THIS_WEEK">
                    {t("maintenance.filters.options.thisWeek")}
                  </SelectItem>
                  <SelectItem value="THIS_MONTH">
                    {t("maintenance.filters.options.thisMonth")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Clear Filters */}
              {(searchTerm ||
                statusFilter !== "ALL_STATUSES" ||
                priorityFilter !== "ALL_PRIORITIES" ||
                categoryFilter !== "ALL_CATEGORIES" ||
                dateFilter !== "ALL_DATES") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter("ALL_STATUSES");
                    setPriorityFilter("ALL_PRIORITIES");
                    setCategoryFilter("ALL_CATEGORIES");
                    setDateFilter("ALL_DATES");
                    setAssignedFilter("ALL_ASSIGNED");
                    setOverdueFilter(false);
                    setSortBy("createdAt");
                    setSortOrder("desc");
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("maintenance.actions.clearFilters")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {viewMode === "table" ? (
            <div className="hidden md:block max-w-full">
              <DataTable<MaintenanceRequestWithPopulated>
                columns={maintenanceColumns}
                data={visibleRequests}
                getRowKey={(request) => request._id}
                loading={loading}
                // The table holds one page of a list this page sorts in full
                // before paging it (the sort above); the headers drive that
                // order, so a click orders every request, not just this page.
                // The list always has an order — newest first unless chosen —
                // so a click on the sorted column turns it round.
                sort={{
                  key: sortBy,
                  direction: sortOrder,
                  onSortChange: (key, direction) => {
                    const next = keepSorted({ key: sortBy, direction: sortOrder }, { key, direction });
                    setSortBy(next.key);
                    setSortOrder(next.direction);
                  },
                }}
                emptyState={{
                  icon: <Wrench className="h-12 w-12 text-muted-foreground" />,
                  title: t("maintenance.empty.title"),
                  description: emptyStateDescription,
                  action: emptyStateAction,
                }}
                striped
              />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {visibleRequests.map((request) => {
                const StatusIcon = getStatusIcon(request?.status);
                const daysOverdue = getDaysOverdue(
                  request?.createdAt,
                  request?.priority,
                  request?.status,
                );

                return (
                  <Card
                    key={request._id}
                    className="hover:shadow-md transition-shadow"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1">
                          <CardTitle className="text-base line-clamp-2">
                            {truncateWords(request?.title, 3)}
                          </CardTitle>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={
                                getPriorityColor(request?.priority) as any
                              }
                              className="text-xs"
                            >
                              {request?.priority || "N/A"}
                            </Badge>
                            <Badge
                              variant={getStatusColor(request?.status) as any}
                              className="flex items-center gap-1 text-xs"
                            >
                              <StatusIcon className="h-3 w-3" />
                              {request?.status?.replace("_", " ") || "N/A"}
                            </Badge>
                          </div>
                        </div>
                        <MaintenanceStatusManager
                          request={request as any}
                          onStatusUpdate={handleStatusUpdate}
                          onRequestUpdate={handleRequestUpdate}
                          availableStaff={availableStaff}
                        />
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-3">
                      <div className="text-sm text-muted-foreground line-clamp-2">
                        {request?.description ||
                          t("maintenance.labels.noDescription")}
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="font-medium text-muted-foreground">
                            {t("maintenance.card.property")}
                          </div>
                          <div className="truncate">
                            {truncateWords(request?.property?.name, 4)}
                          </div>
                        </div>
                        <div>
                          <div className="font-medium text-muted-foreground">
                            {t("maintenance.card.tenant")}
                          </div>
                          <div className="truncate">
                            {request?.tenant?.user?.firstName || "N/A"}{" "}
                            {request?.tenant?.user?.lastName || ""}
                          </div>
                        </div>
                        <div>
                          <div className="font-medium text-muted-foreground">
                            {t("maintenance.card.category")}
                          </div>
                          <div className="truncate">
                            {request?.category || "N/A"}
                          </div>
                        </div>
                        <div>
                          <div className="font-medium text-muted-foreground">
                            {t("maintenance.card.cost")}
                          </div>
                          <div className="truncate">
                            {formatCurrency(
                              request?.estimatedCost ?? request?.actualCost,
                            )}
                          </div>
                        </div>
                      </div>

                      {request?.assignedTo && (
                        <div className="flex items-center gap-2 text-sm">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">
                            {t("maintenance.card.assignedTo")}
                          </span>
                          <span>
                            {request.assignedTo.firstName}{" "}
                            {request.assignedTo.lastName}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(request?.createdAt)}
                        </div>
                        {daysOverdue > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            {t("maintenance.card.daysOverdue", {
                              values: { days: daysOverdue },
                            })}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Mobile Table View */}
          {viewMode === "table" && (
            <div className="md:hidden">
              <div className="space-y-4">
                {visibleRequests.map((request) => {
                  const StatusIcon = getStatusIcon(request?.status);
                  const daysOverdue = getDaysOverdue(
                    request?.createdAt,
                    request?.priority,
                    request?.status,
                  );

                  return (
                    <Card key={request._id} className="p-4">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1 flex-1">
                            <h3 className="font-medium line-clamp-2">
                              {truncateWords(request?.title, 3)}
                            </h3>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  getPriorityColor(request?.priority) as any
                                }
                                className="text-xs"
                              >
                                {request?.priority || "N/A"}
                              </Badge>
                              <Badge
                                variant={getStatusColor(request?.status) as any}
                                className="flex items-center gap-1 text-xs"
                              >
                                <StatusIcon className="h-3 w-3" />
                                {request?.status?.replace("_", " ") || "N/A"}
                              </Badge>
                            </div>
                          </div>
                          <MaintenanceStatusManager
                            request={request as any}
                            onStatusUpdate={handleStatusUpdate}
                            onRequestUpdate={handleRequestUpdate}
                            availableStaff={availableStaff}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">
                              {t("maintenance.card.property")}:
                            </span>
                            <div className="truncate">
                              {truncateWords(request?.property?.name, 4)}
                              {request?.unit && (
                                <div className="text-xs text-blue-600">
                                  Unit {request.unit.unitNumber}
                                </div>
                              )}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("maintenance.card.tenant")}:
                            </span>
                            <div className="truncate">
                              {request?.tenant?.user?.firstName || "N/A"}{" "}
                              {request?.tenant?.user?.lastName || ""}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("maintenance.card.created")}:
                            </span>
                            <div>{formatDate(request?.createdAt)}</div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("maintenance.card.cost")}:
                            </span>
                            <div>
                              {formatCurrency(
                                request?.estimatedCost ?? request?.actualCost,
                              )}
                            </div>
                          </div>
                        </div>

                        {daysOverdue > 0 && (
                          <Badge
                            variant="destructive"
                            className="text-xs w-fit"
                          >
                            {t("maintenance.card.daysOverdue", {
                              values: { days: daysOverdue },
                            })}
                          </Badge>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {showEmptyState && (
            <div
              className={`flex flex-col items-center justify-center py-12 space-y-4 ${
                viewMode === "table" ? "md:hidden" : ""
              }`}
            >
              <Wrench className="h-12 w-12 text-muted-foreground" />
              <h3 className="text-lg font-semibold">
                {t("maintenance.empty.title")}
              </h3>
              <p className="text-muted-foreground text-center">
                {emptyStateDescription}
              </p>
              {emptyStateAction}
            </div>
          )}
          {totalItems > 0 && (
            <GlobalPagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={pageSize}
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
              disabled={loading}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
