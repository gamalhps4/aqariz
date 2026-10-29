"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Users,
  Building2,
  DollarSign,
  Activity,
  Settings,
  MoreHorizontal,
  Plus,
  Eye,
  Edit,
  UserCheck,
  UserX,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp,
  Database,
  Server,
  RefreshCw,
} from "lucide-react";
import type {
  AdminDashboardResponse,
  AdminDashboardAlert,
  AdminDashboardUserSummary,
} from "@/lib/services/admin-dashboard.service";
import { UserRole } from "@/types";

const alertColorMap: Record<AdminDashboardAlert["type"], string> = {
  error: "text-red-600",
  warning: "text-orange-500",
  info: "text-blue-600",
};

const alertIconMap: Record<AdminDashboardAlert["type"], typeof AlertTriangle> =
  {
    error: AlertTriangle,
    warning: AlertTriangle,
    info: CheckCircle,
  };

const getRoleVariant = (
  role: string
): "default" | "secondary" | "outline" | "destructive" => {
  switch (role) {
    case UserRole.ADMIN:
      return "destructive";
    case UserRole.MANAGER:
      return "default";
    case UserRole.TENANT:
      return "outline";
    default:
      return "outline";
  }
};

const getStatusVariant = (
  status: string
): "secondary" | "outline" | "destructive" => {
  switch (status) {
    case "active":
      return "secondary";
    case "inactive":
      return "destructive";
    case "pending":
    default:
      return "outline";
  }
};

const getAlertIcon = (type: AdminDashboardAlert["type"]) =>
  alertIconMap[type] ?? Clock;

const getAlertColor = (type: AdminDashboardAlert["type"]) =>
  alertColorMap[type] ?? "text-gray-600";

export default function AdminPage() {
  const router = useRouter();
  const { t, formatCurrency, formatDate } = useLocalizationContext();

  const roleLabelMap = useMemo<Partial<Record<UserRole, string>>>(
    () => ({
      [UserRole.ADMIN]: t("admin.roles.admin"),
      [UserRole.MANAGER]: t("admin.roles.manager"),
      [UserRole.TENANT]: t("admin.roles.tenant"),
    }),
    [t]
  );

  const healthStatusCopy = useMemo(
    () => ({
      healthy: t("admin.health.healthy"),
      degraded: t("admin.health.degraded"),
      unhealthy: t("admin.health.unhealthy"),
    }),
    [t]
  );

  const formatNumber = useCallback((value?: number | null) => {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return undefined;
    }
    return value.toLocaleString("en-US");
  }, []);

  const formatDateOrDefault = useCallback(
    (value?: string | null) => {
      if (!value) {
        return t("admin.noActivityYet");
      }
      return formatDate(value);
    },
    [t, formatDate]
  );
  const [activeTab, setActiveTab] = useState("overview");
  const [dashboardData, setDashboardData] =
    useState<AdminDashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionUserId, setActionUserId] = useState<string | null>(null);

  const loadDashboardData = useCallback(
    async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await fetch("/api/admin/dashboard");

        if (!response.ok) {
          throw new Error(`Failed to load dashboard (${response.status})`);
        }

        const result = await response.json();
        const payload = (result?.data ?? result) as AdminDashboardResponse;

        if (!payload?.stats) {
          throw new Error("Invalid dashboard response");
        }

        setDashboardData(payload);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("errors.ui.loadFailed", { defaultValue: "Could not load this. Try again." });
        setError(message);
      } finally {
        if (isRefresh) {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [t]
  );

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const recentUsers = useMemo(
    () => dashboardData?.recentUsers?.slice(0, 6) ?? [],
    [dashboardData]
  );

  // The badge's words (the users table below), which its column sorts by.
  const userStatusText = (status?: string) =>
    status === "active"
      ? t("admin.status.active")
      : status === "inactive"
      ? t("admin.status.inactive")
      : t("admin.status.pending");

  const userSort = useTableSort(recentUsers, {
    user: (user) => user.name,
    role: (user) => roleLabelMap[user.role as UserRole] ?? user.role,
    status: (user) => userStatusText(user.status),
    properties: (user) => user.properties ?? 0,
    // No sign-in yet shows as words: blank to the sort, last both ways.
    lastActivity: (user) => (user.lastLogin ? new Date(user.lastLogin) : null),
  });

  const alerts = useMemo(
    () => dashboardData?.alerts?.slice(0, 6) ?? [],
    [dashboardData]
  );

  const handleRefresh = useCallback(() => {
    loadDashboardData({ isRefresh: true });
  }, [loadDashboardData]);

  const handleToggleUserStatus = useCallback(
    async (userId: string, shouldActivate: boolean) => {
      try {
        setActionUserId(userId);
        const response = await fetch(`/api/users/${userId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isActive: shouldActivate }),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            result?.error || result?.message || "Unable to update user"
          );
        }

        toast.success(
          shouldActivate
            ? t("admin.users.userActivated")
            : t("admin.users.userSuspended")
        );
        await loadDashboardData({ isRefresh: true });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("admin.users.updateFailed");
        toast.error(message);
      } finally {
        setActionUserId(null);
      }
    },
    [loadDashboardData, t]
  );

  // const handleDeleteUser = useCallback(
  //   async (userId: string) => {
  //     try {
  //       setActionUserId(userId);
  //       const response = await fetch(`/api/users/${userId}`, {
  //         method: "DELETE",
  //       });

  //       const result = await response.json().catch(() => ({}));

  //       if (!response.ok) {
  //         throw new Error(
  //           result?.error || result?.message || "Unable to deactivate user"
  //         );
  //       }

  //       toast.success("User deactivated successfully");
  //       await loadDashboardData({ isRefresh: true });
  //     } catch (err) {
  //       const message =
  //         err instanceof Error ? err.message : "Failed to deactivate user";
  //       toast.error(message);
  //     } finally {
  //       setActionUserId(null);
  //     }
  //   },
  //   [loadDashboardData]
  // );

  const systemStats = dashboardData?.stats;
  const systemStatus = dashboardData?.systemStatus;
  const databaseStatus = systemStatus?.databaseStatus;
  const maintenanceOpen = systemStats?.maintenanceOpen ?? 0;
  const isInitialLoading = isLoading && !dashboardData;

  const renderStatValue = (value?: string) =>
    value ? (
      <div className="text-2xl font-bold">{value}</div>
    ) : (
      <Skeleton className="h-7 w-16" />
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("admin.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("admin.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing || isInitialLoading}
            title={t("admin.refreshDashboard")}
            aria-label={t("admin.refreshDashboard")}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/dashboard/settings">
              <Settings className="me-2 h-4 w-4" />
              {t("admin.systemSettings")}
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/dashboard/admin/users/new">
              <Plus className="me-2 h-4 w-4" />
              {t("admin.addUser")}
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("admin.dashboardUnavailable")}</AlertTitle>
          <AlertDescription>
            {t("admin.dashboardError", { values: { error } })}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card className="gap-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.stats.totalUsers")}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {renderStatValue(formatNumber(systemStats?.totalUsers))}
            <div className="text-xs text-muted-foreground">
              {systemStats ? (
                t("admin.stats.totalUsersActive", {
                  values: {
                    count: formatNumber(systemStats.activeUsers) ?? "0",
                  },
                })
              ) : (
                <Skeleton className="h-3 w-20" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.stats.properties")}
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {renderStatValue(formatNumber(systemStats?.totalProperties))}
            <div className="text-xs text-muted-foreground">
              {systemStats ? (
                t("admin.stats.propertiesActive", {
                  values: {
                    count: formatNumber(systemStats.activeProperties) ?? "0",
                  },
                })
              ) : (
                <Skeleton className="h-3 w-20" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.stats.totalRevenue")}
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {renderStatValue(formatCurrency(systemStats?.totalRevenue ?? 0))}
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {t("admin.stats.last30Days", {
                values: {
                  amount: systemStats
                    ? formatCurrency(systemStats.revenueLast30 ?? 0)
                    : "...",
                },
              })}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.stats.systemHealth")}
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {renderStatValue(
              systemStatus ? `${systemStatus.score}%` : undefined
            )}
            <div className="text-xs text-muted-foreground">
              {systemStatus ? (
                healthStatusCopy[systemStatus.status]
              ) : (
                <Skeleton className="h-3 w-24" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.stats.activeSessions")}
            </CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {renderStatValue(formatNumber(systemStats?.activeSessions))}
            <div className="text-xs text-muted-foreground">
              {systemStats ? (
                t("admin.stats.last24Hours")
              ) : (
                <Skeleton className="h-3 w-16" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.stats.database")}
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {databaseStatus ? (
              <div
                className={`text-2xl font-bold ${
                  databaseStatus.status === "online"
                    ? "text-green-600"
                    : databaseStatus.status === "degraded"
                    ? "text-orange-500"
                    : "text-red-600"
                }`}
              >
                {databaseStatus.status === "online"
                  ? t("admin.stats.dbOnline")
                  : databaseStatus.status === "degraded"
                  ? t("admin.stats.dbDegraded")
                  : t("admin.stats.dbOffline")}
              </div>
            ) : (
              <Skeleton className="h-7 w-16" />
            )}
            <div className="text-xs text-muted-foreground">
              {databaseStatus ? (
                databaseStatus.label
              ) : (
                <Skeleton className="h-3 w-24" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="overview">{t("admin.tabs.overview")}</TabsTrigger>
          <TabsTrigger value="users">{t("admin.tabs.users")}</TabsTrigger>
          <TabsTrigger value="settings">{t("admin.tabs.settings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("admin.overview.recentActivity")}</CardTitle>
                <CardDescription>
                  {t("admin.overview.recentActivityDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {isInitialLoading && (
                    <>
                      {Array.from({ length: 3 }).map((_, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center space-x-3">
                            <Skeleton className="h-8 w-8 rounded-full" />
                            <div className="space-y-1">
                              <Skeleton className="h-4 w-32" />
                              <Skeleton className="h-3 w-40" />
                            </div>
                          </div>
                          <Skeleton className="h-3 w-20" />
                        </div>
                      ))}
                    </>
                  )}

                  {!isInitialLoading && recentUsers.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("admin.overview.noActivity")}
                    </p>
                  )}

                  {recentUsers?.map((user) => (
                    <div
                      key={user?.id}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                          <Users className="h-4 w-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{user?.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {user?.email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("admin.overview.propertiesLinked", {
                              values: { count: user?.properties ?? 0 },
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="text-end space-y-1">
                        <Badge
                          variant={getRoleVariant(user?.role ?? "")}
                          className="capitalize"
                        >
                          {roleLabelMap[user?.role as UserRole] ?? user?.role}
                        </Badge>
                        <p className="text-xs text-muted-foreground">
                          {formatDateOrDefault(user?.lastLogin)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("admin.overview.systemAlerts")}</CardTitle>
                <CardDescription>
                  {t("admin.overview.systemAlertsDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {isInitialLoading && (
                    <>
                      {Array.from({ length: 3 }).map((_, idx) => (
                        <div key={idx} className="flex items-start space-x-3">
                          <Skeleton className="h-4 w-4" />
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-3 w-28" />
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {!isInitialLoading && alerts.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("admin.overview.noAlerts")}
                    </p>
                  )}

                  {alerts?.map((alert) => {
                    const Icon = getAlertIcon(alert?.type);
                    return (
                      <div
                        key={alert?.id}
                        className="flex items-start space-x-3"
                      >
                        <Icon
                          className={`h-4 w-4 mt-0.5 ${getAlertColor(
                            alert?.type
                          )}`}
                        />
                        <div className="flex-1">
                          <p className="text-sm">{alert?.message}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(alert?.timestamp ?? "")} •{" "}
                            {alert?.source}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
              <div className="space-y-1.5">
                <CardTitle>{t("admin.users.recentTitle")}</CardTitle>
                <CardDescription>
                  {t("admin.users.recentDescription")}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/admin/users">
                  <Users className="me-2 h-4 w-4" />
                  {t("admin.users.viewAll")}
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead sort={userSort} column="user">
                      {t("admin.users.tableUser")}
                    </SortableTableHead>
                    <SortableTableHead sort={userSort} column="role">
                      {t("admin.users.tableRole")}
                    </SortableTableHead>
                    <SortableTableHead sort={userSort} column="status">
                      {t("admin.users.tableStatus")}
                    </SortableTableHead>
                    <SortableTableHead sort={userSort} column="properties">
                      {t("admin.users.tableProperties")}
                    </SortableTableHead>
                    <SortableTableHead sort={userSort} column="lastActivity">
                      {t("admin.users.tableLastActivity")}
                    </SortableTableHead>
                    <TableHead className="text-end">
                      {t("admin.users.tableActions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isInitialLoading && (
                    <>
                      {Array.from({ length: 4 }).map((_, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="mt-1 h-3 w-32" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-6 w-16" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-6 w-16" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-10" />
                          </TableCell>
                          <TableCell>
                            <Skeleton className="h-4 w-24" />
                          </TableCell>
                          <TableCell className="text-end">
                            <Skeleton className="h-8 w-8 rounded-md" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}

                  {!isInitialLoading && recentUsers.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-sm text-muted-foreground"
                      >
                        {t("admin.users.noData")}
                      </TableCell>
                    </TableRow>
                  )}

                  {userSort.rows.map((user: AdminDashboardUserSummary) => (
                    <TableRow key={user?.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{user?.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {user?.email}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getRoleVariant(user?.role ?? "")}
                          className="capitalize"
                        >
                          {roleLabelMap[user?.role as UserRole] ?? user?.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusVariant(user?.status ?? "")}
                          className="capitalize"
                        >
                          {userStatusText(user?.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>{user?.properties ?? 0}</TableCell>
                      <TableCell>
                        {formatDateOrDefault(user?.lastLogin)}
                      </TableCell>
                      <TableCell className="text-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              aria-label={t("admin.users.actionsLabel")}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>
                              {t("admin.users.actionsLabel")}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onSelect={(event) => {
                                event.preventDefault();
                                router.push(
                                  `/dashboard/admin/users/${user?.id}`
                                );
                              }}
                            >
                              <Eye className="me-2 h-4 w-4" />
                              {t("admin.users.viewDetails")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={(event) => {
                                event.preventDefault();
                                router.push(
                                  `/dashboard/admin/users/${user?.id}/edit`
                                );
                              }}
                            >
                              <Edit className="me-2 h-4 w-4" />
                              {t("admin.users.editUser")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {user?.status === "active" ? (
                              <DropdownMenuItem
                                disabled={actionUserId === user?.id}
                                onSelect={(event) => {
                                  event.preventDefault();
                                  handleToggleUserStatus(user?.id ?? "", false);
                                }}
                                className="text-orange-600"
                              >
                                <UserX className="me-2 h-4 w-4" />
                                {t("admin.users.suspendUser")}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                disabled={actionUserId === user?.id}
                                onSelect={(event) => {
                                  event.preventDefault();
                                  handleToggleUserStatus(user?.id ?? "", true);
                                }}
                                className="text-green-600"
                              >
                                <UserCheck className="me-2 h-4 w-4" />
                                {t("admin.users.activateUser")}
                              </DropdownMenuItem>
                            )}
                            {/* <DeleteConfirmationDialog
                              itemName={user.name}
                              itemType="user"
                              onConfirm={() => handleDeleteUser(user.id)}
                              loading={actionUserId === user.id}
                            >
                              <DropdownMenuItem
                                onSelect={(event) => event.preventDefault()}
                                className="text-red-600"
                              >
                                <Trash2 className="me-2 h-4 w-4" />
                                Deactivate User
                              </DropdownMenuItem>
                            </DeleteConfirmationDialog> */}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("admin.settings.snapshot")}</CardTitle>
              <CardDescription>
                {t("admin.settings.snapshotDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">
                    {t("admin.settings.maintenanceOpen")}
                  </p>
                  <p className="text-2xl font-bold">
                    {formatNumber(maintenanceOpen) ?? "--"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.maintenanceOpenDesc")}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">
                    {t("admin.settings.databaseStatus")}
                  </p>
                  <p className="text-2xl font-bold">
                    {databaseStatus
                      ? databaseStatus.status === "online"
                        ? t("admin.settings.dbConnected")
                        : databaseStatus.status === "degraded"
                        ? t("admin.stats.dbDegraded")
                        : t("admin.stats.dbOffline")
                      : "--"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {databaseStatus?.label ??
                      t("admin.settings.dbAwaitingCheck")}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">
                    {t("admin.settings.totalRevenueYTD")}
                  </p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(systemStats?.totalRevenue ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.totalRevenueDesc")}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium">
                    {t("admin.settings.activeUserAccounts")}
                  </p>
                  <p className="text-2xl font-bold">
                    {formatNumber(systemStats?.activeUsers) ?? "--"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.settings.activeUserAccountsDesc")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
