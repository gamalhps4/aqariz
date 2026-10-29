"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import React, { useState, useEffect, useMemo } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalTitle,
  CustomModalDescription,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/ui/custom-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionDepartments } from "@/components/roles/PermissionDepartments";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DeleteConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  ArrowLeft,
  Shield,
  Users,
  Plus,
  Trash2,
  Settings,
  UserCheck,
  Search,
  RefreshCw,
  Eye,
  Lock,
  Unlock,
} from "lucide-react";
import { UserRole, IUser, IRoleConfig } from "@/types";
import { normalizeRoleName, resolveSystemRole } from "@/lib/role-utils";
import {
  PERMISSION_METADATA,
  SYSTEM_PERMISSIONS,
  SYSTEM_ROLE_PERMISSIONS,
} from "@/lib/permission-catalog";
import { clearPermissionCache } from "@/hooks/useRolePermissions";
import { clearGroupNamesCache, useGroupNames } from "@/hooks/useGroupNames";
import { groupDisplayName } from "@/lib/role-display";
import { useAuthorization } from "@/hooks/useAuthorization";
import { formatDisplayDate } from "@/lib/utils/formatting";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";

interface Permission {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface RoleConfig {
  /** The row's id: a group is addressed by it, never by its name — see /api/roles/names. */
  id?: string;
  role: string;
  name: string;
  label: string;
  labelAr?: string | null;
  description: string;
  permissions: string[];
  userCount: number;
  color: string;
  isSystem: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

interface UserWithRole {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar?: string | null;
  role: string;
  originalRole: string;
  normalizedOriginalRole: string;
  isActive: boolean;
  lastLogin?: string;
}

// Available permissions in the system - moved inside component to use translations

const normalizeRoleToSystem = (role?: string | null): string => {
  return resolveSystemRole(role) ?? normalizeRoleName(role) ?? UserRole.TENANT;
};

// Still used by the user filter: picking a system role in the dropdown should
// also match users whose stored role is an alias of it ("administrator").
const isLegacyOrSystemRole = (role?: string | null) => {
  return Boolean(resolveSystemRole(role));
};

// Default system role configurations - moved inside component to use translations

export default function RoleManagementPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { t, language } = useLocalizationContext();
  const { canManageRoles } = useAuthorization();
  const { roleName } = useGroupNames();

  // Available permissions with translations
  /**
   * Built from the permission catalogue rather than listed here.
   *
   * This screen used to carry its own copy of every permission, which meant a
   * permission added to the catalogue was enforced by the server but could
   * never be granted — it simply did not appear. Deriving the list is what
   * makes a new module manageable through the permission system on the day it
   * ships, with no change to this file.
   *
   * A locale that has translated `admin.roles.permissions.<id>.*` still wins;
   * the catalogue's English is the fallback for everything not translated yet.
   */
  const AVAILABLE_PERMISSIONS: Permission[] = useMemo(
    () =>
      SYSTEM_PERMISSIONS.map((id) => {
        const meta = PERMISSION_METADATA[id];
        return {
          id,
          name: t(`admin.roles.permissions.${id}.name`, {
            defaultValue: meta.label,
          }),
          description: t(`admin.roles.permissions.${id}.description`, {
            defaultValue: meta.description,
          }),
          category: t(`admin.roles.permissions.${id}.category`, {
            defaultValue: meta.group,
          }),
        };
      }),
    [t],
  );

  // Role cards come from the API with the stored English wording; a system
  // role has catalogue wording, and a permission id has a translated name.
  const permissionName = (id: string) =>
    AVAILABLE_PERMISSIONS.find((permission) => permission.id === id)?.name ??
    id.replace(/_/g, " ");
  // A built-in role in the catalogue's wording; a group by the name for this
  // screen's language — its Arabic name on an Arabic screen when it has one.
  const roleText = (config: RoleConfig, field: "label" | "description") =>
    config.isSystem
      ? t(`admin.roles.defaultRoles.${config.name}.${field}`, {
          defaultValue: config[field],
        })
      : field === "label"
        ? groupDisplayName(config, language)
        : config[field];

  // Shown only when the roles cannot be loaded. Their rights are the
  // catalogue's, which is what the server enforces for a built-in role.
  const defaultRoleConfigs: RoleConfig[] = useMemo(
    () =>
      (
        [
          [UserRole.ADMIN, "destructive"],
          [UserRole.MANAGER, "default"],
          [UserRole.OWNER, "outline"],
          [UserRole.TENANT, "outline"],
        ] as const
      ).map(([role, color]) => ({
        role,
        name: role,
        label: t(`admin.roles.defaultRoles.${role}.label`),
        description: t(`admin.roles.defaultRoles.${role}.description`),
        permissions: [...SYSTEM_ROLE_PERMISSIONS[role]],
        userCount: 0,
        color,
        isSystem: true,
        canEdit: false,
        canDelete: false,
      })),
    [t],
  );

  const [roleConfigs, setRoleConfigs] =
    useState<RoleConfig[]>(defaultRoleConfigs);
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("overview");

  // Role creation/editing state
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleConfig | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleNameAr, setNewRoleNameAr] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  // A built-in role, or a group beyond the caller's own rights, opens to be
  // read: every field and tick shown, nothing that saves.
  const isReadOnly = Boolean(
    editingRole && (editingRole.isSystem || !editingRole.canEdit),
  );

  // User assignment state
  const [showUserAssignDialog, setShowUserAssignDialog] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [targetRole, setTargetRole] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  // Why a request failed, as the server put it. The API answers with `error`
  // and a machine `code`; this screen read `message`, which is never set, so
  // every refusal surfaced as the same "Failed to create role". The two a
  // person can act on by typing another name are given in their language.
  const serverError = async (response: Response, fallback: string) => {
    const body = await response.json().catch(() => null);
    switch (body?.code) {
      case "ROLE_NAME_RESERVED":
        return t("admin.roles.toast.nameReserved");
      case "ROLE_NAME_TAKEN":
        return t("admin.roles.toast.nameTaken");
      // Below the Administrator a group manages only groups within its own
      // rights — the server says which rule refused.
      case "ROLE_OWN_GROUP":
        return t("admin.roles.toast.ownGroup");
      case "ROLE_BEYOND_REACH":
        return t("admin.roles.toast.beyondReach");
      case "ROLE_MEMBERS_BEYOND_REACH":
        return t("admin.roles.toast.membersBeyondReach");
      default:
        return body?.error || body?.message || fallback;
    }
  };

  // Check permissions
  // Delete role function
  const handleDeleteRole = async (roleConfig: RoleConfig) => {
    try {
      setDeleteLoading(roleConfig.name);

      if (roleConfig.isSystem) {
        toast.error(t("admin.roles.toasts.systemRole", { defaultValue: "Built-in roles cannot be deleted" }));
        return;
      }

      if (roleConfig.userCount > 0 || !roleConfig.canDelete) {
        toast.error(
          t("admin.roles.toasts.hasUsers", { defaultValue: "{count} users have this role. Move them to another role first.", values: { count: roleConfig.userCount } }),
        );
        return;
      }

      const response = await fetch(
        `/api/roles/${encodeURIComponent(roleConfig.id ?? roleConfig.name)}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error(
          await serverError(
            response,
            t("admin.roles.toasts.deleteFailed", { defaultValue: "Could not delete the role" }),
          ),
        );
      }

      clearPermissionCache();
      clearGroupNamesCache();
      toast.success(t("admin.roles.toasts.deleted", { defaultValue: "Role deleted" }));

      // Refresh data
      await fetchRolesAndUsers();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin.roles.toasts.deleteFailed", { defaultValue: "Could not delete the role" }),
      );
    } finally {
      setDeleteLoading(null);
    }
  };

  // Fetch roles and users
  const fetchRolesAndUsers = async () => {
    try {
      setIsLoading(true);

      // Fetch both roles and users in parallel
      const [rolesResponse, usersResponse] = await Promise.all([
        fetch("/api/roles?includeSystem=true"),
        fetch("/api/users?limit=1000"),
      ]);

      if (!rolesResponse.ok) {
        throw new Error("Failed to fetch roles");
      }

      if (!usersResponse.ok) {
        throw new Error("Failed to fetch users");
      }

      const rolesData = await rolesResponse.json();
      const usersData = await usersResponse.json();

      const rolePayload =
        rolesData?.data?.roles ?? rolesData?.roles ?? rolesData ?? [];

      const usersPayloadRaw = usersData?.data ?? usersData;
      const usersPayload = Array.isArray(usersPayloadRaw?.users)
        ? usersPayloadRaw.users
        : Array.isArray(usersPayloadRaw)
          ? usersPayloadRaw
          : [];

      const normalizedUsers: UserWithRole[] = (usersPayload as IUser[])
        .map((user) => {
          const originalRoleRaw =
            typeof user.role === "string" ? user.role : "";
          const normalizedOriginalRole = originalRoleRaw
            ? originalRoleRaw.toLowerCase()
            : "";
          const canonicalRole = normalizeRoleToSystem(originalRoleRaw);

          return {
            _id:
              typeof user._id === "string"
                ? user._id
                : ((user._id as any)?.toString?.() ?? ""),
            firstName: user.firstName ?? "",
            lastName: user.lastName ?? "",
            email: user.email ?? "",
            avatar: (user as any)?.avatar ?? null,
            role: canonicalRole,
            originalRole: originalRoleRaw || canonicalRole,
            normalizedOriginalRole: normalizedOriginalRole || canonicalRole,
            isActive: Boolean(user.isActive),
            lastLogin: user.lastLogin
              ? new Date(user.lastLogin).toISOString()
              : undefined,
          };
        })
        .filter((user) => Boolean(user._id));

      setUsers(normalizedUsers);

      // Role cards come straight from the API, user counts included: it derives
      // them from an org-scoped groupBy over the users table. This page used to
      // re-count them from whatever slice of /api/users it happened to be
      // holding — a second source of truth that disagrees the moment the list is
      // paginated or filtered, and that reported the org's admin count under the
      // synthetic super_admin card the API no longer invents.
      const apiRoles: RoleConfig[] = (
        Array.isArray(rolePayload) ? (rolePayload as IRoleConfig[]) : []
      ).map((role) => ({
        id: role._id,
        role: role.name,
        name: role.name,
        label: role.label,
        labelAr: role.labelAr ?? null,
        description: role.description,
        permissions: role.permissions ?? [],
        userCount: role.userCount ?? 0,
        color: role.color || "outline",
        isSystem: Boolean(role.isSystem),
        canEdit: Boolean(role.canEdit),
        canDelete: Boolean(role.canDelete),
      }));

      // System roles first, then custom ones alphabetically by the name
      // this screen shows.
      apiRoles.sort((a, b) =>
        a.isSystem === b.isSystem
          ? roleText(a, "label").localeCompare(roleText(b, "label"))
          : a.isSystem
            ? -1
            : 1,
      );

      setRoleConfigs(apiRoles);
    } catch (error) {
      toast.error(t("admin.roles.toast.loadFailed"));
      // Fallback to default system roles if API fails
      setRoleConfigs(defaultRoleConfigs);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!showUserAssignDialog) {
      setTargetRole(null);
    }
  }, [showUserAssignDialog]);

  // Handle role creation/editing
  const handleSaveRole = async () => {
    try {
      if (!newRoleName.trim()) {
        toast.error(t("admin.roles.toast.roleNameRequired"));
        return;
      }

      if (selectedPermissions.length === 0) {
        toast.error(t("admin.roles.toast.permissionRequired"));
        return;
      }

      // Only what was typed is sent. The key the group is stored under is
      // made on the server, which is what lets the name be Arabic or carry
      // punctuation — this used to derive it here, and the server refused
      // anything that did not reduce to a-z, 0-9 and underscores.
      const roleData = {
        label: newRoleName,
        labelAr: newRoleNameAr.trim() || null,
        description: newRoleDescription,
        permissions: selectedPermissions,
        color: "outline" as const,
        isActive: true,
      };

      if (editingRole && !editingRole.isSystem) {
        // Update existing custom role, by its id: a group's stored name can
        // be anything the label reduced to, "names" included, and
        // /api/roles/names is a route of its own.
        const response = await fetch(
          `/api/roles/${encodeURIComponent(editingRole.id ?? editingRole.name)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              label: newRoleName,
              labelAr: newRoleNameAr.trim() || null,
              description: newRoleDescription,
              permissions: selectedPermissions,
              color: "outline",
            }),
          },
        );

        if (!response.ok) {
          throw new Error(
            await serverError(response, t("admin.roles.toast.roleSaveFailed")),
          );
        }

        clearPermissionCache();
        clearGroupNamesCache();
        toast.success(t("admin.roles.toast.roleUpdated"));
      } else {
        // Create new role
        const response = await fetch("/api/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(roleData),
        });

        if (!response.ok) {
          throw new Error(
            await serverError(response, t("admin.roles.toast.roleSaveFailed")),
          );
        }

        clearPermissionCache();
        clearGroupNamesCache();
        toast.success(t("admin.roles.toast.roleCreated"));
      }

      // Reset form and refresh data
      setShowRoleDialog(false);
      setEditingRole(null);
      setNewRoleName("");
      setNewRoleNameAr("");
      setNewRoleDescription("");
      setSelectedPermissions([]);

      // Refresh roles and users
      await fetchRolesAndUsers();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin.roles.toast.roleSaveFailed"),
      );
    }
  };

  // Handle user role assignment
  const handleAssignRole = async () => {
    try {
      if (!targetRole || selectedUsers.length === 0) {
        toast.error(t("admin.roles.toast.selectUsersAndRole"));
        return;
      }

      // Call the role assignment API
      const response = await fetch("/api/users/assign-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: selectedUsers,
          targetRole,
          reason: "Bulk role assignment from admin panel",
          notifyUsers: false,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await serverError(response, t("admin.roles.toast.assignFailed")),
        );
      }

      const result = await response.json();

      // The group by its label — its stored name is a key, and for a group
      // named in Arabic it says nothing. The count sits under `data`.
      const assignedRole = roleConfigs.find(
        (config) => config.name === targetRole,
      );
      toast.success(
        t("admin.roles.toast.rolesAssigned", {
          values: {
            count:
              result?.data?.modifiedCount ??
              result?.modifiedCount ??
              selectedUsers.length,
            role: assignedRole ? roleText(assignedRole, "label") : targetRole,
          },
        }),
      );

      setShowUserAssignDialog(false);
      setSelectedUsers([]);
      setTargetRole(null);

      // Refresh data
      await fetchRolesAndUsers();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin.roles.toast.assignFailed"),
      );
    }
  };

  useEffect(() => {
    if (canManageRoles) {
      fetchRolesAndUsers();
    }
  }, [canManageRoles]);

  // Filter users based on search and role
  const filteredUsers = (users || []).filter((user) => {
    const matchesSearch =
      searchTerm === "" ||
      `${user.firstName} ${user.lastName}`
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());

    const normalizedSelectedRole =
      selectedRole === "all" ? "all" : selectedRole.toLowerCase();
    const matchesRole =
      normalizedSelectedRole === "all" ||
      (isLegacyOrSystemRole(normalizedSelectedRole) &&
        user.role === normalizeRoleToSystem(normalizedSelectedRole)) ||
      user.normalizedOriginalRole === normalizedSelectedRole;

    return matchesSearch && matchesRole;
  });

  // A user's role as its badge names it — the role's name, never its
  // stored key — and the colour the badge wears.
  const userRoleBadge = (user: UserWithRole) => {
    const matchedRole =
      roleConfigs.find(
        (config) =>
          config.role === user.role ||
          config.name.toLowerCase() === user.normalizedOriginalRole,
      ) ?? null;
    return {
      label: matchedRole
        ? roleText(matchedRole, "label")
        : roleName(user.originalRole ?? user.role),
      color: matchedRole?.color,
    };
  };

  const userSort = useTableSort(filteredUsers, {
    user: (user) => `${user.firstName} ${user.lastName}`,
    email: (user) => user.email,
    role: (user) => userRoleBadge(user).label,
    status: (user) =>
      user.isActive
        ? t("admin.roles.userAssignment.active")
        : t("admin.roles.userAssignment.inactive"),
    // Never signed in shows as words: blank to the sort, last both ways.
    lastLogin: (user) => (user.lastLogin ? new Date(user.lastLogin) : null),
  });

  if (!canManageRoles) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold">
            {t("admin.roles.accessDenied.title")}
          </h3>
          <p className="text-muted-foreground">
            {t("admin.roles.accessDenied.description")}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.back()}
            className="mt-4"
          >
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("admin.roles.accessDenied.goBack")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("admin.roles.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("admin.roles.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchRolesAndUsers}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 me-2 ${isLoading ? "animate-spin" : ""}`}
            />
            {t("admin.roles.refresh")}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingRole(null);
              setNewRoleName("");
              setNewRoleNameAr("");
              setNewRoleDescription("");
              setSelectedPermissions([]);
              setShowRoleDialog(true);
            }}
          >
            <Plus className="h-4 w-4 me-2" />
            {t("admin.roles.createRole")}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">
            {t("admin.roles.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="roles">{t("admin.roles.tabs.roles")}</TabsTrigger>
          <TabsTrigger value="users">{t("admin.roles.tabs.users")}</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {roleConfigs.map((config) => (
              <Card key={config.name} className="relative">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {roleText(config, "label")}
                  </CardTitle>
                  <Badge variant={config.color as any} className="text-xs">
                    {config.userCount} {t("admin.roles.overview.users")}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{config.userCount}</div>
                  <p className="text-xs text-muted-foreground mb-3">
                    {roleText(config, "description")}
                  </p>
                  <div className="space-y-1">
                    <p className="text-xs font-medium">
                      {t("admin.roles.overview.keyPermissions")}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {config.permissions.slice(0, 3).map((permission) => (
                        <Badge
                          key={permission}
                          variant="outline"
                          className="text-xs"
                        >
                          {permissionName(permission)}
                        </Badge>
                      ))}
                      {config.permissions.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{config.permissions.length - 3}{" "}
                          {t("admin.roles.overview.more")}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Roles Management Tab */}
        <TabsContent value="roles" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                {t("admin.roles.manage.title")}
              </CardTitle>
              <CardDescription>
                {t("admin.roles.manage.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {roleConfigs.map((config) => (
                  <div
                    key={config.name}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {config.isSystem ? (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Unlock className="h-4 w-4 text-green-600" />
                        )}
                        <div>
                          <h3 className="font-medium">
                            {roleText(config, "label")}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {roleText(config, "description")}
                          </p>
                        </div>
                      </div>
                      <Badge variant={config.color as any}>
                        {config.userCount} {t("admin.roles.overview.users")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // Opened either way: a built-in role, or a group
                          // beyond the caller's rights, to be read.
                          setEditingRole(config);
                          setNewRoleName(
                            config.isSystem ? roleText(config, "label") : config.label,
                          );
                          setNewRoleNameAr(config.labelAr ?? "");
                          setNewRoleDescription(
                            config.isSystem
                              ? roleText(config, "description")
                              : config.description,
                          );
                          setSelectedPermissions(config.permissions);
                          setShowRoleDialog(true);
                        }}
                      >
                        <Eye className="h-4 w-4 me-2" />
                        {config.canEdit
                          ? t("admin.roles.manage.edit")
                          : t("admin.roles.manage.view")}
                      </Button>
                      {!config.isSystem && (
                        <DeleteConfirmationDialog
                          itemName={roleText(config, "label")}
                          itemType="role"
                          onConfirm={() => handleDeleteRole(config)}
                          loading={deleteLoading === config.name}
                          disabled={
                            !config.canDelete || deleteLoading === config.name
                          }
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              !config.canDelete || deleteLoading === config.name
                            }
                            className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
                            title={
                              config.canDelete
                                ? t("admin.roles.deleteTitle", { defaultValue: "Delete this role" })
                                : t("admin.roles.toasts.hasUsers", { defaultValue: "{count} users have this role. Move them to another role first.", values: { count: config.userCount } })
                            }
                          >
                            <Trash2 className="h-4 w-4 me-2" />
                            {t("admin.roles.manage.delete", { defaultValue: "Delete" })}
                          </Button>
                        </DeleteConfirmationDialog>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* User Assignment Tab */}
        <TabsContent value="users" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                {t("admin.roles.userAssignment.title")}
              </CardTitle>
              <CardDescription>
                {t("admin.roles.userAssignment.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder={t(
                        "admin.roles.userAssignment.searchPlaceholder",
                      )}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="ps-10"
                    />
                  </div>
                </div>
                <Select
                  value={selectedRole}
                  onValueChange={(value) => setSelectedRole(value)}
                >
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue
                      placeholder={t("admin.roles.userAssignment.filterByRole")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("admin.roles.userAssignment.allRoles")}
                    </SelectItem>
                    {roleConfigs.map((config) => {
                      const normalizedValue = (
                        config.name || config.role
                      ).toLowerCase();
                      return (
                        <SelectItem
                          key={`${config.name}-${normalizedValue}`}
                          value={normalizedValue}
                        >
                          {roleText(config, "label")}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => setShowUserAssignDialog(true)}
                  disabled={selectedUsers.length === 0}
                >
                  <UserCheck className="h-4 w-4 me-2" />
                  {t("admin.roles.userAssignment.assignRoles")}
                </Button>
              </div>

              {/* Users Table */}
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={
                            selectedUsers.length === filteredUsers.length &&
                            filteredUsers.length > 0
                          }
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedUsers(filteredUsers.map((u) => u._id));
                            } else {
                              setSelectedUsers([]);
                            }
                          }}
                        />
                      </TableHead>
                      <SortableTableHead sort={userSort} column="user">
                        {t("admin.roles.userAssignment.table.user")}
                      </SortableTableHead>
                      <SortableTableHead sort={userSort} column="email">
                        {t("admin.roles.userAssignment.table.email")}
                      </SortableTableHead>
                      <SortableTableHead sort={userSort} column="role">
                        {t("admin.roles.userAssignment.table.currentRole")}
                      </SortableTableHead>
                      <SortableTableHead sort={userSort} column="status">
                        {t("admin.roles.userAssignment.table.status")}
                      </SortableTableHead>
                      <SortableTableHead sort={userSort} column="lastLogin">
                        {t("admin.roles.userAssignment.table.lastLogin")}
                      </SortableTableHead>
                      <TableHead className="text-end">
                        {t("admin.roles.userAssignment.table.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, index) => (
                        <TableRow key={index}>
                          <TableCell>
                            <div className="h-4 w-4 bg-muted rounded animate-pulse" />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-3">
                              <div className="h-8 w-8 bg-muted rounded-full animate-pulse" />
                              <div className="space-y-1">
                                <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="h-4 w-48 bg-muted rounded animate-pulse" />
                          </TableCell>
                          <TableCell>
                            <div className="h-6 w-24 bg-muted rounded animate-pulse" />
                          </TableCell>
                          <TableCell>
                            <div className="h-6 w-16 bg-muted rounded animate-pulse" />
                          </TableCell>
                          <TableCell>
                            <div className="h-4 w-20 bg-muted rounded animate-pulse" />
                          </TableCell>
                          <TableCell>
                            <div className="h-8 w-8 bg-muted rounded animate-pulse ms-auto" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : filteredUsers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">
                          <div className="flex flex-col items-center gap-2">
                            <Users className="h-8 w-8 text-muted-foreground" />
                            <p className="text-muted-foreground">
                              {searchTerm || selectedRole !== "all"
                                ? t(
                                    "admin.roles.userAssignment.noUsersMatching",
                                  )
                                : t("admin.roles.userAssignment.noUsers")}
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      userSort.rows.map((user) => (
                        <TableRow key={user._id.toString()}>
                          <TableCell>
                            <Checkbox
                              checked={selectedUsers.includes(user._id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedUsers((prev) => [
                                    ...prev,
                                    user._id,
                                  ]);
                                } else {
                                  setSelectedUsers((prev) =>
                                    prev.filter((id) => id !== user._id),
                                  );
                                }
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-3">
                              <Avatar className="h-8 w-8">
                                <AvatarImage
                                  src={user.avatar ?? undefined}
                                  alt={`${user.firstName} ${user.lastName}`}
                                />
                                <AvatarFallback className="text-xs">
                                  {user.firstName?.[0]}
                                  {user.lastName?.[0]}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium">
                                  {user.firstName} {user.lastName}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            {(() => {
                              const badge = userRoleBadge(user);
                              return (
                                <Badge
                                  variant={
                                    (badge.color as React.ComponentProps<
                                      typeof Badge
                                    >["variant"]) || "outline"
                                  }
                                >
                                  {badge.label}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={user.isActive ? "default" : "secondary"}
                            >
                              {user.isActive
                                ? t("admin.roles.userAssignment.active")
                                : t("admin.roles.userAssignment.inactive")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {user.lastLogin
                              ? formatDisplayDate(user.lastLogin)
                              : t("admin.roles.userAssignment.never")}
                          </TableCell>
                          <TableCell className="text-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                router.push(
                                  `/dashboard/admin/users/${user._id}`,
                                )
                              }
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Role Creation/Edit Dialog */}
      <CustomModal
        open={showRoleDialog}
        onOpenChange={setShowRoleDialog}
        size="3/4"
      >
        <CustomModalHeader onClose={() => setShowRoleDialog(false)}>
          <CustomModalTitle>
            {isReadOnly
              ? t("admin.roles.dialog.viewTitle", { defaultValue: "Permission group" })
              : editingRole
                ? t("admin.roles.dialog.editTitle")
                : t("admin.roles.dialog.createTitle")}
          </CustomModalTitle>
          <CustomModalDescription>
            {isReadOnly
              ? editingRole?.isSystem
                ? t("admin.roles.dialog.builtInDescription", {
                    defaultValue:
                      "A built-in role. What it may do is fixed, and shown here to read.",
                  })
                : t("admin.roles.dialog.beyondReachDescription", {
                    defaultValue:
                      "This group holds permissions you do not have, or is your own, so it is shown here to read.",
                  })
              : editingRole
                ? t("admin.roles.dialog.editDescription")
                : t("admin.roles.dialog.createDescription")}
          </CustomModalDescription>
        </CustomModalHeader>

        <CustomModalBody>
          <div className="space-y-6">
            {/* The client's page: an English and an Arabic name. The English
                one is the group's label, shown wherever there is no Arabic
                name or the screen is not in Arabic. */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="roleName">
                  {t("admin.roles.dialog.nameEn", {
                    defaultValue: "English group name",
                  })}{" "}
                  {!isReadOnly && <span className="text-red-500">*</span>}
                </Label>
                <Input
                  id="roleName"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder={t("admin.roles.dialog.roleNamePlaceholder")}
                  disabled={isReadOnly}
                  maxLength={100}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="roleNameAr">
                  {t("admin.roles.dialog.nameAr", {
                    defaultValue: "Arabic group name",
                  })}
                </Label>
                <Input
                  id="roleNameAr"
                  dir="rtl"
                  lang="ar"
                  value={newRoleNameAr}
                  onChange={(e) => setNewRoleNameAr(e.target.value)}
                  // An Arabic example in every language: the field takes
                  // Arabic, and English text inside a right-to-left box
                  // reads scrambled.
                  placeholder={
                    isReadOnly
                      ? ""
                      : t("admin.roles.dialog.nameArPlaceholder", {
                          defaultValue: "مثال: المحاسبون",
                        })
                  }
                  disabled={isReadOnly || editingRole?.isSystem}
                  maxLength={100}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="roleDescription">
                  {t("admin.roles.dialog.description")}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("admin.roles.dialog.optional", { defaultValue: "(optional)" })}
                  </span>
                </Label>
                <Input
                  id="roleDescription"
                  value={newRoleDescription}
                  onChange={(e) => setNewRoleDescription(e.target.value)}
                  placeholder={t("admin.roles.dialog.descriptionPlaceholder")}
                  disabled={isReadOnly}
                  maxLength={500}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label className="font-bold">
                {t("admin.roles.dialog.permissions")}
              </Label>
              {/* A box per department, as the client's reference page lays
                  it out, with View, Add, Edit, Delete and Export beneath
                  each line. */}
              <PermissionDepartments
                selected={selectedPermissions}
                onChange={setSelectedPermissions}
                disabled={isReadOnly}
              />
            </div>
          </div>
        </CustomModalBody>

        <CustomModalFooter>
          <Button variant="outline" onClick={() => setShowRoleDialog(false)}>
            {isReadOnly
              ? t("admin.roles.dialog.close", { defaultValue: "Close" })
              : t("admin.roles.dialog.cancel")}
          </Button>
          {!isReadOnly && (
            <Button onClick={handleSaveRole} disabled={!newRoleName.trim()}>
              {editingRole
                ? t("admin.roles.dialog.updateButton")
                : t("admin.roles.dialog.createButton")}
            </Button>
          )}
        </CustomModalFooter>
      </CustomModal>

      {/* User Role Assignment Dialog */}
      <Dialog
        open={showUserAssignDialog}
        onOpenChange={setShowUserAssignDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.roles.assignDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("admin.roles.assignDialog.description", {
                values: { count: selectedUsers.length },
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("admin.roles.assignDialog.selectRole")}</Label>
              <Select
                value={targetRole ?? ""}
                onValueChange={(value) => setTargetRole(value)}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("admin.roles.assignDialog.chooseRole")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {roleConfigs
                    .filter((config) => config.isSystem || config.canEdit)
                    .map((config) => (
                      <SelectItem key={config.name} value={config.name}>
                        {roleText(config, "label")}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowUserAssignDialog(false)}
            >
              {t("admin.roles.assignDialog.cancel")}
            </Button>
            <Button onClick={handleAssignRole} disabled={!targetRole}>
              {t("admin.roles.assignDialog.assign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
