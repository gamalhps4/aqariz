"use client";

import { toast } from "sonner";
import { createPortal } from "react-dom";
import { useSession } from "@/lib/auth-client";
import { format } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarIcon,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Filter,
  List,
  MoreHorizontal,
  Search as SearchIcon,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";

import { useNotifications } from "@/hooks/useNotifications";
import { useDebounce } from "@/hooks/useDebounce";
import type {
  NotificationCategory,
  NotificationItem,
} from "@/types/notifications";
import { cn } from "@/lib/utils";
import { useAuthorization } from "@/hooks/useAuthorization";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { Calendar } from "@/components/ui/calendar";
import { GlobalPagination } from "@/components/ui/global-pagination";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DateRange } from "react-day-picker";
import { PushToggle } from "@/components/notifications/push-toggle";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { timeAgo } from "@/lib/utils/date-fns-locale";
import { formatDisplayDate } from "@/lib/utils/formatting";

type NotificationView = "all" | "unread" | "high";

function getCategory(type: string): Exclude<NotificationCategory, "all"> {
  if (type.startsWith("payment_")) {
    return "payments";
  }
  if (type.startsWith("lease_")) {
    return "leases";
  }
  if (type.startsWith("maintenance_")) {
    return "maintenance";
  }
  return "system";
}

function getPriorityVariant(priority: NotificationItem["priority"]) {
  switch (priority) {
    case "critical":
      return "destructive" as const;
    case "high":
      return "warning" as const;
    case "medium":
      return "info" as const;
    case "low":
      return "secondary" as const;
    default:
      return "default" as const;
  }
}

function getCategoryLabelKey(category: Exclude<NotificationCategory, "all">) {
  switch (category) {
    case "payments":
      return "dashboard.notifications.category.payments";
    case "leases":
      return "dashboard.notifications.category.leases";
    case "maintenance":
      return "dashboard.notifications.category.maintenance";
    default:
      return "dashboard.notifications.category.system";
  }
}

function formatTypeLabel(type: string) {
  return type
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function getNotificationStatusLabelKey(notification: NotificationItem) {
  return notification.read
    ? "dashboard.notifications.status.read"
    : "dashboard.notifications.status.unread";
}

function getPriorityLabelKey(priority: NotificationItem["priority"]) {
  switch (priority) {
    case "critical":
      return "dashboard.notifications.priority.critical";
    case "high":
      return "dashboard.notifications.priority.high";
    case "medium":
      return "dashboard.notifications.priority.medium";
    case "low":
      return "dashboard.notifications.priority.low";
    default:
      return "dashboard.notifications.priority.normal";
  }
}

function truncateWords(text: string, maxWords = 6): string {
  const normalizedText = text.trim();
  if (!normalizedText) return "";

  const words = normalizedText.split(/\s+/);
  if (words.length <= maxWords) return normalizedText;

  return `${words.slice(0, maxWords).join(" ")}...`;
}

interface NotificationsPageProps {
  embedded?: boolean;
}

export default function NotificationsPage({
  embedded = false,
}: NotificationsPageProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const { isAdmin, isManager, isTenant } = useAuthorization();
  const { t, formatDate } = useLocalizationContext();

  const currentView = (searchParams.get("view") as NotificationView) || "all";
  const currentCategory =
    (searchParams.get("category") as NotificationCategory) || "all";
  const currentPage = Math.max(
    Number.parseInt(searchParams.get("page") || "1", 10) || 1,
    1,
  );
  const currentLimit = Math.min(
    Number.parseInt(searchParams.get("limit") || "20", 10) || 20,
    100,
  );
  const currentSearch = searchParams.get("q") || "";
  const currentDateFrom = searchParams.get("from") || "";
  const currentDateTo = searchParams.get("to") || "";

  const [searchInput, setSearchInput] = useState(currentSearch);
  const selectedDateRange = useMemo<DateRange | undefined>(() => {
    const from = currentDateFrom ? new Date(currentDateFrom) : undefined;
    const to = currentDateTo ? new Date(currentDateTo) : undefined;

    return {
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    };
  }, [currentDateFrom, currentDateTo]);
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    setSearchInput(currentSearch);
  }, [currentSearch]);

  const canUseNotifications =
    status === "authenticated" && (isAdmin || isManager || isTenant);

  // Batch URL param updates so that multiple rapid calls (e.g. GlobalPagination
  // firing both onPageSizeChange and onPageChange in the same tick) are merged
  // into a single router.replace instead of the second overwriting the first.
  const pendingUpdatesRef = useRef<Record<string, string | null>>({});
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      Object.assign(pendingUpdatesRef.current, updates);

      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
      }

      flushTimeoutRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());

        Object.entries(pendingUpdatesRef.current).forEach(([key, value]) => {
          if (!value) {
            params.delete(key);
          } else {
            params.set(key, value);
          }
        });

        pendingUpdatesRef.current = {};
        flushTimeoutRef.current = null;

        const nextQuery = params.toString();
        router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
          scroll: false,
        });
      }, 0);
    },
    [pathname, router, searchParams],
  );

  // Cleanup flush timeout on unmount
  useEffect(() => {
    return () => {
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (debouncedSearch === currentSearch) {
      return;
    }

    updateParams({
      q: debouncedSearch.trim() || null,
      page: "1",
    });
  }, [currentSearch, debouncedSearch, updateParams]);

  const {
    notifications,
    unreadCount,
    metrics,
    pagination,
    isLoading,
    error,
    markAsRead,
    markAsUnread,
    markAllAsRead,
    deleteNotification,
    deleteNotifications,
    refresh,
  } = useNotifications({
    page: currentPage,
    limit: currentLimit,
    includeRead: currentView !== "unread",
    status: currentView === "unread" ? "unread" : "all",
    priority: currentView === "high" ? "high" : "all",
    category: currentCategory,
    search: debouncedSearch,
    dateFrom: currentDateFrom || undefined,
    dateTo: currentDateTo || undefined,
    pollInterval: 60000,
    enabled: canUseNotifications,
  });

  const [selectedNotificationIds, setSelectedNotificationIds] = useState<
    string[]
  >([]);
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: "single"; id: string; title: string }
    | { type: "bulk"; ids: string[] }
    | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const viewOptions: Array<{ label: string; value: NotificationView }> =
    useMemo(
      () => [
        { label: t("dashboard.notifications.view.all"), value: "all" },
        { label: t("dashboard.notifications.view.unread"), value: "unread" },
        { label: t("dashboard.notifications.view.high"), value: "high" },
      ],
      [t],
    );

  const categoryOptions: Array<{
    label: string;
    value: NotificationCategory;
  }> = useMemo(
    () => [
      {
        label: t("dashboard.notifications.filter.category.all"),
        value: "all",
      },
      {
        label: t("dashboard.notifications.category.payments"),
        value: "payments",
      },
      { label: t("dashboard.notifications.category.leases"), value: "leases" },
      {
        label: t("dashboard.notifications.category.maintenance"),
        value: "maintenance",
      },
      { label: t("dashboard.notifications.category.system"), value: "system" },
    ],
    [t],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.type === "single") {
        const success = await deleteNotification(deleteTarget.id);
        if (success) toast.success(t("dashboard.notifications.toasts.deleted"));
        else toast.error(t("dashboard.notifications.toasts.deleteFailed"));
      } else {
        const success = await deleteNotifications(deleteTarget.ids);
        if (success) {
          toast.success(
            t("dashboard.notifications.toasts.bulkDeleted", {
              values: { count: deleteTarget.ids.length },
            }),
          );
          setSelectedNotificationIds([]);
        } else {
          toast.error(t("dashboard.notifications.toasts.bulkDeleteFailed"));
        }
      }
    } catch {
      toast.error(t("dashboard.notifications.toasts.deleteFailed"));
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteNotification, deleteNotifications, t]);

  const handleBulkMarkRead = useCallback(async () => {
    if (selectedNotificationIds.length === 0) return;
    await markAsRead(selectedNotificationIds);
    toast.success(
      t("dashboard.notifications.toasts.bulkMarkedRead", {
        values: { count: selectedNotificationIds.length },
      }),
    );
    setSelectedNotificationIds([]);
  }, [selectedNotificationIds, markAsRead, t]);

  const handleBulkMarkUnread = useCallback(async () => {
    if (selectedNotificationIds.length === 0) return;
    await markAsUnread(selectedNotificationIds);
    toast.success(
      t("dashboard.notifications.toasts.bulkMarkedUnread", {
        values: { count: selectedNotificationIds.length },
      }),
    );
    setSelectedNotificationIds([]);
  }, [selectedNotificationIds, markAsUnread, t]);

  const hasFilters = useMemo(
    () =>
      currentView !== "all" ||
      currentCategory !== "all" ||
      currentSearch.length > 0 ||
      currentDateFrom.length > 0 ||
      currentDateTo.length > 0,
    [
      currentCategory,
      currentDateFrom,
      currentDateTo,
      currentSearch,
      currentView,
    ],
  );

  const actionableCount = useMemo(
    () =>
      notifications.filter((notification) => Boolean(notification.actionUrl))
        .length,
    [notifications],
  );

  const handleOpenNotification = useCallback(
    async (notification: NotificationItem) => {
      if (!notification.read) {
        await markAsRead([notification.id]);
      }

      if (notification.actionUrl) {
        router.push(notification.actionUrl);
      }
    },
    [markAsRead, router],
  );

  const notificationColumns = useMemo<DataTableColumn<NotificationItem>[]>(
    () => [
      {
        id: "notification",
        header: t("dashboard.notifications.table.notification"),
        cell: (notification) => {
          return (
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Bell className="h-4 w-4" />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="font-semibold text-foreground line-clamp-1">
                  {notification.title}
                </p>
                <p className="text-sm text-muted-foreground line-clamp-1">
                  ID: {notification.id.slice(0, 8)}
                </p>
              </div>
            </div>
          );
        },
        className: "min-w-[280px]",
      },
      {
        id: "status",
        header: t("dashboard.notifications.table.status"),
        cell: (notification) => (
          <div className="space-y-1">
            <Badge variant={notification.read ? "secondary" : "default"}>
              {t(getNotificationStatusLabelKey(notification))}
            </Badge>
            <p className="text-sm text-muted-foreground">
              {formatTypeLabel(notification.type)}
            </p>
          </div>
        ),
        width: "w-[160px]",
      },
      {
        id: "details",
        header: t("dashboard.notifications.table.details"),
        cell: (notification) => (
          <div className="space-y-1">
            <p className="text-sm text-foreground line-clamp-1">
              {notification.metadata?.propertyName
                ? String(notification.metadata.propertyName)
                : formatTypeLabel(notification.type)}
            </p>
            <p className="text-sm text-muted-foreground line-clamp-1">
              <span title={notification.message}>
                {truncateWords(notification.message, 6)}
              </span>
            </p>
          </div>
        ),
        className: "min-w-[260px]",
        visibility: "lg",
      },
      {
        id: "priority",
        header: t("dashboard.notifications.table.priority"),
        cell: (notification) => (
          <div className="space-y-1">
            <Badge variant={getPriorityVariant(notification.priority)}>
              {t(getPriorityLabelKey(notification.priority))}
            </Badge>
            <p className="text-sm text-muted-foreground">
              {t(getCategoryLabelKey(getCategory(notification.type)))}
            </p>
          </div>
        ),
        width: "w-[150px]",
      },
      {
        id: "received",
        header: t("dashboard.notifications.table.received"),
        cell: (notification) => (
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {timeAgo(new Date(notification.createdAt))}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatDate(new Date(notification.createdAt), {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              })}
            </p>
          </div>
        ),
        width: "w-[160px]",
        visibility: "md",
      },
      {
        id: "actions",
        header: t("dashboard.notifications.table.actions"),
        cell: (notification) => (
          <div
            className="flex justify-end"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">
                    {t("dashboard.notifications.table.actions")}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {t("dashboard.notifications.table.actions")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    router.push(`/dashboard/notifications/${notification.id}`)
                  }
                >
                  <Eye className="me-2 h-4 w-4" />
                  {t("dashboard.notifications.actions.viewDetails")}
                </DropdownMenuItem>
                {notification.actionUrl && (
                  <DropdownMenuItem
                    onClick={() => void handleOpenNotification(notification)}
                  >
                    <ExternalLink className="me-2 h-4 w-4" />
                    {t("dashboard.notifications.actions.openResource")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {notification.read ? (
                  <DropdownMenuItem
                    onClick={() => void markAsUnread([notification.id])}
                  >
                    <EyeOff className="me-2 h-4 w-4" />
                    {t("dashboard.notifications.actions.markAsUnread")}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => void markAsRead([notification.id])}
                  >
                    <Check className="me-2 h-4 w-4" />
                    {t("dashboard.notifications.actions.markAsRead")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() =>
                    setDeleteTarget({
                      type: "single",
                      id: notification.id,
                      title: notification.title,
                    })
                  }
                >
                  <Trash2 className="me-2 h-4 w-4" />
                  {t("dashboard.notifications.actions.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
        width: "w-[80px]",
        align: "right",
      },
    ],
    [formatDate, handleOpenNotification, markAsRead, markAsUnread, router, t],
  );

  const selectedIdsOnPage = useMemo(
    () => notifications.map((notification) => notification.id),
    [notifications],
  );

  const dateRangeLabel = useMemo(() => {
    if (selectedDateRange?.from && selectedDateRange?.to) {
      return `${formatDisplayDate(selectedDateRange.from)} – ${formatDisplayDate(selectedDateRange.to)}`;
    }

    if (selectedDateRange?.from) {
      return formatDisplayDate(selectedDateRange.from);
    }

    return t("dashboard.notifications.filter.dateRange");
  }, [selectedDateRange, t]);

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!embedded) return;
    setPortalTarget(document.getElementById("updates-header-actions"));
  }, [embedded]);

  const actionButtons = (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void refresh()}
        disabled={!canUseNotifications}
      >
        <RotateCcw className="h-4 w-4" />
        {t("dashboard.notifications.actions.refresh")}
      </Button>
      <Button
        size="sm"
        onClick={() => void markAllAsRead()}
        disabled={!canUseNotifications || unreadCount === 0}
      >
        <Check className="h-4 w-4" />
        {t("dashboard.notifications.actions.markAllRead")}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("dashboard.notifications.header.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("dashboard.notifications.header.subtitle")}
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-center">
            <PushToggle />
            {actionButtons}
          </div>
        </div>
      )}
      {embedded && portalTarget && createPortal(actionButtons, portalTarget)}

      <AnalyticsCardGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <AnalyticsCard
          title={t("dashboard.notifications.stats.total.title")}
          value={pagination.total}
          description={t("dashboard.notifications.stats.total.description")}
          icon={Bell}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("dashboard.notifications.stats.unread.title")}
          value={unreadCount}
          description={t("dashboard.notifications.stats.unread.description")}
          icon={Sparkles}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("dashboard.notifications.stats.highPriority.title")}
          value={metrics.highPriority}
          description={t(
            "dashboard.notifications.stats.highPriority.description",
          )}
          icon={ShieldAlert}
          iconColor="warning"
        />
        <AnalyticsCard
          title={t("dashboard.notifications.stats.actionable.title")}
          value={actionableCount}
          description={t(
            "dashboard.notifications.stats.actionable.description",
          )}
          icon={Filter}
          iconColor="success"
        />
      </AnalyticsCardGrid>

      <Card className="gap-2">
        <CardHeader>
          {!embedded && (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                  <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {t("dashboard.notifications.header.title")}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("dashboard.notifications.panel.subtitle")}
                  </p>
                </div>
              </div>

              <div className="flex items-center border rounded-lg p-1 w-full sm:w-auto">
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 flex-1 sm:flex-none sm:px-3"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <div className="relative flex-1 min-w-0">
              <SearchIcon className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t("dashboard.notifications.search.placeholder")}
                className="ps-10 h-10 border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500 focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500 bg-white dark:bg-gray-800"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-2">
                {viewOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={
                      currentView === option.value ? "default" : "outline"
                    }
                    className="h-10"
                    onClick={() =>
                      updateParams({
                        view: option.value === "all" ? null : option.value,
                        page: "1",
                      })
                    }
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={currentCategory}
                onValueChange={(value) =>
                  updateParams({
                    category: value === "all" ? null : value,
                    page: "1",
                  })
                }
              >
                <SelectTrigger className="h-10 w-42.5 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t(
                      "dashboard.notifications.filter.category.all",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-10 w-70 justify-start border-gray-200 bg-white text-start font-normal dark:border-gray-700 dark:bg-gray-800"
                  >
                    <CalendarIcon className="me-2 h-4 w-4" />
                    {dateRangeLabel}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto p-0">
                  <Calendar
                    mode="range"
                    defaultMonth={selectedDateRange?.from}
                    selected={selectedDateRange}
                    onSelect={(range) =>
                      updateParams({
                        from: range?.from
                          ? format(range.from, "yyyy-MM-dd")
                          : null,
                        to: range?.to ? format(range.to, "yyyy-MM-dd") : null,
                        page: "1",
                      })
                    }
                    numberOfMonths={2}
                    className="rounded-lg border"
                  />
                </PopoverContent>
              </Popover>

              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                  onClick={() =>
                    updateParams({
                      view: null,
                      category: null,
                      q: null,
                      from: null,
                      to: null,
                      page: "1",
                    })
                  }
                >
                  {t("dashboard.notifications.actions.resetFilters")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!canUseNotifications ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <AlertTriangle className="h-10 w-10 text-warning" />
              <div className="space-y-1">
                <p className="text-lg font-semibold">
                  {t("dashboard.notifications.unavailable.title")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("dashboard.notifications.unavailable.description")}
                </p>
              </div>
            </div>
          ) : (
            <DataTable<NotificationItem>
              columns={notificationColumns}
              data={notifications}
              loading={isLoading}
              getRowKey={(notification) => notification.id}
              onRowClick={(notification) => {
                router.push(`/dashboard/notifications/${notification.id}`);
              }}
              getRowClassName={(notification) =>
                cn(!notification.read && "bg-primary/5", "cursor-pointer")
              }
              error={
                error
                  ? {
                      message: error,
                      icon: (
                        <AlertTriangle className="h-10 w-10 text-destructive" />
                      ),
                      onRetry: () => void refresh(),
                      retryLabel: t("dashboard.notifications.actions.retry"),
                    }
                  : null
              }
              emptyState={{
                icon: <Bell className="h-10 w-10 text-muted-foreground" />,
                title: t("dashboard.notifications.empty.title"),
                description: t("dashboard.notifications.empty.description"),
              }}
              selection={{
                enabled: true,
                selectedIds: selectedNotificationIds,
                onSelectAll: (checked) => {
                  setSelectedNotificationIds(checked ? selectedIdsOnPage : []);
                },
                onSelectRow: (id, checked) => {
                  setSelectedNotificationIds((prev) =>
                    checked
                      ? [...prev, id]
                      : prev.filter((selectedId) => selectedId !== id),
                  );
                },
                getRowId: (notification) => notification.id,
                selectAllLabel: t(
                  "dashboard.notifications.selection.selectAll",
                ),
                selectRowLabel: (notification) =>
                  t("dashboard.notifications.selection.selectOne", {
                    values: { title: notification.title },
                  }),
              }}
              loadingConfig={{ rows: pagination.limit || 8 }}
            />
          )}

          {canUseNotifications && selectedNotificationIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-3">
              <span className="text-sm font-medium text-muted-foreground">
                {t("dashboard.notifications.selection.selectedCount", {
                  values: { count: selectedNotificationIds.length },
                })}
              </span>
              <div className="ms-auto flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkMarkRead}
                >
                  <Check className="me-2 h-4 w-4" />
                  {t("dashboard.notifications.actions.markRead")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkMarkUnread}
                >
                  <EyeOff className="me-2 h-4 w-4" />
                  {t("dashboard.notifications.actions.markUnread")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() =>
                    setDeleteTarget({
                      type: "bulk",
                      ids: selectedNotificationIds,
                    })
                  }
                >
                  <Trash2 className="me-2 h-4 w-4" />
                  {t("dashboard.notifications.actions.deleteWithCount", {
                    values: { count: selectedNotificationIds.length },
                  })}
                </Button>
              </div>
            </div>
          )}

          {canUseNotifications && notifications.length > 0 && (
            <GlobalPagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.total}
              pageSize={pagination.limit}
              onPageChange={(page) =>
                updateParams({
                  page: String(page),
                })
              }
              onPageSizeChange={(pageSize) =>
                updateParams({
                  limit: String(pageSize),
                  page: "1",
                })
              }
              disabled={isLoading}
            />
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === "bulk"
                ? t("dashboard.notifications.deleteDialog.bulkTitle", {
                    values: { count: deleteTarget.ids.length },
                  })
                : t("dashboard.notifications.deleteDialog.singleTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "bulk"
                ? t("dashboard.notifications.deleteDialog.bulkDescription", {
                    values: { count: deleteTarget.ids.length },
                  })
                : t("dashboard.notifications.deleteDialog.singleDescription", {
                    values: {
                      title:
                        deleteTarget?.type === "single"
                          ? deleteTarget.title
                          : "",
                    },
                  })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeleting
                ? t("dashboard.notifications.actions.deleting")
                : t("dashboard.notifications.actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
