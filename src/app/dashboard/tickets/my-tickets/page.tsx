"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/ui/global-search";
import { useRouter, useSearchParams } from "next/navigation";
import { TicketStatus, TicketPriority } from "@/types";
import { useState, useEffect, useCallback, useMemo } from "react";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { keepSorted } from "@/lib/server-sort";

// The sort menu's own orders. A header can choose one it does not list (the
// title, the status); the menu then shows its placeholder rather than a
// choice that is not the one in force.
const SORT_MENU_VALUES = ["createdAt-desc", "createdAt-asc", "priority-desc", "priority-asc"];
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { roleDisplayName } from "@/lib/role-display";
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
  TicketStatusBadge,
  TicketPriorityBadge,
} from "@/components/tickets/ticket-status-badge";
import TicketStats from "@/components/tickets/TicketStats";
import {
  Plus,
  Ticket,
  MoreHorizontal,
  Eye,
  Building2,
  User,
  X,
  Grid3X3,
  Rows3,
  List,
  MessageSquare,
} from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";

interface TicketItem {
  _id: string;
  ticketNumber: string;
  title: string;
  description: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  tenant: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatar?: string;
  };
  property?: {
    _id: string;
    name: string;
  } | null;
  assignedUser?: {
    _id: string;
    firstName: string;
    lastName: string;
    avatar?: string;
  } | null;
  createdBy?: {
    userId:
      | {
          _id: string;
          firstName: string;
          lastName: string;
        }
      | string;
    role: string;
  };
  comments: any[];
  createdAt: string;
  updatedAt: string;
}

interface TicketFilters {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  priority?: string;
  category?: string;
  sortBy?: string;
  sortOrder?: string;
}

export default function MyTicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { isTenant } = useAuthorization();
  const { t, formatDate, language } = useLocalizationContext();
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "rows" | "list">("list");

  const [filters, setFilters] = useState<TicketFilters>({
    page: parseInt(searchParams.get("page") || "1"),
    limit: parseInt(searchParams.get("limit") || "12"),
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  const [pagination, setPagination] = useState({
    page: 1,
    limit: 12,
    total: 0,
    pages: 0,
  });

  const [allTickets, setAllTickets] = useState<TicketItem[]>([]);

  useEffect(() => {
    if (session?.user && !isTenant) {
      router.replace("/dashboard/tickets");
    }
  }, [session, isTenant, router]);

  const fetchTickets = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("page", String(filters.page));
      params.set("limit", String(filters.limit));
      if (filters.search) params.set("search", filters.search);
      if (filters.status) params.set("status", filters.status);
      if (filters.priority) params.set("priority", filters.priority);
      if (filters.category) params.set("category", filters.category);
      if (filters.sortBy) params.set("sortBy", filters.sortBy);
      if (filters.sortOrder) params.set("sortOrder", filters.sortOrder);

      const res = await fetch(`/api/tickets?${params.toString()}`);
      const data = await res.json();
      if (res.ok && data?.success) {
        setTickets(data?.data ?? []);
        if (data?.pagination) {
          setPagination({
            page: data?.pagination?.page ?? filters.page,
            limit: data?.pagination?.limit ?? filters.limit,
            total: data?.pagination?.total ?? 0,
            pages: data?.pagination?.pages ?? 1,
          });
        }
      } else {
        toast.error(t("tickets.toasts.loadError"));
      }
    } catch {
      toast.error(t("tickets.toasts.loadError"));
    } finally {
      setLoading(false);
    }
  }, [filters, t]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/tickets?limit=1000");
      const data = await res.json();
      if (res.ok && data?.success) {
        setAllTickets(data?.data ?? []);
      }
    } catch {
      // stats are non-critical
    }
  }, []);

  useEffect(() => {
    if (session?.user && isTenant) {
      fetchTickets();
    }
  }, [fetchTickets, session, isTenant]);

  useEffect(() => {
    if (session?.user && isTenant) {
      fetchStats();
    }
  }, [fetchStats, session, isTenant]);

  const handleSearch = (search: string) => {
    setFilters((prev) => ({ ...prev, search: search || undefined, page: 1 }));
  };

  const handleFilterChange = (
    key: keyof TicketFilters,
    value: string | undefined,
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  };

  const handlePageSizeChange = (size: number) => {
    setFilters((prev) => ({ ...prev, limit: size, page: 1 }));
  };

  const hasActiveFilters = useMemo(() => {
    return !!(
      filters.search ||
      filters.status ||
      filters.priority ||
      filters.category
    );
  }, [filters.search, filters.status, filters.priority, filters.category]);

  const ticketColumns: DataTableColumn<TicketItem>[] = useMemo(
    () => [
      {
        id: "ticket",
        sortKey: "title",
        header: t("tickets.table.ticket"),
        cell: (ticket) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Link
                href={`/dashboard/tickets/${ticket._id}`}
                className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate"
                onClick={(e) => e.stopPropagation()}
              >
                {ticket.title}
              </Link>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {ticket.ticketNumber}
            </div>
          </div>
        ),
        className: "min-w-[200px]",
      },
      {
        id: "status",
        sortKey: "status",
        header: t("tickets.table.status"),
        cell: (ticket) => (
          <div className="flex flex-col gap-1">
            <TicketStatusBadge status={ticket.status} />
            <TicketPriorityBadge priority={ticket.priority} />
          </div>
        ),
      },
      {
        id: "category",
        sortKey: "category",
        header: t("tickets.table.category"),
        visibility: "md" as const,
        cell: (ticket) => (
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {t(
              `tickets.category.${ticket.category === "noise_complaint" ? "noiseComplaint" : ticket.category}`,
            ) || ticket.category}
          </span>
        ),
      },
      {
        id: "tenant",
        header: t("tickets.table.tenant"),
        visibility: "md" as const,
        cell: (ticket) => (
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-gray-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {ticket.tenant?.firstName} {ticket.tenant?.lastName}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {ticket.tenant?.email}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: "property",
        header: t("tickets.table.property"),
        visibility: "lg" as const,
        cell: (ticket) =>
          ticket.property ? (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                {ticket.property.name}
              </span>
            </div>
          ) : (
            <span className="text-xs text-gray-400">
              {t("tickets.my.labels.notAvailable", { defaultValue: "-" })}
            </span>
          ),
      },
      {
        id: "createdBy",
        header: t("tickets.table.createdBy"),
        visibility: "lg" as const,
        cell: (ticket) =>
          ticket.createdBy ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {typeof ticket.createdBy.userId === "object"
                  ? `${ticket.createdBy.userId.firstName} ${ticket.createdBy.userId.lastName}`
                  : t("tickets.my.labels.unknown", { defaultValue: "Unknown" })}
              </span>
              <Badge variant="secondary" className="capitalize text-xs">
                {roleDisplayName(ticket.createdBy.role, { language, t })}
              </Badge>
            </div>
          ) : (
            <span className="text-xs text-gray-400">
              {t("tickets.my.labels.notAvailable", { defaultValue: "-" })}
            </span>
          ),
      },
      {
        id: "created",
        sortKey: "createdAt",
        header: t("tickets.table.created"),
        visibility: "md" as const,
        cell: (ticket) => (
          <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {formatDate(ticket.createdAt, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("tickets.table.actions"),
        align: "right" as const,
        cell: (ticket) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/dashboard/tickets/${ticket._id}`);
                }}
              >
                <Eye className="h-4 w-4 me-2" />
                {t("tickets.actions.viewDetails")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        className: "w-12",
      },
    ],
    [router, t, formatDate, language],
  );

  if (session?.user && !isTenant) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
            <Ticket className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("tickets.my.header.title", { defaultValue: "My Tickets" })}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("tickets.my.header.subtitle", {
                defaultValue:
                  "Track your support requests and communicate with management",
              })}
            </p>
          </div>
        </div>
        <Link href="/dashboard/tickets/new">
          <Button
            size="sm"
            className="bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
          >
            <Plus className="h-4 w-4 me-2" />
            {t("tickets.newTicket")}
          </Button>
        </Link>
      </div>

      <TicketStats tickets={allTickets} />

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <Ticket className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("tickets.card.title")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("tickets.card.subtitle")}
                </p>
              </div>
            </div>

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
                variant={viewMode === "rows" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("rows")}
                className="h-8 flex-1 sm:flex-none sm:px-3"
              >
                <Rows3 className="h-4 w-4" />
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

          <div className="flex flex-col lg:flex-row lg:items-center gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            <div className="flex-1 min-w-0">
              <GlobalSearch
                onSearch={handleSearch}
                placeholder={t("tickets.search.placeholder")}
                initialValue={filters.search || ""}
                className="w-full"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={filters.status || "all"}
                onValueChange={(v) =>
                  handleFilterChange("status", v === "all" ? undefined : v)
                }
              >
                <SelectTrigger className="w-35 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("tickets.filters.allStatus")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("tickets.filters.allStatus")}
                  </SelectItem>
                  <SelectItem value={TicketStatus.OPEN}>
                    {t("tickets.status.open")}
                  </SelectItem>
                  <SelectItem value={TicketStatus.IN_PROGRESS}>
                    {t("tickets.status.inProgress")}
                  </SelectItem>
                  <SelectItem value={TicketStatus.RESOLVED}>
                    {t("tickets.status.resolved")}
                  </SelectItem>
                  <SelectItem value={TicketStatus.CLOSED}>
                    {t("tickets.status.closed")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.priority || "all"}
                onValueChange={(v) =>
                  handleFilterChange("priority", v === "all" ? undefined : v)
                }
              >
                <SelectTrigger className="w-35 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue placeholder={t("tickets.filters.allPriority")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("tickets.filters.allPriority")}
                  </SelectItem>
                  <SelectItem value={TicketPriority.LOW}>
                    {t("tickets.priority.low")}
                  </SelectItem>
                  <SelectItem value={TicketPriority.MEDIUM}>
                    {t("tickets.priority.medium")}
                  </SelectItem>
                  <SelectItem value={TicketPriority.HIGH}>
                    {t("tickets.priority.high")}
                  </SelectItem>
                  <SelectItem value={TicketPriority.URGENT}>
                    {t("tickets.priority.urgent")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.category || "all"}
                onValueChange={(v) =>
                  handleFilterChange("category", v === "all" ? undefined : v)
                }
              >
                <SelectTrigger className="w-40 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("tickets.filters.allCategories")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("tickets.filters.allCategories")}
                  </SelectItem>
                  <SelectItem value="billing">
                    {t("tickets.category.billing")}
                  </SelectItem>
                  <SelectItem value="lease">
                    {t("tickets.category.lease")}
                  </SelectItem>
                  <SelectItem value="maintenance">
                    {t("tickets.category.maintenance")}
                  </SelectItem>
                  <SelectItem value="noise_complaint">
                    {t("tickets.category.noiseComplaint")}
                  </SelectItem>
                  <SelectItem value="safety">
                    {t("tickets.category.safety")}
                  </SelectItem>
                  <SelectItem value="general">
                    {t("tickets.category.general")}
                  </SelectItem>
                  <SelectItem value="suggestion">
                    {t("tickets.category.suggestion")}
                  </SelectItem>
                  <SelectItem value="other">
                    {t("tickets.category.other")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={
                  SORT_MENU_VALUES.includes(`${filters.sortBy}-${filters.sortOrder}`)
                    ? `${filters.sortBy}-${filters.sortOrder}`
                    : ""
                }
                onValueChange={(value) => {
                  const [sortBy, sortOrder] = value.split("-");
                  setFilters((prev) => ({ ...prev, sortBy, sortOrder }));
                }}
              >
                <SelectTrigger className="w-35 h-10 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("tickets.my.filters.sort", {
                      defaultValue: "Sort",
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="createdAt-desc">
                    {t("tickets.sort.newestFirst")}
                  </SelectItem>
                  <SelectItem value="createdAt-asc">
                    {t("tickets.sort.oldestFirst")}
                  </SelectItem>
                  <SelectItem value="priority-desc">
                    {t("tickets.sort.priorityHigh")}
                  </SelectItem>
                  <SelectItem value="priority-asc">
                    {t("tickets.sort.priorityLow")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFilters({
                      page: 1,
                      limit: filters.limit,
                      sortBy: "createdAt",
                      sortOrder: "desc",
                    })
                  }
                  className="h-10 px-3 text-gray-500 hover:text-gray-700"
                >
                  <X className="h-4 w-4 me-1" />
                  {t("tickets.filters.clear")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            viewMode === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Card key={i} className="overflow-hidden p-0">
                    <CardContent className="p-4 space-y-3">
                      <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse" />
                      <div className="h-3 w-1/2 bg-gray-200 rounded animate-pulse" />
                      <div className="flex gap-2">
                        <div className="h-5 w-14 bg-gray-200 rounded animate-pulse" />
                        <div className="h-5 w-14 bg-gray-200 rounded animate-pulse" />
                      </div>
                      <div className="h-3 w-full bg-gray-200 rounded animate-pulse" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : viewMode === "rows" ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="overflow-hidden py-0">
                    <CardContent className="p-0">
                      <div className="flex items-center h-16 px-4 gap-4">
                        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                        <div className="h-5 w-14 bg-gray-200 rounded animate-pulse" />
                        <div className="flex-1 h-4 w-1/3 bg-gray-200 rounded animate-pulse" />
                        <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center space-x-4 py-4 border-b border-gray-100"
                  >
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/4 bg-gray-200 rounded animate-pulse" />
                      <div className="h-3 w-1/3 bg-gray-200 rounded animate-pulse" />
                    </div>
                    <div className="w-16 h-5 bg-gray-200 rounded animate-pulse" />
                    <div className="w-20 h-4 bg-gray-200 rounded animate-pulse" />
                    <div className="w-24 h-4 bg-gray-200 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            )
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Ticket className="h-8 w-8 text-gray-400" />
              <span className="text-gray-600 dark:text-gray-400 mt-2 font-medium">
                {t("tickets.empty.title")}
              </span>
              <span className="text-gray-500 text-sm mt-1">
                {hasActiveFilters
                  ? t("tickets.empty.filtered")
                  : t("tickets.empty.noTickets")}
              </span>
              <Link href="/dashboard/tickets/new" className="mt-4">
                <Button size="sm">
                  <Plus className="h-4 w-4 me-2" />
                  {t("tickets.actions.createFirst")}
                </Button>
              </Link>
            </div>
          ) : viewMode === "grid" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {tickets.map((ticket) => (
                  <Card
                    key={ticket._id}
                    className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow p-0"
                    onClick={() =>
                      router.push(`/dashboard/tickets/${ticket._id}`)
                    }
                  >
                    <CardContent className="p-4 space-y-3">
                      <div>
                        <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                          {ticket.title}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                          {ticket.ticketNumber}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <TicketStatusBadge status={ticket.status} />
                        <TicketPriorityBadge priority={ticket.priority} />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                        {ticket.description}
                      </p>
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3 text-gray-400" />
                          <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                            {ticket.tenant?.firstName} {ticket.tenant?.lastName}
                          </span>
                        </div>
                        <span className="text-xs text-gray-400">
                          {formatDate(ticket.createdAt, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                      {ticket.property && (
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3 w-3 text-gray-400" />
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {ticket.property.name}
                          </span>
                        </div>
                      )}
                      {ticket.comments?.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <MessageSquare className="h-3 w-3 text-gray-400" />
                          <span className="text-xs text-gray-500">
                            {ticket.comments.length !== 1
                              ? t("tickets.comments.countPlural").replace(
                                  "{count}",
                                  String(ticket.comments.length),
                                )
                              : t("tickets.comments.count").replace(
                                  "{count}",
                                  String(ticket.comments.length),
                                )}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              {pagination.total > 0 && (
                <GlobalPagination
                  currentPage={filters.page}
                  totalPages={Math.max(
                    1,
                    Math.ceil(pagination.total / filters.limit),
                  )}
                  totalItems={pagination.total}
                  pageSize={filters.limit}
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                  showingLabel={t("tickets.pagination.showing")}
                  previousLabel={t("tickets.pagination.previous")}
                  nextLabel={t("tickets.pagination.next")}
                  itemsPerPageLabel={t("tickets.pagination.perPage")}
                />
              )}
            </>
          ) : viewMode === "rows" ? (
            <>
              <div className="space-y-3">
                {tickets.map((ticket) => (
                  <Card
                    key={ticket._id}
                    className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow py-0"
                    onClick={() =>
                      router.push(`/dashboard/tickets/${ticket._id}`)
                    }
                  >
                    <CardContent className="p-0">
                      <div className="flex items-center gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-mono">
                              {ticket.ticketNumber}
                            </span>
                            <TicketStatusBadge status={ticket.status} />
                            <TicketPriorityBadge priority={ticket.priority} />
                          </div>
                          <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate mt-0.5">
                            {ticket.title}
                          </p>
                        </div>

                        <span className="hidden md:inline text-xs bg-muted px-2 py-1 rounded-full text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          {t(
                            `tickets.category.${ticket.category === "noise_complaint" ? "noiseComplaint" : ticket.category}`,
                          ) || ticket.category}
                        </span>

                        <div className="hidden sm:flex items-center gap-1.5 min-w-0">
                          <User className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                          <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-30">
                            {ticket.tenant?.firstName} {ticket.tenant?.lastName}
                          </span>
                        </div>

                        {ticket.property && (
                          <div className="hidden lg:flex items-center gap-1.5 min-w-0">
                            <Building2 className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-30">
                              {ticket.property.name}
                            </span>
                          </div>
                        )}

                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {formatDate(ticket.createdAt, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>

                        <DropdownMenu>
                          <DropdownMenuTrigger
                            asChild
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/dashboard/tickets/${ticket._id}`);
                              }}
                            >
                              <Eye className="h-4 w-4 me-2" />
                              {t("tickets.actions.viewDetails")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {pagination.total > 0 && (
                <GlobalPagination
                  currentPage={filters.page}
                  totalPages={Math.max(
                    1,
                    Math.ceil(pagination.total / filters.limit),
                  )}
                  totalItems={pagination.total}
                  pageSize={filters.limit}
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                  showingLabel={t("tickets.pagination.showing")}
                  previousLabel={t("tickets.pagination.previous")}
                  nextLabel={t("tickets.pagination.next")}
                  itemsPerPageLabel={t("tickets.pagination.perPage")}
                />
              )}
            </>
          ) : (
            <>
              <DataTable<TicketItem>
                columns={ticketColumns}
                data={tickets}
                loading={loading}
                getRowKey={(ticket) => ticket._id}
                // The headers and the sort menu are one order, which the API
                // applies across every page (the tenant, the building and the
                // author have none there; their headers stay plain). The list
                // always has an order — newest first unless chosen — so a
                // click on the sorted column turns it round.
                sort={{
                  key: filters.sortBy ?? null,
                  direction: filters.sortOrder === "asc" ? "asc" : "desc",
                  onSortChange: (key, direction) => {
                    const next = keepSorted(
                      {
                        key: filters.sortBy ?? "createdAt",
                        direction: filters.sortOrder === "asc" ? "asc" : "desc",
                      },
                      { key, direction },
                    );
                    setFilters((prev) => ({
                      ...prev,
                      sortBy: next.key,
                      sortOrder: next.direction,
                      page: 1,
                    }));
                  },
                }}
                onRowClick={(ticket) =>
                  router.push(`/dashboard/tickets/${ticket._id}`)
                }
                emptyState={{
                  icon: <Ticket className="h-8 w-8 text-gray-400" />,
                  title: t("tickets.empty.title"),
                  description: hasActiveFilters
                    ? t("tickets.empty.filtered")
                    : t("tickets.empty.noTickets"),
                  action: (
                    <Link href="/dashboard/tickets/new">
                      <Button size="sm">
                        <Plus className="h-4 w-4 me-2" />
                        {t("tickets.actions.createFirst")}
                      </Button>
                    </Link>
                  ),
                }}
              />
              {pagination.total > 0 && (
                <GlobalPagination
                  currentPage={filters.page}
                  totalPages={Math.max(
                    1,
                    Math.ceil(pagination.total / filters.limit),
                  )}
                  totalItems={pagination.total}
                  pageSize={filters.limit}
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                  showingLabel={t("tickets.pagination.showing")}
                  previousLabel={t("tickets.pagination.previous")}
                  nextLabel={t("tickets.pagination.next")}
                  itemsPerPageLabel={t("tickets.pagination.perPage")}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
