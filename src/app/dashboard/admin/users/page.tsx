"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/ui/global-search";
import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { ReportExportButton } from "@/components/reports/export-button";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

import {
  Users,
  UserPlus,
  MoreHorizontal,
  Eye,
  Edit,
  Ban,
  Trash2,
  Grid3X3,
  List,
  RefreshCw,
  Shield,
  Mail,
  Phone,
  Calendar,
  CheckCircle,
  XCircle,
  MapPin,
} from "lucide-react";
import { UserRole, IUser } from "@/types";
import { formatDate } from "@/lib/utils";
import { RoleBadge } from "@/components/ui/role-badge";
import { BulkOperations } from "@/components/users/bulk-operations";
import { PendingInvitations } from "@/components/users/pending-invitations";
import { useViewPreferencesStore } from "@/stores/view-preferences.store";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useGroupNames } from "@/hooks/useGroupNames";

// interface UserListPageProps {}

interface UserStats {
  total: number;
  active: number;
  inactive: number;
  byRole: Record<UserRole.ADMIN | UserRole.MANAGER | UserRole.TENANT, number>;
}

export default function UserListPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { t } = useLocalizationContext();
  const {
    canManageUsers,
    canViewUsers,
    canCreateUsers,
    canEditUsers,
    canDeleteUsers,
    canExportUsers,
    canManageRoles,
  } = useAuthorization();
  const { roleName } = useGroupNames();
  // A user's role by its name: the list sends each group's names beside its
  // stored key, which for a group named in Arabic is "group" or "group_2".
  const userRoleName = (user: IUser) =>
    roleName(
      user.role,
      user.roleLabel ? { label: user.roleLabel, labelAr: user.roleLabelAr } : null,
    );

  // State management
  const [users, setUsers] = useState<IUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [availableRoles, setAvailableRoles] = useState<
    { name: string; label: string; isSystem: boolean }[]
  >([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const viewMode = useViewPreferencesStore((state) => state.usersView);
  const setViewMode = useViewPreferencesStore((state) => state.setUsersView);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [userToRemove, setUserToRemove] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [stats, setStats] = useState<UserStats>({
    total: 0,
    active: 0,
    inactive: 0,
    byRole: {
      [UserRole.ADMIN]: 0,
      [UserRole.MANAGER]: 0,
      [UserRole.TENANT]: 0,
    },
  });

  // Handler for debounced search from GlobalSearch component
  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    setCurrentPage(1); // Reset to first page on search
  }, []);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);

  // Check permissions for single company architecture
  const paginationPageSizeOptions = Array.from(
    new Set([12, 20, 50, 100, ...(canManageUsers ? [1000] : []), itemsPerPage]),
  ).sort((a, b) => a - b);

  // Fetch users
  const fetchUsers = async () => {
    try {
      // Only show main loading on initial load
      if (!searchTerm) {
        setIsLoading(true);
      }
      setIsSearching(true);

      // Build query parameters
      const params = new URLSearchParams();
      params.append("page", currentPage.toString());
      params.append("limit", itemsPerPage.toString());

      if (searchTerm) {
        params.append("search", searchTerm);
      }

      if (roleFilter && roleFilter !== "all") {
        params.append("role", roleFilter);
      }

      if (statusFilter && statusFilter !== "all") {
        params.append("isActive", statusFilter === "active" ? "true" : "false");
      }

      // The Employees list: the office's own staff. Owners and tenants are
      // clients — they have their own lists under Client Affairs — and owners
      // used to appear here because only tenants were excluded.
      params.append("excludeTenant", "true");
      params.append("companyStaffOnly", "true");
      const response = await fetch(`/api/users?${params}`);

      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }

      const data = await response.json();
      // Handle both response formats: direct data or nested data
      const responseData = data?.data ?? data ?? {};
      const usersArrayRaw = (responseData.users ?? []) as IUser[];
      const usersArray = usersArrayRaw;
      const pagination = responseData.pagination ?? {};
      // Update current page data
      setUsers(usersArray);
      // Keep initial pages from API as a fallback until stats recalculates totals
      setTotalPages(pagination.pages ?? 1);

      // Fetch all users for stats calculation (without pagination)
      const statsParams = new URLSearchParams();
      if (searchTerm) {
        statsParams.append("search", searchTerm);
      }
      if (roleFilter && roleFilter !== "all") {
        statsParams.append("role", roleFilter);
      }
      if (statusFilter && statusFilter !== "all") {
        statsParams.append(
          "isActive",
          statusFilter === "active" ? "true" : "false",
        );
      }
      // Get all users for stats (set a high limit)
      statsParams.append("limit", "10000");
      statsParams.append("page", "1");

      statsParams.append("excludeTenant", "true");
      statsParams.append("companyStaffOnly", "true");
      const statsResponse = await fetch(`/api/users?${statsParams}`);
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        // Handle both response formats: direct data or nested data
        const statsResponseData = statsData?.data ?? statsData ?? {};
        const allUsers = statsResponseData.users ?? [];

        // Calculate stats from all users (server excludes tenants when requested)
        const safeUsers = Array.isArray(allUsers) ? allUsers : [];
        const newStats: UserStats = {
          total: safeUsers.length,
          active: safeUsers.filter((u: IUser) => u.isActive).length,
          inactive: safeUsers.filter((u: IUser) => !u.isActive).length,
          byRole: {
            [UserRole.ADMIN]: safeUsers.filter(
              (u: IUser) => u.role === UserRole.ADMIN,
            ).length,
            [UserRole.MANAGER]: safeUsers.filter(
              (u: IUser) => u.role === UserRole.MANAGER,
            ).length,
            [UserRole.TENANT]: 0, // Always 0 for users page
          },
        };
        setStats(newStats);
        setTotalUsers(newStats.total);
        setTotalPages(Math.max(1, Math.ceil(newStats.total / itemsPerPage)));

        const firstWithRole = new Map<string, IUser>();
        for (const entry of safeUsers as IUser[]) {
          if (entry.role && !firstWithRole.has(entry.role)) {
            firstWithRole.set(entry.role, entry);
          }
        }
        const derivedRoles = Array.from(firstWithRole.entries())
          .filter(([name]) => name !== UserRole.TENANT)
          .map(([name, entry]) => ({
            name,
            label: userRoleName(entry),
            isSystem: (Object.values(UserRole) as string[]).includes(name),
          }));
        setAvailableRoles((prev) => {
          const map = new Map(prev.map((r) => [r.name, r]));
          for (const r of derivedRoles) {
            if (!map.has(r.name)) map.set(r.name, r);
          }
          return Array.from(map.values());
        });
      }
    } catch (error) {
      toast.error(t("admin.usersPage.toast.loadFailed"));
    } finally {
      setIsLoading(false);
      setIsSearching(false);
    }
  };

  // Effects
  useEffect(() => {
    if (canViewUsers) {
      fetchUsers();
    }
  }, [
    currentPage,
    itemsPerPage,
    searchTerm,
    roleFilter,
    statusFilter,
    canViewUsers,
  ]);

  useEffect(() => {
    const loadRoles = async () => {
      try {
        const res = await fetch("/api/roles?includeSystem=true");
        if (!res.ok) {
          setAvailableRoles([
            {
              name: UserRole.ADMIN,
              label: t("admin.roles.defaultRoles.admin.label"),
              isSystem: true,
            },
            {
              name: UserRole.MANAGER,
              label: t("admin.roles.defaultRoles.manager.label"),
              isSystem: true,
            },
          ]);
          return;
        }
        const data = await res.json();
        const rolesRaw = data?.data?.roles ?? data?.roles ?? [];
        const mapped = rolesRaw
          .filter((r: any) => r?.isActive)
          .map((r: any) => ({
            name: r.name,
            label: roleName(
              r.name,
              r.isSystem ? null : { label: r.label, labelAr: r.labelAr },
            ),
            isSystem: !!r.isSystem,
          }));
        setAvailableRoles(mapped);
      } catch {
        setAvailableRoles([
          {
            name: UserRole.ADMIN,
            label: t("admin.roles.defaultRoles.admin.label"),
            isSystem: true,
          },
          {
            name: UserRole.MANAGER,
            label: t("admin.roles.defaultRoles.manager.label"),
            isSystem: true,
          },
        ]);
      }
    };
    // Only a caller with Manage roles may list the roles; everyone else
    // names them from the users the list returns.
    if (canViewUsers && canManageRoles) loadRoles();
  }, [canViewUsers, canManageRoles, t, roleName]);

  // Handle user deactivation
  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      setIsDeleting(true);
      const response = await fetch(`/api/users/${userToDelete}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.message || data?.error || "Failed to deactivate user",
        );
      }

      toast.success(t("admin.usersPage.toast.deactivateSuccess"));
      fetchUsers(); // Refresh the list
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin.usersPage.toast.deactivateFailed"),
      );
    } finally {
      setIsDeleting(false);
      setUserToDelete(null);
    }
  };

  // Handle permanent user removal (soft-delete: removes from listings)
  const handleRemoveUser = async () => {
    if (!userToRemove) return;

    try {
      setIsRemoving(true);
      const response = await fetch(`/api/users/${userToRemove}?permanent=true`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.message || data?.error || "Failed to delete user",
        );
      }

      toast.success(t("admin.usersPage.toast.deleteSuccess"));
      fetchUsers(); // Refresh the list
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin.usersPage.toast.deleteFailed"),
      );
    } finally {
      setIsRemoving(false);
      setUserToRemove(null);
    }
  };

  // Handle bulk operations
  // const handleBulkDelete = async () => {
  //   try {
  //     const response = await fetch(
  //       `/api/users?ids=${selectedUsers.join(",")}`,
  //       {
  //         method: "DELETE",
  //       }
  //     );

  //     if (!response.ok) {
  //       throw new Error("Failed to delete users");
  //     }

  //     toast.success(`${selectedUsers.length} users deactivated successfully`);
  //     setSelectedUsers([]);
  //     fetchUsers();
  //   } catch (error) {
  //     toast.error("Failed to deactivate users");
  //   }
  // };

  // Access control check
  if (!canViewUsers) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold">
            {t("admin.usersPage.accessDenied")}
          </h3>
          <p className="text-muted-foreground">
            {t("admin.usersPage.accessDeniedDesc")}
          </p>
        </div>
      </div>
    );
  }

  // An employee limited to some buildings, marked where their role is shown
  // so nobody wonders why they see less than a colleague in the same group.
  const restrictedMark = (user: IUser) =>
    user.scopeRestricted ? (
      <Badge
        variant="outline"
        className="gap-1 text-xs font-normal"
        title={t("admin.usersPage.restrictedHint", {
          defaultValue: "Sees only the compounds and buildings assigned to them",
        })}
      >
        <MapPin className="h-3 w-3" />
        {t("admin.usersPage.restricted", { defaultValue: "Assigned buildings" })}
      </Badge>
    ) : null;

  // Define columns for DataTable
  const userColumns: DataTableColumn<IUser>[] = [
    {
      id: "number",
      header: "#",
      cell: (user) => (
        <span className="text-center text-sm text-muted-foreground">
          {(currentPage - 1) * itemsPerPage + (users || []).indexOf(user) + 1}
        </span>
      ),
    },
    {
      id: "user",
      header: t("admin.usersPage.table.user"),
      cell: (user) => (
        <Link
          href={`/dashboard/admin/users/${user._id}`}
          className="group inline-flex items-center space-x-3 text-foreground transition-colors"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.avatar || ""} />
            <AvatarFallback>
              {user.firstName[0]}
              {user.lastName[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {user.firstName} {user.lastName}
            </div>
            <div className="text-sm text-muted-foreground">{user.email}</div>
          </div>
        </Link>
      ),
    },
    {
      id: "role",
      header: t("admin.usersPage.table.role"),
      cell: (user) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <RoleBadge role={user.role} label={userRoleName(user)} />
          {restrictedMark(user)}
        </div>
      ),
    },
    {
      id: "status",
      header: t("admin.usersPage.table.status"),
      cell: (user) => (
        <Badge variant={user.isActive ? "default" : "secondary"}>
          {user.isActive
            ? t("admin.usersPage.table.active")
            : t("admin.usersPage.table.inactive")}
        </Badge>
      ),
    },
    {
      id: "contact",
      header: t("admin.usersPage.table.contact"),
      visibility: "lg" as const,
      cell: (user) => (
        <div className="space-y-1">
          {user.phone && (
            <div className="flex items-center text-sm text-muted-foreground">
              <Phone className="h-3 w-3 me-1" />
              {user.phone}
            </div>
          )}
          <div className="flex items-center text-sm text-muted-foreground">
            <Mail className="h-3 w-3 me-1" />
            {user.email}
          </div>
        </div>
      ),
    },
    {
      id: "created",
      header: t("admin.usersPage.table.created"),
      visibility: "md" as const,
      cell: (user) => (
        <div className="flex items-center text-sm text-muted-foreground">
          <Calendar className="h-3 w-3 me-1" />
          {formatDate(user.createdAt)}
        </div>
      ),
    },
    {
      id: "actions",
      header: t("admin.usersPage.table.actions"),
      align: "right" as const,
      cell: (user) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {t("admin.usersPage.table.actionsMenu")}
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => router.push(`/dashboard/admin/users/${user._id}`)}
            >
              <Eye className="me-2 h-4 w-4" />
              {t("admin.usersPage.table.viewDetails")}
            </DropdownMenuItem>
            {canEditUsers && (
              <DropdownMenuItem
                onClick={() =>
                  router.push(`/dashboard/admin/users/${user._id}/edit`)
                }
              >
                <Edit className="me-2 h-4 w-4" />
                {t("admin.usersPage.table.editUser")}
              </DropdownMenuItem>
            )}
            {canDeleteUsers && (
              <>
                {user._id.toString() !== session?.user?.id && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setUserToDelete(user._id.toString());
                        setShowDeleteDialog(true);
                      }}
                    >
                      <Ban className="me-2 h-4 w-4" />
                      {t("admin.usersPage.table.deactivateUser")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-600 focus:text-red-600"
                      onClick={() => {
                        setUserToRemove(user._id.toString());
                        setShowRemoveDialog(true);
                      }}
                    >
                      <Trash2 className="me-2 h-4 w-4" />
                      {t("admin.usersPage.table.deleteUser")}
                    </DropdownMenuItem>
                  </>
                )}
              </>
            )}
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
            {t("admin.usersPage.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("admin.usersPage.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchUsers()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 me-2 ${isLoading ? "animate-spin" : ""}`}
            />
            {t("admin.usersPage.refresh")}
          </Button>
          {/* The list as filtered on screen — staff only, like the list. */}
          {canExportUsers && (
          <ReportExportButton
            endpoint="/api/users"
            params={
              new URLSearchParams({
                excludeTenant: "true",
                companyStaffOnly: "true",
                ...(searchTerm ? { search: searchTerm } : {}),
                ...(roleFilter && roleFilter !== "all"
                  ? { role: roleFilter }
                  : {}),
                ...(statusFilter && statusFilter !== "all"
                  ? { isActive: statusFilter === "active" ? "true" : "false" }
                  : {}),
              })
            }
            disabled={users.length === 0}
          />
          )}
          {canManageUsers && selectedUsers.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowBulkDialog(true)}
            >
              <Users className="h-4 w-4 me-2" />
              {t("admin.usersPage.bulkActions")} ({selectedUsers.length})
            </Button>
          )}
          {canManageRoles && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push("/dashboard/admin/users/roles")}
            >
              <Shield className="h-4 w-4 me-2" />
              {t("admin.usersPage.manageRoles")}
            </Button>
          )}
          {canCreateUsers && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push("/dashboard/admin/users/new")}
            >
              <UserPlus className="h-4 w-4 me-2" />
              {t("admin.usersPage.addUser")}
            </Button>
          )}
        </div>
      </div>

      {/* Invitations. Inviting is the preferred way to add staff — the
          create-user form above sets a password on someone else's behalf. */}
      <PendingInvitations canManage={canCreateUsers} />

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="gap-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.usersPage.stats.totalUsers")}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">
              {t("admin.usersPage.stats.totalUsersDesc")}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.usersPage.stats.activeUsers")}
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {stats.active}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("admin.usersPage.stats.activeUsersDesc")}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.usersPage.stats.inactiveUsers")}
            </CardTitle>
            <XCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {stats.inactive}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("admin.usersPage.stats.inactiveUsersDesc")}
            </p>
          </CardContent>
        </Card>
        <Card className="gap-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.usersPage.stats.admins")}
            </CardTitle>
            <Shield className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {stats.byRole[UserRole.ADMIN] + stats.byRole[UserRole.MANAGER]}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("admin.usersPage.stats.adminsDesc")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* User List with Integrated Header and Filters */}
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
                  {t("admin.usersPage.list.title")} ({totalUsers})
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("admin.usersPage.list.showing", {
                    values: {
                      count: (users || []).length,
                      page: currentPage,
                      total: totalPages,
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
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className="h-8 flex-1 sm:flex-none sm:px-3"
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Integrated Filters Bar */}
          <div className="flex flex-col gap-4 p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg border border-gray-200/60 dark:border-gray-700/60">
            {/* Search and Filters Row */}
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Global Search Component with 300ms debounce */}
              <GlobalSearch
                placeholder={t("admin.usersPage.filters.searchPlaceholder")}
                initialValue={searchTerm}
                debounceDelay={300}
                onSearch={handleSearch}
                isLoading={isSearching}
                className="flex-1"
                ariaLabel={t("search.users", { defaultValue: "Search employees" })}
              />

              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="h-10 w-full sm:w-[160px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("admin.usersPage.filters.allRoles")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("admin.usersPage.filters.allRoles")}
                  </SelectItem>
                  {(availableRoles.length
                    ? availableRoles
                    : [
                        {
                          name: UserRole.ADMIN,
                          label: t("admin.usersPage.filters.superAdmin"),
                          isSystem: true,
                        },
                        {
                          name: UserRole.MANAGER,
                          label: t("admin.usersPage.filters.propertyManager"),
                          isSystem: true,
                        },
                      ]
                  )
                    .filter(
                      (r) =>
                        r.name !== UserRole.TENANT && r.name !== UserRole.OWNER,
                    )
                    .map((role) => (
                      <SelectItem key={role.name} value={role.name}>
                        {role.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 w-full sm:w-[140px] border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <SelectValue
                    placeholder={t("admin.usersPage.filters.allStatus")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("admin.usersPage.filters.allStatus")}
                  </SelectItem>
                  <SelectItem value="active">
                    {t("admin.usersPage.filters.active")}
                  </SelectItem>
                  <SelectItem value="inactive">
                    {t("admin.usersPage.filters.inactive")}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Clear Button - only show when filters are active */}
              {(searchTerm ||
                roleFilter !== "all" ||
                statusFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setRoleFilter("all");
                    setStatusFilter("all");
                  }}
                  className="h-10 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  <XCircle className="h-4 w-4 me-2" />
                  {t("admin.usersPage.selection.clearSelection") || "Clear"}
                </Button>
              )}
            </div>
          </div>

          {/* Bulk Selection Bar */}
          {selectedUsers.length > 0 && canManageUsers && (
            <div className="mt-4 px-4 py-3 bg-muted/50 rounded-lg border">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {t("admin.usersPage.selection.selected", {
                    values: { count: selectedUsers.length },
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedUsers([])}
                  >
                    {t("admin.usersPage.selection.clearSelection")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="h-16 bg-muted rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : (users || []).length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {t("admin.usersPage.list.noUsers")}
              </h3>
              <p className="text-muted-foreground mb-4">
                {(users || []).length === 0
                  ? t("admin.usersPage.list.noUsersCreated")
                  : t("admin.usersPage.list.noUsersMatch")}
              </p>

              {canCreateUsers && (users || []).length === 0 && (
                <Button
                  onClick={() => router.push("/dashboard/admin/users/new")}
                >
                  <UserPlus className="h-4 w-4 me-2" />
                  {t("admin.usersPage.list.addFirstUser")}
                </Button>
              )}
            </div>
          ) : viewMode === "table" ? (
            <div className="space-y-4">
              <DataTable<IUser>
                columns={userColumns}
                data={users || []}
                getRowKey={(user) => user._id.toString()}
                loading={isLoading}
                selection={
                  canManageUsers
                    ? {
                        enabled: true,
                        selectedIds: selectedUsers,
                        onSelectRow: (id: string, checked: boolean) => {
                          if (checked) {
                            setSelectedUsers([...selectedUsers, id]);
                          } else {
                            setSelectedUsers(
                              selectedUsers.filter((uid) => uid !== id),
                            );
                          }
                        },
                        onSelectAll: (checked: boolean) => {
                          if (checked) {
                            setSelectedUsers(
                              (users || []).map((u: IUser) => u._id.toString()),
                            );
                          } else {
                            setSelectedUsers([]);
                          }
                        },
                        getRowId: (user: IUser) => user._id.toString(),
                      }
                    : undefined
                }
                emptyState={{
                  icon: <Users className="h-12 w-12 text-muted-foreground" />,
                  title: t("admin.usersPage.list.noUsers"),
                  description: t("admin.usersPage.list.noUsersMatch"),
                }}
                striped
              />
            </div>
          ) : (
            // Grid view
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {(users || []).map((user: IUser) => (
                  <Card key={user._id.toString()} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <Avatar className="h-12 w-12">
                            <AvatarImage src={user.avatar || ""} />
                            <AvatarFallback className="bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
                              {user.firstName[0]}
                              {user.lastName[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                              {user.firstName} {user.lastName}
                            </h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {user.email}
                            </p>
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>
                              {t("admin.usersPage.table.actionsMenu")}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(
                                  `/dashboard/admin/users/${user._id}`,
                                )
                              }
                            >
                              <Eye className="me-2 h-4 w-4" />
                              {t("admin.usersPage.table.viewDetails")}
                            </DropdownMenuItem>
                            {canEditUsers && (
                              <DropdownMenuItem
                                onClick={() =>
                                  router.push(
                                    `/dashboard/admin/users/${user._id}/edit`,
                                  )
                                }
                              >
                                <Edit className="me-2 h-4 w-4" />
                                {t("admin.usersPage.table.editUser")}
                              </DropdownMenuItem>
                            )}
                            {canDeleteUsers &&
                              user._id.toString() !== session?.user?.id && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setUserToDelete(user._id.toString());
                                      setShowDeleteDialog(true);
                                    }}
                                  >
                                    <Ban className="me-2 h-4 w-4" />
                                    {t("admin.usersPage.table.deactivateUser")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-red-600 focus:text-red-600"
                                    onClick={() => {
                                      setUserToRemove(user._id.toString());
                                      setShowRemoveDialog(true);
                                    }}
                                  >
                                    <Trash2 className="me-2 h-4 w-4" />
                                    {t("admin.usersPage.table.deleteUser")}
                                  </DropdownMenuItem>
                                </>
                              )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <RoleBadge
                              role={user.role}
                              label={userRoleName(user)}
                            />
                            {restrictedMark(user)}
                          </div>
                          <Badge
                            variant={user.isActive ? "default" : "secondary"}
                          >
                            {user.isActive
                              ? t("admin.usersPage.table.active")
                              : t("admin.usersPage.table.inactive")}
                          </Badge>
                        </div>
                        {user.phone && (
                          <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                            <Phone className="h-3 w-3 me-2" />
                            {user.phone}
                          </div>
                        )}
                        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                          <Calendar className="h-3 w-3 me-2" />
                          {formatDate(user.createdAt)}
                        </div>
                      </div>
                      {canManageUsers && (
                        <div className="mt-3 pt-3 border-t flex items-center">
                          <Checkbox
                            checked={selectedUsers.includes(
                              user._id.toString(),
                            )}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedUsers([
                                  ...selectedUsers,
                                  user._id.toString(),
                                ]);
                              } else {
                                setSelectedUsers(
                                  selectedUsers.filter(
                                    (id) => id !== user._id.toString(),
                                  ),
                                );
                              }
                            }}
                          />
                          <span className="ms-2 text-sm text-gray-500 dark:text-gray-400">
                            {t("admin.usersPage.selection.selectUser") ||
                              "Select user"}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {totalUsers > 0 && (
            <GlobalPagination
              currentPage={currentPage}
              totalPages={Math.max(1, totalPages)}
              totalItems={totalUsers}
              pageSize={itemsPerPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={setItemsPerPage}
              pageSizeOptions={paginationPageSizeOptions}
              showingLabel={t("common.showing", { defaultValue: "Showing" })}
              previousLabel={t("common.previous", {
                defaultValue: "Previous",
              })}
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

      {/* Deactivate Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.usersPage.deactivateDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.usersPage.deactivateDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("admin.usersPage.deactivateDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (userToDelete) {
                  handleDeleteUser();
                  setShowDeleteDialog(false);
                }
              }}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting
                ? t("admin.usersPage.deactivateDialog.confirming")
                : t("admin.usersPage.deactivateDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.usersPage.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.usersPage.deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>
              {t("admin.usersPage.deleteDialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (userToRemove) {
                  handleRemoveUser();
                  setShowRemoveDialog(false);
                }
              }}
              disabled={isRemoving}
              className="bg-red-600 hover:bg-red-700"
            >
              {isRemoving
                ? t("admin.usersPage.deleteDialog.confirming")
                : t("admin.usersPage.deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Operations Dialog */}
      <BulkOperations
        selectedUsers={(users || []).filter((user) =>
          selectedUsers.includes(user._id.toString()),
        )}
        isOpen={showBulkDialog}
        onClose={() => setShowBulkDialog(false)}
        onSuccess={() => {
          setSelectedUsers([]);
          fetchUsers();
        }}
      />
    </div>
  );
}
