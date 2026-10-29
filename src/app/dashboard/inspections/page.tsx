"use client";

import Link from "next/link";
import { ReportExportButton } from "@/components/reports/export-button";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  ClipboardCheck,
  Plus,
  Search,
  Calendar,
  CheckCircle,
  Clock,
  Eye,
  X,
  Grid3X3,
  List,
  AlertCircle,
  Play,
  Ban,
} from "lucide-react";
import { InspectionType } from "@/types";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface InspectionWithPopulated {
  _id: string;
  type: string;
  status: string;
  scheduledDate: string;
  completedDate?: string;
  overallCondition?: string;
  notes?: string;
  items: Array<{
    room: string;
    item: string;
    condition: string;
    notes?: string;
    requiresAttention: boolean;
  }>;
  photos: string[];
  createdAt: string;
  updatedAt: string;
  property: {
    _id: string;
    name: string;
    address: {
      street: string;
      city: string;
      state: string;
    };
  };
  tenant?: {
    user: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
  };
  inspector: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export default function InspectionsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { isCompanyStaff } = useAuthorization();
  const { t, formatDate: formatLocalizedDate } = useLocalizationContext();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL_STATUSES");
  const [typeFilter, setTypeFilter] = useState<string>("ALL_TYPES");
  const [conditionFilter, setConditionFilter] =
    useState<string>("ALL_CONDITIONS");
  const viewMode = useViewPreferencesStore((state) => state.inspectionsView);
  const setViewMode = useViewPreferencesStore(
    (state) => state.setInspectionsView,
  );
  const [inspections, setInspections] = useState<InspectionWithPopulated[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  // Redirect non-admin/manager users
  useEffect(() => {
    if (session && !isCompanyStaff) {
      toast.info(t("inspections.toasts.accessDenied"));
      router.push("/dashboard");
    }
  }, [session, isCompanyStaff, router, t]);

  useEffect(() => {
    if (session && isCompanyStaff) {
      fetchInspections();
    }
  }, [session, isCompanyStaff]);

  const fetchInspections = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/inspections?limit=100");
      if (!response.ok) {
        throw new Error(t("inspections.toasts.failedToFetch"));
      }

      const data = await response.json();
      setInspections(data?.data ?? []);
    } catch (error: any) {
      const errorMessage = error.message || t("inspections.toasts.failedToLoad");
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled":
        return "default";
      case "in_progress":
        return "secondary";
      case "completed":
        return "secondary";
      case "cancelled":
        return "outline";
      default:
        return "outline";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "scheduled":
        return Clock;
      case "in_progress":
        return Play;
      case "completed":
        return CheckCircle;
      case "cancelled":
        return Ban;
      default:
        return Clock;
    }
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case "excellent":
        return "secondary";
      case "good":
        return "default";
      case "fair":
        return "secondary";
      case "poor":
        return "destructive";
      default:
        return "outline";
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case InspectionType.MOVE_IN:
        return t("inspections.types.moveIn");
      case InspectionType.MOVE_OUT:
        return t("inspections.types.moveOut");
      case InspectionType.ROUTINE:
        return t("inspections.types.routine");
      case InspectionType.MAINTENANCE:
        return t("inspections.types.maintenance");
      default:
        return type;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "scheduled":
        return t("inspections.status.scheduled");
      case "in_progress":
        return t("inspections.status.inProgress");
      case "completed":
        return t("inspections.status.completed");
      case "cancelled":
        return t("inspections.status.cancelled");
      default:
        return status || t("inspections.labels.naLower");
    }
  };

  const getConditionLabel = (condition: string) => {
    switch (condition) {
      case "excellent":
        return t("inspections.conditions.excellent");
      case "good":
        return t("inspections.conditions.good");
      case "fair":
        return t("inspections.conditions.fair");
      case "poor":
        return t("inspections.conditions.poor");
      default:
        return condition || t("inspections.labels.na");
    }
  };

  const formatDate = (date: string | undefined) => {
    if (!date) return t("inspections.labels.na");
    try {
      return formatLocalizedDate(date, { format: "medium" });
    } catch {
      return t("inspections.labels.na");
    }
  };

  // Filter and sort
  const filteredInspections = inspections
    .filter((inspection) => {
      const matchesSearch =
        (inspection?.property?.name?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        ) ||
        (inspection?.inspector?.firstName?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        ) ||
        (inspection?.inspector?.lastName?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        ) ||
        (inspection?.tenant?.user?.firstName?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        ) ||
        (inspection?.tenant?.user?.lastName?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        ) ||
        (inspection?.notes?.toLowerCase() || "").includes(
          searchTerm.toLowerCase(),
        );

      const matchesStatus =
        statusFilter === "ALL_STATUSES" || inspection?.status === statusFilter;
      const matchesType =
        typeFilter === "ALL_TYPES" || inspection?.type === typeFilter;
      const matchesCondition =
        conditionFilter === "ALL_CONDITIONS" ||
        inspection?.overallCondition === conditionFilter;

      return matchesSearch && matchesStatus && matchesType && matchesCondition;
    })
    .sort(
      (a, b) =>
        new Date(b?.scheduledDate ?? "").getTime() -
        new Date(a?.scheduledDate ?? "").getTime(),
    );

  // Pagination
  const totalItems = filteredInspections.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const visibleInspections = filteredInspections.slice(
    startIndex,
    startIndex + pageSize,
  );

  const hasActiveFilters =
    Boolean(searchTerm) ||
    statusFilter !== "ALL_STATUSES" ||
    typeFilter !== "ALL_TYPES" ||
    conditionFilter !== "ALL_CONDITIONS";

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalItems, pageSize, currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, typeFilter, conditionFilter]);

  const handlePageChange = (page: number) => setCurrentPage(page);
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  // Stats
  const stats = {
    scheduled: inspections.filter((i) => i?.status === "scheduled").length,
    inProgress: inspections.filter((i) => i?.status === "in_progress").length,
    completed: inspections.filter((i) => i?.status === "completed").length,
    itemsNeedingAttention: inspections.reduce(
      (acc, i) =>
        acc + (i?.items?.filter((item) => item?.requiresAttention).length ?? 0),
      0,
    ),
  };

  // DataTable columns
  const inspectionColumns: DataTableColumn<InspectionWithPopulated>[] = [
    {
      id: "type",
      header: t("inspections.table.headers.type"),
      cell: (inspection) => (
        <Badge variant="outline" className="capitalize text-xs">
          {getTypeLabel(inspection?.type ?? "")}
        </Badge>
      ),
    },
    {
      id: "property",
      header: t("inspections.table.headers.property"),
      cell: (inspection) => (
        <Link
          href={`/dashboard/properties/${inspection?.property?._id}`}
          className="group inline-flex flex-col text-foreground transition-colors"
        >
          <div className="font-medium text-sm truncate transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {inspection?.property?.name || t("inspections.labels.na")}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {inspection?.property?.address?.city || t("inspections.labels.na")},{" "}
            {inspection?.property?.address?.state || ""}
          </div>
        </Link>
      ),
    },
    {
      id: "tenant",
      header: t("inspections.table.headers.tenant"),
      visibility: "lg" as const,
      cell: (inspection) =>
        inspection?.tenant ? (
          <Link
            href={`/dashboard/tenants/${inspection.tenant.user._id}`}
            className="group inline-flex text-sm truncate text-foreground transition-colors"
          >
            <span className="transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {inspection.tenant.user.firstName} {inspection.tenant.user.lastName}
            </span>
          </Link>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        ),
    },
    {
      id: "inspector",
      header: t("inspections.table.headers.inspector"),
      visibility: "lg" as const,
      cell: (inspection) => (
        <div className="text-sm truncate">
          {inspection?.inspector?.firstName || t("inspections.labels.na")}{" "}
          {inspection?.inspector?.lastName || ""}
        </div>
      ),
    },
    {
      id: "scheduledDate",
      header: t("inspections.table.headers.scheduled"),
      cell: (inspection) => (
        <div className="flex items-center gap-1 text-xs">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          <span>{formatDate(inspection?.scheduledDate)}</span>
        </div>
      ),
    },
    {
      id: "status",
      header: t("inspections.table.headers.status"),
      cell: (inspection) => {
        const StatusIcon = getStatusIcon(inspection?.status ?? "");
        return (
          <Badge
            variant={getStatusColor(inspection?.status ?? "") as any}
            className="flex items-center gap-1 w-fit text-xs capitalize"
          >
            <StatusIcon className="h-3 w-3" />
            <span>{getStatusLabel(inspection?.status ?? "")}</span>
          </Badge>
        );
      },
    },
    {
      id: "condition",
      header: t("inspections.table.headers.condition"),
      visibility: "xl" as const,
      cell: (inspection) =>
        inspection.overallCondition ? (
          <Badge
            variant={getConditionColor(inspection.overallCondition) as any}
            className="capitalize text-xs"
          >
            {getConditionLabel(inspection.overallCondition)}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        ),
    },
    {
      id: "items",
      header: t("inspections.table.headers.items"),
      visibility: "xl" as const,
      cell: (inspection) => {
        const attentionCount = (inspection?.items ?? []).filter(
          (i) => i.requiresAttention,
        ).length;
        return (
          <div className="text-sm">
            <span>{inspection?.items?.length ?? 0}</span>
            {attentionCount > 0 && (
              <span className="text-red-600 ms-1">
                ({t("inspections.labels.issueCount", { values: { count: attentionCount } })})
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: t("inspections.table.headers.actions"),
      align: "right" as const,
      cell: (inspection) => (
        <Link href={`/dashboard/inspections/${inspection._id}`}>
          <Button variant="ghost" size="sm">
            <Eye className="h-4 w-4" />
          </Button>
        </Link>
      ),
    },
  ];

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("inspections.header.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("inspections.errorHeader.subtitle")}
            </p>
          </div>
          <Link href="/dashboard/inspections/new">
            <Button>
              <Plus className="me-2 h-4 w-4" />
              {t("inspections.actions.scheduleInspection")}
            </Button>
          </Link>
        </div>
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">
            {t("inspections.error.failedToLoadTitle")}
          </h2>
          <p className="text-muted-foreground text-center">{error}</p>
          <Button onClick={fetchInspections}>{t("inspections.actions.tryAgain")}</Button>
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
            {t("inspections.header.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("inspections.header.subtitle")}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {/* The file carries the list as filtered — search, status, type and
              condition — see the export branch in /api/inspections. */}
          <ReportExportButton
            endpoint="/api/inspections"
            params={(() => {
              const params = new URLSearchParams();
              if (searchTerm) params.set("search", searchTerm);
              if (statusFilter !== "ALL_STATUSES")
                params.set("status", statusFilter);
              if (typeFilter !== "ALL_TYPES") params.set("type", typeFilter);
              if (conditionFilter !== "ALL_CONDITIONS")
                params.set("overallCondition", conditionFilter);
              return params;
            })()}
            disabled={loading}
          />
          <Link href="/dashboard/inspections/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              {t("inspections.actions.scheduleInspection")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="gap-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("inspections.stats.scheduled.title")}
            </CardTitle>
            <Clock className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {stats.scheduled}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("inspections.stats.scheduled.description")}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("inspections.stats.inProgress.title")}
            </CardTitle>
            <Play className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {stats.inProgress}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("inspections.stats.inProgress.description")}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("inspections.stats.completed.title")}
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {stats.completed}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("inspections.stats.completed.description")}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-0">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("inspections.stats.needsAttention.title")}
            </CardTitle>
            <AlertCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {stats.itemsNeedingAttention}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("inspections.stats.needsAttention.description")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Inspections List */}
      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <ClipboardCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("inspections.panel.title", {
                    values: { count: filteredInspections.length },
                  })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("inspections.panel.subtitle")}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
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

          {/* Filters */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <Input
                placeholder={t("inspections.filters.searchPlaceholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-10 h-10 border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500 bg-white dark:bg-gray-800"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 w-[140px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("inspections.filters.status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL_STATUSES">
                    {t("inspections.filters.options.allStatuses")}
                  </SelectItem>
                  <SelectItem value="scheduled">
                    {t("inspections.status.scheduled")}
                  </SelectItem>
                  <SelectItem value="in_progress">
                    {t("inspections.status.inProgress")}
                  </SelectItem>
                  <SelectItem value="completed">
                    {t("inspections.status.completed")}
                  </SelectItem>
                  <SelectItem value="cancelled">
                    {t("inspections.status.cancelled")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-10 w-[140px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("inspections.filters.type")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL_TYPES">
                    {t("inspections.filters.options.allTypes")}
                  </SelectItem>
                  <SelectItem value={InspectionType.MOVE_IN}>
                    {t("inspections.types.moveIn")}
                  </SelectItem>
                  <SelectItem value={InspectionType.MOVE_OUT}>
                    {t("inspections.types.moveOut")}
                  </SelectItem>
                  <SelectItem value={InspectionType.ROUTINE}>
                    {t("inspections.types.routine")}
                  </SelectItem>
                  <SelectItem value={InspectionType.MAINTENANCE}>
                    {t("inspections.types.maintenance")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={conditionFilter}
                onValueChange={setConditionFilter}
              >
                <SelectTrigger className="h-10 w-[140px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("inspections.filters.condition")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL_CONDITIONS">
                    {t("inspections.filters.options.allConditions")}
                  </SelectItem>
                  <SelectItem value="excellent">
                    {t("inspections.conditions.excellent")}
                  </SelectItem>
                  <SelectItem value="good">
                    {t("inspections.conditions.good")}
                  </SelectItem>
                  <SelectItem value="fair">
                    {t("inspections.conditions.fair")}
                  </SelectItem>
                  <SelectItem value="poor">
                    {t("inspections.conditions.poor")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter("ALL_STATUSES");
                    setTypeFilter("ALL_TYPES");
                    setConditionFilter("ALL_CONDITIONS");
                  }}
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("inspections.actions.clear")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {viewMode === "table" ? (
            <div className="hidden md:block max-w-full">
              <DataTable<InspectionWithPopulated>
                columns={inspectionColumns}
                data={visibleInspections}
                getRowKey={(inspection) => inspection._id}
                loading={loading}
                emptyState={{
                  icon: (
                    <ClipboardCheck className="h-12 w-12 text-muted-foreground" />
                  ),
                  title: t("inspections.empty.title"),
                  description: hasActiveFilters
                    ? t("inspections.empty.filteredDescription")
                    : t("inspections.empty.defaultDescription"),
                  action:
                    !searchTerm &&
                    statusFilter === "ALL_STATUSES" &&
                    typeFilter === "ALL_TYPES" &&
                    conditionFilter === "ALL_CONDITIONS" ? (
                      <Link href="/dashboard/inspections/new">
                        <Button>
                          <Plus className="me-2 h-4 w-4" />
                          {t("inspections.actions.scheduleInspection")}
                        </Button>
                      </Link>
                    ) : undefined,
                }}
                striped
              />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {visibleInspections.map((inspection) => {
                const StatusIcon = getStatusIcon(inspection?.status ?? "");
                const attentionCount = (inspection?.items ?? []).filter(
                  (i) => i.requiresAttention,
                ).length;

                return (
                  <Card
                    key={inspection._id}
                    className="hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() =>
                      router.push(`/dashboard/inspections/${inspection._id}`)
                    }
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1">
                          <CardTitle className="text-base">
                            {t("inspections.labels.typeInspection", {
                              values: {
                                type: getTypeLabel(inspection?.type ?? ""),
                              },
                            })}
                          </CardTitle>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {getTypeLabel(inspection.type)}
                            </Badge>
                            <Badge
                              variant={
                                getStatusColor(inspection?.status ?? "") as any
                              }
                              className="flex items-center gap-1 text-xs capitalize"
                            >
                              <StatusIcon className="h-3 w-3" />
                              {getStatusLabel(inspection?.status ?? "")}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="font-medium text-muted-foreground">
                            {t("inspections.table.headers.property")}
                          </div>
                          <div className="truncate">
                            {inspection?.property?.name || t("inspections.labels.na")}
                          </div>
                        </div>
                        <div>
                          <div className="font-medium text-muted-foreground">
                            {t("inspections.table.headers.inspector")}
                          </div>
                          <div className="truncate">
                            {inspection?.inspector?.firstName || t("inspections.labels.na")}{" "}
                            {inspection?.inspector?.lastName || ""}
                          </div>
                        </div>
                        {inspection.tenant && (
                          <div>
                            <div className="font-medium text-muted-foreground">
                              {t("inspections.table.headers.tenant")}
                            </div>
                            <div className="truncate">
                              {inspection.tenant.user.firstName}{" "}
                              {inspection.tenant.user.lastName}
                            </div>
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-muted-foreground">
                            {t("inspections.table.headers.items")}
                          </div>
                          <div>
                            {inspection?.items?.length ?? 0}
                            {attentionCount > 0 && (
                              <span className="text-red-600 ms-1">
                                ({t("inspections.labels.issueCount", {
                                  values: { count: attentionCount },
                                })})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {inspection.overallCondition && (
                        <Badge
                          variant={
                            getConditionColor(
                              inspection.overallCondition,
                            ) as any
                          }
                          className="capitalize text-xs"
                        >
                          {t("inspections.labels.conditionWithValue", {
                            values: {
                              condition: getConditionLabel(
                                inspection.overallCondition,
                              ),
                            },
                          })}
                        </Badge>
                      )}

                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(inspection?.scheduledDate)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Mobile card view when table mode is selected */}
          {viewMode === "table" && (
            <div className="md:hidden">
              <div className="space-y-4">
                {visibleInspections.map((inspection) => {
                  const StatusIcon = getStatusIcon(inspection?.status ?? "");
                  return (
                    <Card
                      key={inspection._id}
                      className="p-4 cursor-pointer"
                      onClick={() =>
                        router.push(`/dashboard/inspections/${inspection._id}`)
                      }
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1 flex-1">
                            <h3 className="font-medium">
                              {t("inspections.labels.typeInspection", {
                                values: {
                                  type: getTypeLabel(inspection?.type ?? ""),
                                },
                              })}
                            </h3>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  getStatusColor(
                                    inspection?.status ?? "",
                                  ) as any
                                }
                                className="flex items-center gap-1 text-xs capitalize"
                              >
                                <StatusIcon className="h-3 w-3" />
                                {getStatusLabel(inspection?.status ?? "")}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">
                              {t("inspections.table.headers.property")}:
                            </span>
                            <div className="truncate">
                              {inspection?.property?.name || t("inspections.labels.na")}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              {t("inspections.table.headers.scheduled")}:
                            </span>
                            <div>{formatDate(inspection?.scheduledDate)}</div>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {viewMode !== "table" &&
            filteredInspections.length === 0 &&
            !loading && (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <ClipboardCheck className="h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-semibold">
                  {t("inspections.empty.title")}
                </h3>
                <p className="text-muted-foreground text-center">
                  {hasActiveFilters
                    ? t("inspections.empty.filteredDescription")
                    : t("inspections.empty.cardsDefaultDescription")}
                </p>
                {!searchTerm &&
                  statusFilter === "ALL_STATUSES" &&
                  typeFilter === "ALL_TYPES" &&
                  conditionFilter === "ALL_CONDITIONS" && (
                    <Link href="/dashboard/inspections/new">
                      <Button>
                        <Plus className="me-2 h-4 w-4" />
                        {t("inspections.actions.scheduleInspection")}
                      </Button>
                    </Link>
                  )}
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
              showingLabel={t("common.showing")}
              previousLabel={t("common.previous")}
              nextLabel={t("common.next")}
              pageLabel={t("common.page")}
              ofLabel={t("common.of")}
              itemsPerPageLabel={t("common.perPage")}
              disabled={loading}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
