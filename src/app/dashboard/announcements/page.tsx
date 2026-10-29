"use client";

import { toast } from "sonner";
import { createPortal } from "react-dom";
import { useSession } from "@/lib/auth-client";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  CalendarIcon,
  CalendarRange,
  Eye,
  List,
  Loader2,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search as SearchIcon,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";

import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import { useAuthorization } from "@/hooks/useAuthorization";
import { refreshAnnouncementCounts } from "@/lib/sidebar-utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { timeAgo } from "@/lib/utils/date-fns-locale";
import { formatDisplayDate } from "@/lib/utils/formatting";

// ---------- Types ----------

interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
  type: "general" | "maintenance" | "policy" | "emergency" | "event" | "system";
  status: "draft" | "scheduled" | "published" | "expired" | "archived";
  publishedAt?: string;
  scheduledFor?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  isSticky: boolean;
  viewCount: number;
  reactionCounts: {
    like: number;
    love: number;
    helpful: number;
    important: number;
    total: number;
  };
  createdBy?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  targetAudience?: {
    includeAll?: boolean;
    roles?: string[];
    propertyIds?: Array<{ _id: string; name?: string }>;
  };
}

type AnnouncementView = "all" | "published" | "draft" | "archived";

// ---------- Helpers ----------

function getPriorityVariant(priority: AnnouncementItem["priority"]) {
  switch (priority) {
    case "urgent":
      return "destructive" as const;
    case "high":
      return "warning" as const;
    case "normal":
      return "info" as const;
    case "low":
      return "secondary" as const;
    default:
      return "default" as const;
  }
}

function getStatusVariant(status: AnnouncementItem["status"]) {
  switch (status) {
    case "published":
      return "default" as const;
    case "draft":
      return "secondary" as const;
    case "scheduled":
      return "info" as const;
    case "expired":
      return "warning" as const;
    case "archived":
      return "outline" as const;
    default:
      return "default" as const;
  }
}

function normalizeAnnouncement(raw: any): AnnouncementItem {
  const resolveId = (value: any): string => {
    if (!value) return "";
    if (typeof value === "string") return value;
    return String(value);
  };

  return {
    id: resolveId(raw._id ?? raw.id),
    title: raw?.title ?? "",
    content: raw?.content ?? "",
    priority: raw?.priority ?? "normal",
    type: raw?.type ?? "general",
    status: raw?.status ?? "draft",
    publishedAt: raw?.publishedAt,
    scheduledFor: raw?.scheduledFor,
    expiresAt: raw?.expiresAt,
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
    isSticky: raw?.isSticky ?? false,
    viewCount: Number(raw?.viewCount ?? raw?.views?.length ?? 0),
    reactionCounts: raw?.reactionCounts ?? {
      like: 0,
      love: 0,
      helpful: 0,
      important: 0,
      total: 0,
    },
    createdBy: raw?.createdBy
      ? {
          firstName: raw.createdBy.firstName,
          lastName: raw.createdBy.lastName,
          email: raw.createdBy.email,
        }
      : undefined,
    targetAudience: raw?.targetAudience,
  };
}

function truncateWords(text: string, maxWords = 12): string {
  const normalizedText = text.trim();
  if (!normalizedText) return "";

  const words = normalizedText.split(/\s+/);
  if (words.length <= maxWords) return normalizedText;

  return `${words.slice(0, maxWords).join(" ")}...`;
}

// ---------- Component ----------

interface AnnouncementsPageProps {
  embedded?: boolean;
}

export default function AnnouncementsPage({
  embedded = false,
}: AnnouncementsPageProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, status: authStatus } = useSession();
  const { isCompanyStaff } = useAuthorization();
  const { t, formatDate } = useLocalizationContext();

  // URL-based state
  const currentView = (searchParams.get("view") as AnnouncementView) || "all";
  const currentType = searchParams.get("type") || "all";
  const currentPriority = searchParams.get("priority") || "all";
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

  const isAdmin = authStatus === "authenticated" && isCompanyStaff;

  // Data state
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });

  // Stats
  const [stats, setStats] = useState({
    total: 0,
    published: 0,
    draft: 0,
    scheduled: 0,
    archived: 0,
  });

  // Selection & modals
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: "single"; id: string; title: string }
    | { type: "bulk"; ids: string[] }
    | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "",
    content: "",
    priority: "normal",
    type: "general",
    targetAudience: "all",
  });
  const [isCreating, setIsCreating] = useState(false);

  // ---------- URL param helper ----------

  const pendingUpdatesRef = useRef<Record<string, string | null>>({});
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      Object.assign(pendingUpdatesRef.current, updates);
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);

      flushTimeoutRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        Object.entries(pendingUpdatesRef.current).forEach(([key, value]) => {
          if (!value) params.delete(key);
          else params.set(key, value);
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

  useEffect(() => {
    return () => {
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (debouncedSearch === currentSearch) return;
    updateParams({ q: debouncedSearch.trim() || null, page: "1" });
  }, [currentSearch, debouncedSearch, updateParams]);

  // ---------- Fetch ----------

  const fetchAnnouncements = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("page", String(currentPage));
      params.set("limit", String(currentLimit));

      if (currentView === "published") params.set("status", "published");
      else if (currentView === "draft") params.set("status", "draft");
      else if (currentView === "archived") params.set("status", "archived");

      if (currentType !== "all") params.set("type", currentType);
      if (currentPriority !== "all") params.set("priority", currentPriority);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (currentDateFrom) params.set("from", currentDateFrom);
      if (currentDateTo) params.set("to", currentDateTo);
      if (!isAdmin) params.set("activeOnly", "true");

      const response = await fetch(`/api/announcements?${params.toString()}`);
      if (!response.ok) {
        let message = t("announcements.error.fetch");
        try {
          const payload = await response.json();
          message = payload?.error || payload?.message || message;
        } catch {
          // Keep localized default message when response body is not JSON
        }
        throw new Error(message);
      }

      const payload = await response.json();
      const data = payload?.data ?? payload;

      const items = (data?.announcements ?? []).map(normalizeAnnouncement);
      setAnnouncements(items);
      setPagination({
        page: data?.page ?? currentPage,
        limit: currentLimit,
        total: data?.total ?? 0,
        totalPages: data?.totalPages ?? 1,
      });

      // Calculate stats from all announcements (unfiltered count)
      const statusCounts = items.reduce(
        (acc: Record<string, number>, item: AnnouncementItem) => {
          acc[item.status] = (acc[item.status] ?? 0) + 1;
          return acc;
        },
        {},
      );

      setStats({
        total: data?.total ?? items.length,
        published: statusCounts.published ?? 0,
        draft: statusCounts.draft ?? 0,
        scheduled: statusCounts.scheduled ?? 0,
        archived: statusCounts.archived ?? 0,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("announcements.error.fetch"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    session?.user,
    currentPage,
    currentLimit,
    currentView,
    currentType,
    currentPriority,
    debouncedSearch,
    currentDateFrom,
    currentDateTo,
    isAdmin,
    t,
  ]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  // ---------- Actions ----------

  const handleCreate = async () => {
    if (!createForm.title.trim() || !createForm.content.trim()) {
      toast.error(t("announcements.toasts.fillRequired"));
      return;
    }

    setIsCreating(true);
    try {
      const response = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createForm.title,
          content: createForm.content,
          priority: createForm.priority,
          type: createForm.type,
          targetAudience: {
            includeAll: createForm.targetAudience === "all",
            roles:
              createForm.targetAudience === "tenants"
                ? ["tenant"]
                : createForm.targetAudience === "staff"
                  ? ["manager"]
                  : [],
          },
          publishedAt: new Date(),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to create announcement");
      }

      toast.success(t("announcements.toasts.created"));
      setShowCreateDialog(false);
      setCreateForm({
        title: "",
        content: "",
        priority: "normal",
        type: "general",
        targetAudience: "all",
      });
      await fetchAnnouncements();
      refreshAnnouncementCounts();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("announcements.toasts.createError"),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/announcements/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "softDelete" }),
      });

      if (!response.ok) throw new Error("Failed to delete");
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleArchive = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/api/announcements/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "archive" }),
        });

        if (!response.ok) throw new Error("Failed to archive");
        toast.success(t("announcements.toasts.archived"));
        await fetchAnnouncements();
        refreshAnnouncementCounts();
        return true;
      } catch {
        toast.error(t("announcements.toasts.archiveError"));
        return false;
      }
    },
    [fetchAnnouncements, t],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.type === "single") {
        const success = await handleDelete(deleteTarget.id);
        if (success) toast.success(t("announcements.toasts.deleted"));
        else toast.error(t("announcements.toasts.deleteError"));
      } else {
        const results = await Promise.all(
          deleteTarget.ids.map((id) => handleDelete(id)),
        );
        const successCount = results.filter(Boolean).length;
        if (successCount > 0) {
          toast.success(
            t("announcements.toasts.bulkDeleted", {
              values: { count: successCount },
            }),
          );
          setSelectedIds([]);
        } else {
          toast.error(t("announcements.toasts.deleteError"));
        }
      }
      await fetchAnnouncements();
      refreshAnnouncementCounts();
    } catch {
      toast.error(t("announcements.toasts.deleteError"));
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, handleDelete, fetchAnnouncements, t]);

  // ---------- Filter options ----------

  const viewOptions: Array<{ label: string; value: AnnouncementView }> =
    useMemo(
      () => [
        { label: t("announcements.view.all"), value: "all" },
        { label: t("announcements.view.published"), value: "published" },
        { label: t("announcements.view.draft"), value: "draft" },
        { label: t("announcements.view.archived"), value: "archived" },
      ],
      [t],
    );

  const typeOptions = useMemo(
    () => [
      { label: t("announcements.filter.type.all"), value: "all" },
      { label: t("announcements.filter.type.general"), value: "general" },
      {
        label: t("announcements.filter.type.maintenance"),
        value: "maintenance",
      },
      { label: t("announcements.filter.type.policy"), value: "policy" },
      { label: t("announcements.filter.type.emergency"), value: "emergency" },
      { label: t("announcements.filter.type.event"), value: "event" },
      { label: t("announcements.filter.type.system"), value: "system" },
    ],
    [t],
  );

  const priorityOptions = useMemo(
    () => [
      { label: t("announcements.filter.priority.all"), value: "all" },
      { label: t("announcements.filter.priority.low"), value: "low" },
      { label: t("announcements.filter.priority.normal"), value: "normal" },
      { label: t("announcements.filter.priority.high"), value: "high" },
      { label: t("announcements.filter.priority.urgent"), value: "urgent" },
    ],
    [t],
  );

  const hasFilters = useMemo(
    () =>
      currentView !== "all" ||
      currentType !== "all" ||
      currentPriority !== "all" ||
      currentSearch.length > 0 ||
      currentDateFrom.length > 0 ||
      currentDateTo.length > 0,
    [
      currentView,
      currentType,
      currentPriority,
      currentSearch,
      currentDateFrom,
      currentDateTo,
    ],
  );

  const dateRangeLabel = useMemo(() => {
    if (selectedDateRange?.from && selectedDateRange?.to) {
      return `${formatDisplayDate(selectedDateRange.from)} – ${formatDisplayDate(selectedDateRange.to)}`;
    }
    if (selectedDateRange?.from) {
      return formatDisplayDate(selectedDateRange.from);
    }
    return t("announcements.filter.dateRange");
  }, [selectedDateRange, t]);

  // ---------- Table columns ----------

  const columns = useMemo<DataTableColumn<AnnouncementItem>[]>(
    () => [
      {
        id: "announcement",
        header: t("announcements.table.announcement"),
        cell: (item) => (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Megaphone className="h-4 w-4" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-foreground line-clamp-1">
                  {item.title}
                </p>
                {item.isSticky && (
                  <Badge variant="outline" className="text-xs">
                    {t("announcements.table.pinned")}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-1">
                <span title={item.content}>
                  {truncateWords(item.content, 6)}
                </span>
              </p>
            </div>
          </div>
        ),
        className: "min-w-[280px]",
      },
      {
        id: "status",
        header: t("announcements.table.status"),
        cell: (item) => (
          <div className="space-y-1">
            <Badge variant={getStatusVariant(item.status)}>
              {t(`announcements.status.${item.status}`)}
            </Badge>
            <p className="text-sm text-muted-foreground capitalize">
              {t(`announcements.type.${item.type}`)}
            </p>
          </div>
        ),
        width: "w-[150px]",
      },
      {
        id: "priority",
        header: t("announcements.table.priority"),
        cell: (item) => (
          <Badge variant={getPriorityVariant(item.priority)}>
            {t(`announcements.priority.${item.priority}`)}
          </Badge>
        ),
        width: "w-[120px]",
      },
      {
        id: "audience",
        header: t("announcements.table.audience"),
        cell: (item) => (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3 text-muted-foreground" />
              <p className="text-sm text-foreground">
                {item.targetAudience?.includeAll
                  ? t("announcements.audience.everyone")
                  : item.targetAudience?.roles?.length
                    ? item.targetAudience.roles
                        .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
                        .join(", ")
                    : t("announcements.audience.specific")}
              </p>
            </div>
          </div>
        ),
        width: "w-[150px]",
        visibility: "lg",
      },
      {
        id: "engagement",
        header: t("announcements.table.engagement"),
        cell: (item) => (
          <div className="space-y-1">
            <div className="flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Eye className="h-3 w-3" />
                {item.viewCount}
              </span>
              <span className="text-muted-foreground">
                {item.reactionCounts?.total ?? 0}{" "}
                {t("announcements.table.reactions")}
              </span>
            </div>
          </div>
        ),
        width: "w-[150px]",
        visibility: "md",
      },
      {
        id: "date",
        header: t("announcements.table.date"),
        cell: (item) => {
          const date = item.publishedAt || item.createdAt;
          return (
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {date
                  ? timeAgo(new Date(date))
                  : "-"}
              </p>
              <p className="text-sm text-muted-foreground">
                {date
                  ? formatDate(new Date(date), {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    })
                  : ""}
              </p>
            </div>
          );
        },
        width: "w-[160px]",
        visibility: "md",
      },
      {
        id: "actions",
        header: t("announcements.table.actions"),
        cell: (item) => (
          <div
            className="flex justify-end"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {t("announcements.table.actions")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    router.push(`/dashboard/announcements/${item.id}`)
                  }
                >
                  <Eye className="me-2 h-4 w-4" />
                  {t("announcements.actions.view")}
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuItem
                      onClick={() =>
                        router.push(
                          `/dashboard/announcements/${item.id}?edit=true`,
                        )
                      }
                    >
                      <Pencil className="me-2 h-4 w-4" />
                      {t("announcements.actions.edit")}
                    </DropdownMenuItem>
                    {item.status !== "archived" && (
                      <DropdownMenuItem onClick={() => handleArchive(item.id)}>
                        <Archive className="me-2 h-4 w-4" />
                        {t("announcements.actions.archive")}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() =>
                        setDeleteTarget({
                          type: "single",
                          id: item.id,
                          title: item.title,
                        })
                      }
                    >
                      <Trash2 className="me-2 h-4 w-4" />
                      {t("announcements.actions.delete")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
        width: "w-[80px]",
        align: "right",
      },
    ],
    [formatDate, handleArchive, isAdmin, router, t],
  );

  const selectedIdsOnPage = useMemo(
    () => announcements.map((a) => a.id),
    [announcements],
  );

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
        onClick={() => void fetchAnnouncements()}
        disabled={isLoading}
      >
        <RotateCcw className="h-4 w-4" />
        {t("announcements.actions.refresh")}
      </Button>
      {isAdmin && (
        <Button size="sm" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4" />
          {t("announcements.actions.create")}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {t("announcements.header.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("announcements.header.subtitle")}
            </p>
          </div>
          {actionButtons}
        </div>
      )}
      {embedded && portalTarget && createPortal(actionButtons, portalTarget)}

      {/* Stats Cards */}
      <AnalyticsCardGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <AnalyticsCard
          title={t("announcements.stats.total.title")}
          value={stats.total}
          description={t("announcements.stats.total.description")}
          icon={Megaphone}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("announcements.stats.published.title")}
          value={stats.published}
          description={t("announcements.stats.published.description")}
          icon={Sparkles}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("announcements.stats.draft.title")}
          value={stats.draft}
          description={t("announcements.stats.draft.description")}
          icon={Pencil}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("announcements.stats.scheduled.title")}
          value={stats.scheduled}
          description={t("announcements.stats.scheduled.description")}
          icon={CalendarRange}
          iconColor="warning"
        />
      </AnalyticsCardGrid>

      {/* Main Card with Table */}
      <Card className="gap-2">
        <CardHeader>
          {!embedded && (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-50 dark:bg-purple-900/30 rounded-lg border border-purple-100 dark:border-purple-800">
                  <Megaphone className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {t("announcements.panel.title")}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("announcements.panel.subtitle")}
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

          {/* Filters */}
          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <div className="relative flex-1 min-w-0">
              <SearchIcon className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("announcements.search.placeholder")}
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
                value={currentType}
                onValueChange={(value) =>
                  updateParams({
                    type: value === "all" ? null : value,
                    page: "1",
                  })
                }
              >
                <SelectTrigger className="h-10 w-42.5 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("announcements.filter.type.all")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={currentPriority}
                onValueChange={(value) =>
                  updateParams({
                    priority: value === "all" ? null : value,
                    page: "1",
                  })
                }
              >
                <SelectTrigger className="h-10 w-36 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("announcements.filter.priority.all")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((option) => (
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
                      type: null,
                      priority: null,
                      q: null,
                      from: null,
                      to: null,
                      page: "1",
                    })
                  }
                >
                  {t("announcements.actions.resetFilters")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <DataTable<AnnouncementItem>
            columns={columns}
            data={announcements}
            loading={isLoading}
            getRowKey={(item) => item.id}
            onRowClick={(item) =>
              router.push(`/dashboard/announcements/${item.id}`)
            }
            getRowClassName={(item) =>
              cn(item.isSticky && "bg-primary/5", "cursor-pointer")
            }
            error={
              error
                ? {
                    message: error,
                    icon: (
                      <AlertTriangle className="h-10 w-10 text-destructive" />
                    ),
                    onRetry: () => void fetchAnnouncements(),
                    retryLabel: t("announcements.actions.retry"),
                  }
                : null
            }
            emptyState={{
              icon: <Megaphone className="h-10 w-10 text-muted-foreground" />,
              title: t("announcements.empty.title"),
              description: t("announcements.empty.description"),
            }}
            selection={
              isAdmin
                ? {
                    enabled: true,
                    selectedIds,
                    onSelectAll: (checked) =>
                      setSelectedIds(checked ? selectedIdsOnPage : []),
                    onSelectRow: (id, checked) =>
                      setSelectedIds((prev) =>
                        checked
                          ? [...prev, id]
                          : prev.filter((sid) => sid !== id),
                      ),
                    getRowId: (item) => item.id,
                    selectAllLabel: t("announcements.selection.selectAll"),
                    selectRowLabel: (item) =>
                      t("announcements.selection.selectOne", {
                        values: { title: item.title },
                      }),
                  }
                : undefined
            }
            loadingConfig={{ rows: pagination.limit || 8 }}
          />

          {/* Bulk Actions */}
          {isAdmin && selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-3">
              <span className="text-sm font-medium text-muted-foreground">
                {t("announcements.selection.selectedCount", {
                  values: { count: selectedIds.length },
                })}
              </span>
              <div className="ms-auto flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() =>
                    setDeleteTarget({ type: "bulk", ids: selectedIds })
                  }
                >
                  <Trash2 className="me-2 h-4 w-4" />
                  {t("announcements.actions.deleteSelected", {
                    values: { count: selectedIds.length },
                  })}
                </Button>
              </div>
            </div>
          )}

          {/* Pagination */}
          {announcements.length > 0 && (
            <GlobalPagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.total}
              pageSize={pagination.limit}
              onPageChange={(page) => updateParams({ page: String(page) })}
              onPageSizeChange={(pageSize) =>
                updateParams({ limit: String(pageSize), page: "1" })
              }
              disabled={isLoading}
            />
          )}
        </CardContent>
      </Card>

      {/* Create Announcement Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{t("announcements.dialog.create.title")}</DialogTitle>
            <DialogDescription>
              {t("announcements.dialog.create.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">
                {t("announcements.dialog.create.titleLabel")}
              </Label>
              <Input
                id="title"
                value={createForm.title}
                onChange={(e) =>
                  setCreateForm({ ...createForm, title: e.target.value })
                }
                placeholder={t("announcements.dialog.create.titlePlaceholder")}
                maxLength={200}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">
                {t("announcements.dialog.create.contentLabel")}
              </Label>
              <Textarea
                id="content"
                value={createForm.content}
                onChange={(e) =>
                  setCreateForm({ ...createForm, content: e.target.value })
                }
                placeholder={t(
                  "announcements.dialog.create.contentPlaceholder",
                )}
                rows={5}
                maxLength={5000}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("announcements.dialog.create.priorityLabel")}</Label>
                <Select
                  value={createForm.priority}
                  onValueChange={(value) =>
                    setCreateForm({ ...createForm, priority: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">
                      {t("announcements.priority.low")}
                    </SelectItem>
                    <SelectItem value="normal">
                      {t("announcements.priority.normal")}
                    </SelectItem>
                    <SelectItem value="high">
                      {t("announcements.priority.high")}
                    </SelectItem>
                    <SelectItem value="urgent">
                      {t("announcements.priority.urgent")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("announcements.dialog.create.typeLabel")}</Label>
                <Select
                  value={createForm.type}
                  onValueChange={(value) =>
                    setCreateForm({ ...createForm, type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">
                      {t("announcements.type.general")}
                    </SelectItem>
                    <SelectItem value="maintenance">
                      {t("announcements.type.maintenance")}
                    </SelectItem>
                    <SelectItem value="policy">
                      {t("announcements.type.policy")}
                    </SelectItem>
                    <SelectItem value="emergency">
                      {t("announcements.type.emergency")}
                    </SelectItem>
                    <SelectItem value="event">
                      {t("announcements.type.event")}
                    </SelectItem>
                    <SelectItem value="system">
                      {t("announcements.type.system")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("announcements.dialog.create.audienceLabel")}</Label>
              <Select
                value={createForm.targetAudience}
                onValueChange={(value) =>
                  setCreateForm({ ...createForm, targetAudience: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("announcements.audience.everyone")}
                  </SelectItem>
                  <SelectItem value="tenants">
                    {t("announcements.audience.tenants")}
                  </SelectItem>
                  <SelectItem value="staff">
                    {t("announcements.audience.staff")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
                disabled={isCreating}
              >
                {t("common.cancel")}
              </Button>
              <Button onClick={handleCreate} disabled={isCreating}>
                {isCreating && (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                )}
                {isCreating
                  ? t("announcements.dialog.create.creating")
                  : t("announcements.dialog.create.submit")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                ? t("announcements.deleteDialog.bulkTitle", {
                    values: { count: deleteTarget.ids.length },
                  })
                : t("announcements.deleteDialog.singleTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "bulk"
                ? t("announcements.deleteDialog.bulkDescription", {
                    values: { count: deleteTarget.ids.length },
                  })
                : t("announcements.deleteDialog.singleDescription", {
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
                ? t("announcements.actions.deleting")
                : t("announcements.actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
