"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useEffect, useCallback, useMemo } from "react";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { keepSorted } from "@/lib/server-sort";

// The sort menu's own orders. A header can choose one it does not list (the
// title, the tenant); the menu then shows its placeholder rather than a
// choice that is not the one in force.
const SORT_MENU_VALUES = ["createdAt", "hoursSinceCreation", "priority", "status", "property.name"];
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Clock,
  User,
  Plus,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle,
  XCircle,
  Zap,
  Timer,
  List,
  LayoutGrid,
  MoreHorizontal,
  UserPlus,
  FileText,
  Download,
  Settings,
  Eye,
  Edit,
  ExternalLink,
} from "lucide-react";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { toast } from "sonner";
import { MaintenanceStatus } from "@/types";
import { formatAddress } from "@/lib/utils";
import EmergencyCard from "@/components/emergency/EmergencyCard";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { MaintenanceStatusManager } from "@/components/maintenance/maintenance-status-manager";
import { timeAgo } from "@/lib/utils/date-fns-locale";
import { maintenanceStatusText } from "@/lib/maintenance-labels";
import {
  fetchReportFile,
  printReportFile,
  saveFile,
  type DownloadFormat,
} from "@/lib/reports/download";

interface EmergencyRequest {
  _id: string;
  title: string;
  description: string;
  priority: string;
  status: MaintenanceStatus;
  category: string;
  createdAt: string;
  updatedAt: string;
  hoursSinceCreation: number;
  isOverdue: boolean;
  urgencyLevel: "normal" | "overdue" | "critical" | "completed";
  property: {
    _id: string;
    name: string;
    address:
      | string
      | {
          street: string;
          city: string;
          state: string;
          zipCode: string;
          country: string;
        };
  };
  tenant: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    avatar?: string;
  };
  assignedUser?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatar?: string;
    phone?: string;
  };
  estimatedCost?: number;
  actualCost?: number;
  scheduledDate?: string;
  completedAt?: string;
  images?: string[];
  notes?: string;
  escalationLevel?: number;
  lastContactedAt?: string;
}

interface EmergencyStats {
  total: number;
  active: number;
  overdue: number;
  completed: number;
  unassigned: number;
  avgResponseTime: number;
  critical: number;
  escalated: number;
  todayCreated: number;
  weekCreated: number;
}

interface BulkAction {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
  action: (selectedIds: string[]) => void;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
}

interface QuickAssignData {
  requestId: string;
  assigneeId: string;
  notes?: string;
}

interface EmergencyPageData {
  requests: EmergencyRequest[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  statistics: EmergencyStats;
}

export default function EmergencyMaintenancePage() {
  const searchParams = useSearchParams();
  const { t, language, isRTL } = useLocalizationContext();

  const [data, setData] = useState<EmergencyPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filter states
  const [searchTerm, setSearchTerm] = useState(
    searchParams.get("search") || ""
  );
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get("status") || "all"
  );
  const [responseTimeFilter, setResponseTimeFilter] = useState(
    searchParams.get("responseTime") || "all"
  );
  const [propertyFilter, setPropertyFilter] = useState(
    searchParams.get("propertyId") || ""
  );
  const [assignedFilter, setAssignedFilter] = useState(
    searchParams.get("assignedTo") || "all"
  );
  const viewMode = useViewPreferencesStore(
    (state) => state.emergencyMaintenanceView
  );
  const setViewMode = useViewPreferencesStore(
    (state) => state.setEmergencyMaintenanceView
  );

  // Enhanced state management
  const [selectedRequests, setSelectedRequests] = useState<string[]>([]);
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [quickAssignDialog, setQuickAssignDialog] = useState(false);
  const [escalateDialog, setEscalateDialog] = useState(false);
  const [selectedRequestForAction, setSelectedRequestForAction] = useState<
    string | null
  >(null);
  const [assigneeOptions, setAssigneeOptions] = useState<
    Array<{ id: string; name: string; email: string }>
  >([]);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  // Enhanced data fetching with better error handling and caching
  const fetchEmergencyRequests = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("page", currentPage.toString());
      params.set("limit", pageSize.toString());
      if (searchTerm) params.set("search", searchTerm);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (responseTimeFilter !== "all")
        params.set("responseTime", responseTimeFilter);
      if (propertyFilter) params.set("propertyId", propertyFilter);
      if (assignedFilter !== "all") params.set("assignedTo", assignedFilter);
      if (sortBy) params.set("sortBy", sortBy);
      if (sortOrder) params.set("sortOrder", sortOrder);

      const response = await fetch(
        `/api/maintenance/emergency?${params.toString()}`,
        {
          headers: {
            "Cache-Control": "no-cache",
          },
        }
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch emergency requests");
      }

      setData(result.data);
      setError(null);

      // Clear selections when data changes
      setSelectedRequests([]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("maintenance.emergency.list.toasts.loadError"),
      );
      toast.error(t("maintenance.emergency.list.toasts.loadError"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [
    t,
    currentPage,
    pageSize,
    searchTerm,
    statusFilter,
    responseTimeFilter,
    propertyFilter,
    assignedFilter,
    sortBy,
    sortOrder,
  ]);

  /**
   * The list as it stands on screen — every filter and the order — handed to
   * the shared export path, which cuts the file from all the emergencies that
   * match, not the one page showing.
   */
  const exportRequest = useCallback(() => {
    const params = new URLSearchParams();
    if (searchTerm) params.set("search", searchTerm);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (responseTimeFilter !== "all")
      params.set("responseTime", responseTimeFilter);
    if (propertyFilter) params.set("propertyId", propertyFilter);
    if (assignedFilter !== "all") params.set("assignedTo", assignedFilter);
    if (sortBy) params.set("sortBy", sortBy);
    if (sortOrder) params.set("sortOrder", sortOrder);
    return {
      endpoint: "/api/maintenance/emergency",
      params,
      language,
      rtl: isRTL,
    };
  }, [
    searchTerm,
    statusFilter,
    responseTimeFilter,
    propertyFilter,
    assignedFilter,
    sortBy,
    sortOrder,
    language,
    isRTL,
  ]);

  const exportFailed = (error: string | null) =>
    toast.error(
      error ??
        t("reports.export.failed", {
          defaultValue: "The file could not be created",
        }),
    );

  const handleExport = async (format: DownloadFormat) => {
    const result = await fetchReportFile({ ...exportRequest(), format });
    if (!result.ok) return exportFailed(result.error);
    saveFile(result.blob, result.fileName);
  };

  // Print: the PDF opens in a window of its own and asks the viewer to print.
  // A browser that will not open the window is given the file to save instead.
  const handlePrint = async () => {
    const result = await printReportFile(
      exportRequest(),
      t("exports.document.preparing", {
        defaultValue: "Preparing the report…",
      }),
    );
    if (result === null) return handleExport("pdf");
    if (!result.ok) exportFailed(result.error);
  };

  // Fetch available assignees for quick assignment
  const fetchAssignees = useCallback(async () => {
    try {
      const response = await fetch("/api/users?role=manager&limit=50");
      const result = await response.json();

      if (response.ok && result.users) {
        setAssigneeOptions(
          result.users.map((user: any) => ({
            id: user._id,
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
          }))
        );
      }
    } catch {
      toast.error(t("maintenance.emergency.list.toasts.assigneeError"));
    }
  }, [t]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchEmergencyRequests();
  };

  // Bulk action handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked && data?.requests) {
      setSelectedRequests(data.requests.map((req) => req._id));
    } else {
      setSelectedRequests([]);
    }
  };

  const handleSelectRequest = (requestId: string, checked: boolean) => {
    if (checked) {
      setSelectedRequests((prev) => [...prev, requestId]);
    } else {
      setSelectedRequests((prev) => prev.filter((id) => id !== requestId));
    }
  };

  const handleBulkAssign = async (assigneeId: string) => {
    if (selectedRequests.length === 0) return;

    setBulkActionLoading(true);
    try {
      const response = await fetch("/api/maintenance/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestIds: selectedRequests,
          assigneeId,
        }),
      });

      if (response.ok) {
        toast.success(
          t("maintenance.emergency.list.toasts.assignSuccess", {
            values: { count: selectedRequests.length },
          })
        );
        setSelectedRequests([]);
        fetchEmergencyRequests();
      } else {
        throw new Error("Failed to assign requests");
      }
    } catch {
      toast.error(t("maintenance.emergency.list.toasts.assignError"));
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkStatusUpdate = async (status: MaintenanceStatus) => {
    if (selectedRequests.length === 0) return;

    setBulkActionLoading(true);
    try {
      const response = await fetch("/api/maintenance/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestIds: selectedRequests,
          status,
        }),
      });

      if (response.ok) {
        toast.success(
          t("maintenance.emergency.list.toasts.updateSuccess", {
            values: { count: selectedRequests.length },
          })
        );
        setSelectedRequests([]);
        fetchEmergencyRequests();
      } else {
        throw new Error("Failed to update requests");
      }
    } catch {
      toast.error(t("maintenance.emergency.list.toasts.updateError"));
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleEscalate = async (requestId: string, notes?: string) => {
    try {
      const response = await fetch(`/api/maintenance/emergency/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          notes,
        }),
      });

      if (response.ok) {
        toast.success(t("maintenance.emergency.list.toasts.escalateSuccess"));
        fetchEmergencyRequests();
      } else {
        throw new Error("Failed to escalate request");
      }
    } catch {
      toast.error(t("maintenance.emergency.list.toasts.escalateError"));
    }
  };

  const handleQuickContact = async (
    requestId: string,
    method: "phone" | "email"
  ) => {
    const request = data?.requests.find((r) => r._id === requestId);
    if (!request) return;

    if (method === "phone" && request.tenant.phone) {
      window.open(`tel:${request.tenant.phone}`);
    } else if (method === "email" && request.tenant.email) {
      window.open(
        `mailto:${request.tenant.email}?subject=Emergency Maintenance Request - ${request.title}`
      );
    }

    // Log the contact attempt
    try {
      await fetch(`/api/maintenance/${requestId}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          contactedAt: new Date().toISOString(),
        }),
      });
    } catch {
      toast.warning(t("maintenance.emergency.list.toasts.contactWarning"));
    }
  };

  // DISABLED: Delete functionality temporarily disabled
  // const handleDeleteRequest = useCallback(
  //   async (requestId: string) => {
  //     if (!requestId) {
  //       return;
  //     }

  //     try {
  //       const response = await fetch(`/api/maintenance/${requestId}`, {
  //         method: "DELETE",
  //       });

  //       const isJson = response.headers
  //         .get("content-type")
  //         ?.includes("application/json");
  //       const payload = isJson ? await response.json() : null;

  //       if (!response.ok) {
  //         throw new Error(
  //           payload?.error || "Failed to delete emergency request"
  //         );
  //       }

  //       toast.success("Emergency request deleted");
  //       setRefreshing(true);
  //       setSelectedRequests((prev) =>
  //         prev.filter((selectedId) => selectedId !== requestId)
  //       );
  //       await fetchEmergencyRequests();
  //     } catch (err) {
  //       toast.error(
  //         err instanceof Error
  //           ? err.message
  //           : "Failed to delete emergency request"
  //       );
  //     }
  //   },
  //   [fetchEmergencyRequests]
  // );

  const getUrgencyBadge = (urgencyLevel: string, isOverdue: boolean) => {
    if (urgencyLevel === "critical") {
      return (
        <Badge variant="destructive" className="animate-pulse">
          <AlertTriangle className="w-3 h-3 me-1" />
          {t("maintenance.emergency.list.badges.critical", { defaultValue: "Critical" })}
        </Badge>
      );
    }
    if (urgencyLevel === "overdue" || isOverdue) {
      return (
        <Badge variant="destructive">
          <Clock className="w-3 h-3 me-1" />
          {t("maintenance.emergency.list.badges.overdue", { defaultValue: "Overdue" })}
        </Badge>
      );
    }
    if (urgencyLevel === "completed") {
      return (
        <Badge variant="default" className="bg-green-100 text-green-800">
          <CheckCircle className="w-3 h-3 me-1" />
          {t("maintenance.emergency.list.badges.completed", { defaultValue: "Completed" })}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <Timer className="w-3 h-3 me-1" />
        {t("maintenance.emergency.list.badges.normal", { defaultValue: "Normal" })}
      </Badge>
    );
  };

  const getStatusBadge = (status: MaintenanceStatus) => {
    const statusConfig = {
      [MaintenanceStatus.SUBMITTED]: {
        variant: "secondary" as const,
        icon: AlertCircle,
      },
      [MaintenanceStatus.ASSIGNED]: { variant: "default" as const, icon: User },
      [MaintenanceStatus.IN_PROGRESS]: {
        variant: "default" as const,
        icon: RefreshCw,
      },
      [MaintenanceStatus.COMPLETED]: {
        variant: "default" as const,
        icon: CheckCircle,
      },
      [MaintenanceStatus.CANCELLED]: {
        variant: "destructive" as const,
        icon: XCircle,
      },
    };

    const config = statusConfig[status];
    const Icon = config.icon;

    return (
      <Badge variant={config.variant}>
        <Icon className="w-3 h-3 me-1" />
        {maintenanceStatusText(status, (key, english) =>
          t(key, { defaultValue: english }),
        )}
      </Badge>
    );
  };

  // Define columns for DataTable
  const emergencyColumns: DataTableColumn<EmergencyRequest>[] = [
    {
      id: "number",
      header: t("maintenance.emergency.list.table.number"),
      cell: (_request, index) => (
        <span className="font-medium text-muted-foreground">
          {(index || 0) + 1}
        </span>
      ),
    },
    {
      id: "request",
      sortKey: "title",
      header: t("maintenance.emergency.list.table.request"),
      cell: (request) => {
        const getUrgencyColor = () => {
          if (
            request.urgencyLevel === "critical" ||
            (request.isOverdue && request.hoursSinceCreation > 4)
          ) {
            return "text-red-600 font-bold";
          }
          if (request.urgencyLevel === "overdue" || request.isOverdue) {
            return "text-orange-600";
          }
          return "text-gray-600";
        };
        return (
          <div className="space-y-1">
            <div className={`font-medium ${getUrgencyColor()}`}>
              <Link
                href={`/dashboard/maintenance/${request._id}`}
                className="hover:underline"
              >
                {request.title}
              </Link>
            </div>
            <div className="text-sm text-muted-foreground">
              ID: {request._id.slice(-8)}
            </div>
          </div>
        );
      },
    },
    {
      id: "status",
      sortKey: "status",
      header: t("maintenance.emergency.list.table.status"),
      cell: (request) => (
        <div className="flex flex-col gap-1">
          <div>{getUrgencyBadge(request.urgencyLevel, request.isOverdue)}</div>
          <div>{getStatusBadge(request.status)}</div>
        </div>
      ),
    },
    {
      id: "property",
      sortKey: "property.name",
      header: t("maintenance.emergency.list.table.property"),
      visibility: "lg" as const,
      cell: (request) => {
        const address = formatAddress(request.property.address);
        const words = address.split(" ");
        const truncatedAddress =
          words.length > 3 ? words.slice(0, 3).join(" ") + "..." : address;
        return (
          <Link
            href={`/dashboard/properties/${request.property._id}`}
            className="group inline-flex flex-col space-y-1 max-w-[180px] text-foreground transition-colors"
          >
            <div className="font-medium truncate transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {request.property.name}
            </div>
            <div
              className="text-sm text-muted-foreground truncate"
              title={address}
            >
              {truncatedAddress}
            </div>
          </Link>
        );
      },
    },
    {
      id: "tenant",
      sortKey: "tenant.firstName",
      header: t("maintenance.emergency.list.table.tenant"),
      visibility: "md" as const,
      cell: (request) => (
        <Link
          href={`/dashboard/tenants/${request.tenant._id}`}
          className="group flex items-center space-x-3 text-foreground transition-colors"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage
              src={request.tenant?.avatar}
              alt={`${request.tenant?.firstName || ""} ${
                request.tenant?.lastName || ""
              }`}
            />
            <AvatarFallback>
              {request.tenant?.firstName?.[0] || "T"}
              {request.tenant?.lastName?.[0] || ""}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {request.tenant?.firstName || ""} {request.tenant?.lastName || ""}
            </div>
            <div className="text-sm text-muted-foreground">
              {request.tenant?.phone || ""}
            </div>
          </div>
        </Link>
      ),
    },
    {
      id: "assignedTo",
      sortKey: "assignedUser.firstName",
      header: t("maintenance.emergency.list.table.assignedTo"),
      visibility: "lg" as const,
      cell: (request) =>
        request.assignedUser ? (
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-green-600" />
            <span className="text-sm">
              {request.assignedUser.firstName} {request.assignedUser.lastName}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-orange-500" />
            <span className="text-sm text-orange-600">{t("maintenance.emergency.unassigned", { defaultValue: "Unassigned" })}</span>
          </div>
        ),
    },
    {
      id: "created",
      sortKey: "createdAt",
      header: t("maintenance.emergency.list.table.created"),
      visibility: "xl" as const,
      cell: (request) => (
        <div className="text-sm">
          {timeAgo(request.createdAt)}
        </div>
      ),
    },
    {
      id: "elapsed",
      sortKey: "hoursSinceCreation",
      header: t("maintenance.emergency.list.table.elapsed"),
      visibility: "xl" as const,
      cell: (request) => (
        <div className="text-sm font-medium">
          {t("maintenance.emergency.list.table.elapsedHours", {
            defaultValue: "{hours}h",
            values: { hours: Math.round(request.hoursSinceCreation) },
          })}
        </div>
      ),
    },
    {
      id: "actions",
      header: t("maintenance.emergency.list.table.actions"),
      align: "right" as const,
      cell: (request) => (
        <MaintenanceStatusManager
          request={request as any}
          onRequestUpdate={fetchEmergencyRequests}
          availableStaff={assigneeOptions.map((a) => {
            const parts = (a.name || "").split(" ");
            const first = parts[0] || a.name;
            const last = parts.slice(1).join(" ");
            return {
              _id: a.id,
              firstName: first,
              lastName: last,
              email: a.email,
            };
          })}
        />
      ),
    },
  ];

  // Computed values
  const criticalRequests = useMemo(() => {
    return (
      data?.requests.filter(
        (req) =>
          req.urgencyLevel === "critical" ||
          (req.isOverdue && req.hoursSinceCreation > 4)
      ) || []
    );
  }, [data?.requests]);

  const unassignedRequests = useMemo(() => {
    return data?.requests.filter((req) => !req.assignedUser) || [];
  }, [data?.requests]);

  const requests = data?.requests ?? [];
  const totalItems = data?.pagination?.total ?? 0;
  const totalPages = data?.pagination?.pages ?? 1;
  const visibleRequests = requests;

  const isAllSelected = useMemo(() => {
    return (
      requests.length > 0 && selectedRequests.length === requests.length
    );
  }, [selectedRequests.length, requests.length]);

  const isSomeSelected = useMemo(() => {
    return (
      selectedRequests.length > 0 &&
      selectedRequests.length < requests.length
    );
  }, [selectedRequests.length, requests.length]);

  useEffect(() => {
    fetchEmergencyRequests();
    fetchAssignees();
  }, [fetchEmergencyRequests, fetchAssignees]);

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
    responseTimeFilter,
    propertyFilter,
    assignedFilter,
    sortBy,
    sortOrder,
  ]);

  const handlePageChange = (page: number) => setCurrentPage(page);
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  // Enhanced auto-refresh with configurable interval
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      if (!loading && !refreshing && !bulkActionLoading) {
        fetchEmergencyRequests();
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [
    fetchEmergencyRequests,
    loading,
    refreshing,
    bulkActionLoading,
    autoRefresh,
  ]);

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchTerm) params.set("search", searchTerm);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (responseTimeFilter !== "all")
      params.set("responseTime", responseTimeFilter);
    if (propertyFilter) params.set("propertyId", propertyFilter);
    if (assignedFilter !== "all") params.set("assignedTo", assignedFilter);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", newUrl);
  }, [
    searchTerm,
    statusFilter,
    responseTimeFilter,
    propertyFilter,
    assignedFilter,
  ]);

  // Show bulk actions when requests are selected
  useEffect(() => {
    setShowBulkActions(selectedRequests.length > 0);
  }, [selectedRequests.length]);

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("maintenance.emergency.pageTitle", { defaultValue: "Emergencies" })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("maintenance.emergency.pageSubtitle", { defaultValue: "Maintenance that needs attention now" })}
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
            <AlertTriangle className="h-12 w-12 text-red-500" />
            <h2 className="text-xl font-semibold">
              {t("maintenance.emergency.loadFailed", { defaultValue: "Could not load the emergencies" })}
            </h2>
            <p className="text-muted-foreground text-center">{error}</p>
            <Button onClick={handleRefresh}>
              <RefreshCw className="me-2 h-4 w-4" />
              {t("maintenance.emergency.retry", { defaultValue: "Try again" })}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Enhanced Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">{t("maintenance.emergency.list.header.title")}
            {criticalRequests.length > 0 && (
              <Badge variant="destructive" className="animate-pulse">
                {criticalRequests.length}{" "}
                {t("maintenance.emergency.list.header.critical")}
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("maintenance.emergency.list.header.subtitle")}
            {unassignedRequests.length > 0 && (
              <span className="text-orange-600 font-medium ms-2">
                • {unassignedRequests.length}{" "}
                {t("maintenance.emergency.list.header.unassigned")}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 me-4">
            <label className="text-sm font-medium">
              {t("maintenance.emergency.list.header.autoRefresh")}
            </label>
            <Checkbox checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`me-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {t("maintenance.emergency.list.header.refresh")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="me-2 h-4 w-4" />
                {t("maintenance.emergency.list.header.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => void handlePrint()}>
                <FileText className="me-2 h-4 w-4" />
                {t("maintenance.emergency.list.export.printReport")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExport("xlsx")}>
                <Download className="me-2 h-4 w-4" />
                {t("reports.export.xlsx", { defaultValue: "Excel (.xlsx)" })}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExport("csv")}>
                <Download className="me-2 h-4 w-4" />
                {t("maintenance.emergency.list.export.exportCsv")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExport("pdf")}>
                <Download className="me-2 h-4 w-4" />
                {t("maintenance.emergency.list.export.exportPdf")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link href="/dashboard/maintenance/new?priority=emergency">
            <Button size="sm" className="bg-red-600 hover:bg-red-700">
              <Plus className="h-4 w-4" />
              {t("maintenance.emergency.list.header.newEmergency")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Enhanced Statistics Cards */}
      <AnalyticsCardGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <AnalyticsCard
          title={t("maintenance.emergency.list.stats.totalEmergencies")}
          value={data?.statistics?.total ?? 0}
          description={`${t("maintenance.emergency.list.stats.allTime")} • ${data?.statistics?.todayCreated || 0} ${t("maintenance.emergency.list.stats.today")}`}
          icon={AlertTriangle}
          iconColor="error"
        />

        <AnalyticsCard
          title={t("maintenance.emergency.list.stats.active")}
          value={data?.statistics?.active ?? 0}
          description={t("maintenance.emergency.list.stats.needsAttention")}
          icon={Clock}
          iconColor="warning"
        />

        <AnalyticsCard
          title={t("maintenance.emergency.list.stats.critical")}
          value={data?.statistics?.critical || criticalRequests.length}
          description={t("maintenance.emergency.list.stats.hoursOld")}
          icon={Zap}
          iconColor="error"
        />

        <AnalyticsCard
          title={t("maintenance.emergency.list.stats.unassigned")}
          value={data?.statistics?.unassigned || unassignedRequests.length}
          description={t("maintenance.emergency.list.stats.needAssignment")}
          icon={UserPlus}
          iconColor="warning"
        />
      </AnalyticsCardGrid>

      {/* Bulk Actions Bar */}
      {showBulkActions && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium">
                  {t("maintenance.emergency.selected", { defaultValue: "{count} selected", values: { count: selectedRequests.length } })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedRequests([])}
                >
                  {t("maintenance.emergency.clearSelection", { defaultValue: "Clear selection" })}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" disabled={bulkActionLoading}>
                      <UserPlus className="me-2 h-4 w-4" />
                      {t("maintenance.emergency.assignTo", { defaultValue: "Assign to" })}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {assigneeOptions.map((assignee) => (
                      <DropdownMenuItem
                        key={assignee.id}
                        onClick={() => handleBulkAssign(assignee.id)}
                      >
                        {assignee.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkActionLoading}
                    >
                      <Settings className="me-2 h-4 w-4" />
                      {t("maintenance.emergency.updateStatus", { defaultValue: "Change status" })}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onClick={() =>
                        handleBulkStatusUpdate(MaintenanceStatus.ASSIGNED)
                      }
                    >
                      {t("maintenance.emergency.markAssigned", { defaultValue: "Mark as assigned" })}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        handleBulkStatusUpdate(MaintenanceStatus.IN_PROGRESS)
                      }
                    >
                      {t("maintenance.emergency.markInProgress", { defaultValue: "Mark as in progress" })}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        handleBulkStatusUpdate(MaintenanceStatus.COMPLETED)
                      }
                    >
                      {t("maintenance.emergency.markCompleted", { defaultValue: "Mark as completed" })}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Emergency Requests with Integrated Filters */}
      <Card className="gap-2">
        <CardHeader>
          {/* Main Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 dark:bg-red-900/30 rounded-lg border border-red-100 dark:border-red-800">
                <Zap className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("maintenance.emergency.list.table.title")} (
                  {totalItems || 0})
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("maintenance.emergency.list.table.subtitle")}
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
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "cards" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("cards")}
                className="h-8 flex-1 sm:flex-none sm:px-3"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Integrated Filters Bar - Single Row */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <Input
                placeholder={t(
                  "maintenance.emergency.list.filters.searchPlaceholder"
                )}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10 h-10 border-gray-200 dark:border-gray-700 focus:border-red-400 dark:focus:border-red-500 focus:ring-1 focus:ring-red-400 dark:focus:ring-red-500 bg-white dark:bg-gray-800"
              />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 w-[130px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t(
                      "maintenance.emergency.list.filters.allStatuses"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("maintenance.emergency.list.filters.allStatuses")}
                  </SelectItem>
                  <SelectItem value="active">
                    {t("maintenance.emergency.list.filters.activeStatus")}
                  </SelectItem>
                  <SelectItem value="submitted">
                    {t("maintenance.emergency.list.filters.submitted")}
                  </SelectItem>
                  <SelectItem value="assigned">
                    {t("maintenance.emergency.list.filters.assigned")}
                  </SelectItem>
                  <SelectItem value="in_progress">
                    {t("maintenance.emergency.list.filters.inProgress")}
                  </SelectItem>
                  <SelectItem value="completed">
                    {t("maintenance.emergency.list.filters.completed")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={responseTimeFilter}
                onValueChange={setResponseTimeFilter}
              >
                <SelectTrigger className="h-10 w-[130px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("maintenance.emergency.list.filters.allTimes")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("maintenance.emergency.list.filters.allTimes")}
                  </SelectItem>
                  <SelectItem value="normal">
                    {t("maintenance.emergency.list.filters.normal")}
                  </SelectItem>
                  <SelectItem value="overdue">
                    {t("maintenance.emergency.list.filters.overdue")}
                  </SelectItem>
                  <SelectItem value="critical">
                    {t("maintenance.emergency.list.filters.critical")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={assignedFilter} onValueChange={setAssignedFilter}>
                <SelectTrigger className="h-10 w-[140px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t(
                      "maintenance.emergency.list.filters.allAssignments"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("maintenance.emergency.list.filters.allAssignments")}
                  </SelectItem>
                  <SelectItem value="unassigned">
                    {t("maintenance.emergency.list.filters.unassigned")}
                  </SelectItem>
                  <SelectItem value="assigned">
                    {t("maintenance.emergency.list.filters.assignedFilter")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={SORT_MENU_VALUES.includes(sortBy) ? sortBy : ""}
                onValueChange={setSortBy}
              >
                <SelectTrigger className="h-10 w-[130px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("maintenance.emergency.list.filters.sortBy")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt">
                    {t("maintenance.emergency.list.filters.createdDate")}
                  </SelectItem>
                  <SelectItem value="hoursSinceCreation">
                    {t("maintenance.emergency.list.filters.responseTimeSort")}
                  </SelectItem>
                  <SelectItem value="priority">
                    {t("maintenance.emergency.list.filters.priority")}
                  </SelectItem>
                  <SelectItem value="status">
                    {t("maintenance.emergency.list.filters.statusSort")}
                  </SelectItem>
                  <SelectItem value="property.name">
                    {t("maintenance.emergency.list.filters.property")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Clear Button - only show when filters are active */}
              {(searchTerm ||
                statusFilter !== "all" ||
                responseTimeFilter !== "all" ||
                assignedFilter !== "all" ||
                sortBy !== "createdAt" ||
                sortOrder !== "desc") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter("all");
                    setResponseTimeFilter("all");
                    setPropertyFilter("");
                    setAssignedFilter("all");
                    setSortBy("createdAt");
                    setSortOrder("desc");
                  }}
                  className="h-10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  <XCircle className="h-4 w-4 me-2" />
                  {t("maintenance.emergency.list.filters.clearAll")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {viewMode === "cards" ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <Card key={i} className="overflow-hidden">
                    <Skeleton className="h-24 w-full" />
                    <CardContent className="p-4 space-y-3">
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-4 w-56" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <div className="flex items-center gap-4">
                        <Skeleton className="h-4 w-12" />
                        <Skeleton className="h-4 w-12" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <Skeleton className="h-6 w-24" />
                        <Skeleton className="h-8 w-8" />
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : visibleRequests.length > 0 ? (
                visibleRequests.map((request) => (
                  <EmergencyCard
                    key={request._id}
                    request={request}
                    onEdit={(id) =>
                      window.open(`/dashboard/maintenance/${id}/edit`, "_blank")
                    }
                    // onDelete={handleDeleteRequest}
                  />
                ))
              ) : (
                <div className="col-span-full text-center py-8">
                  <div className="flex flex-col items-center space-y-4">
                    <CheckCircle className="h-12 w-12 text-green-500" />
                    <h2 className="text-xl font-semibold">
                      {t("maintenance.emergency.list.table.noRequests")}
                    </h2>
                    <p className="text-muted-foreground text-center">
                      {t("maintenance.emergency.list.table.noRequestsDesc")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <DataTable<EmergencyRequest>
              columns={emergencyColumns}
              data={visibleRequests || []}
              getRowKey={(request) => request._id}
              loading={loading}
              // The headers and the sort menu are one order, which the API
              // applies before it pages (the effect above returns to page
              // one). The list always has an order — newest first unless
              // chosen — so a click on the sorted column turns it round.
              sort={{
                key: sortBy,
                direction: sortOrder,
                onSortChange: (key, direction) => {
                  const next = keepSorted({ key: sortBy, direction: sortOrder }, { key, direction });
                  setSortBy(next.key);
                  setSortOrder(next.direction);
                },
              }}
              selection={{
                enabled: true,
                selectedIds: selectedRequests,
                onSelectRow: (id: string, checked: boolean) =>
                  handleSelectRequest(id, checked),
                onSelectAll: (checked: boolean) => handleSelectAll(checked),
                getRowId: (request: EmergencyRequest) => request._id,
              }}
              emptyState={{
                icon: <CheckCircle className="h-12 w-12 text-green-500" />,
                title: t("maintenance.emergency.list.table.noRequests"),
                description: t(
                  "maintenance.emergency.list.table.noRequestsDesc"
                ),
              }}
              striped
            />
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

      {/* Quick Assign Dialog */}
      <Dialog open={quickAssignDialog} onOpenChange={setQuickAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("maintenance.emergency.list.dialogs.quickAssign.title")}
            </DialogTitle>
            <DialogDescription>
              {t("maintenance.emergency.list.dialogs.quickAssign.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t(
                  "maintenance.emergency.list.dialogs.quickAssign.selectTechnician"
                )}
              </label>
              <Select>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      "maintenance.emergency.list.dialogs.quickAssign.selectPlaceholder"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {assigneeOptions.map((assignee) => (
                    <SelectItem key={assignee.id} value={assignee.id}>
                      {assignee.name} - {assignee.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("maintenance.emergency.list.dialogs.quickAssign.notes")}
              </label>
              <Textarea
                placeholder={t(
                  "maintenance.emergency.list.dialogs.quickAssign.notesPlaceholder"
                )}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setQuickAssignDialog(false)}
            >
              {t("maintenance.emergency.list.dialogs.quickAssign.cancel")}
            </Button>
            <Button onClick={() => setQuickAssignDialog(false)}>
              {t("maintenance.emergency.list.dialogs.quickAssign.assign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Escalate Dialog */}
      <Dialog open={escalateDialog} onOpenChange={setEscalateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("maintenance.emergency.list.dialogs.escalate.title")}
            </DialogTitle>
            <DialogDescription>
              {t("maintenance.emergency.list.dialogs.escalate.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                <span className="font-medium text-yellow-800">
                  {t("maintenance.emergency.escalateWarning", { defaultValue: "Escalation" })}
                </span>
              </div>
              <p className="text-sm text-yellow-700 mt-1">
                {t("maintenance.emergency.escalateHint", { defaultValue: "Management is notified and the request's priority goes up." })}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("maintenance.emergency.list.dialogs.escalate.reason")}
              </label>
              <Textarea
                placeholder={t(
                  "maintenance.emergency.list.dialogs.escalate.reasonPlaceholder"
                )}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEscalateDialog(false)}>
              {t("maintenance.emergency.list.dialogs.escalate.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedRequestForAction) {
                  handleEscalate(selectedRequestForAction);
                }
                setEscalateDialog(false);
              }}
            >
              <AlertTriangle className="me-2 h-4 w-4" />
              {t("maintenance.emergency.list.dialogs.escalate.escalate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
