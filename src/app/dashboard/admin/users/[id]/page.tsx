"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BuildingScopeCard } from "@/components/users/BuildingScopeCard";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  ArrowLeft,
  Edit,
  Shield,
  Mail,
  Phone,
  Calendar,
  User,
  Building2,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
} from "lucide-react";
import { UserRole, IUser } from "@/types";
import { formatDate } from "@/lib/utils";
import { UserActivityLog } from "@/components/users/user-activity-log";
import { UserSessionManagement } from "@/components/users/user-session-management";
import { formatCurrency } from "@/lib/utils/formatting";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useGroupNames } from "@/hooks/useGroupNames";
import { resolveSystemRole } from "@/lib/role-utils";

interface UserDetailPageProps {
  params: Promise<{ id: string }>;
}

interface UserPropertyPreview {
  _id: string;
  name: string;
  address: string;
  status?: string;
}

interface UserStats {
  propertiesCount: number;
  leasesCount: number;
  totalPayments: number;
  maintenanceRequests: number;
  properties: UserPropertyPreview[];
}

export default function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { t } = useLocalizationContext();
  const { canEditUsers, canViewUsers } = useAuthorization();
  const { roleName } = useGroupNames();
  const [user, setUser] = useState<IUser | null>(null);
  const [userStats, setUserStats] = useState<UserStats>({
    propertiesCount: 0,
    leasesCount: 0,
    totalPayments: 0,
    maintenanceRequests: 0,
    properties: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<
    "reset" | "lock" | "verify" | null
  >(null);
  // const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // const [isDeleting, setIsDeleting] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [activeTab, setActiveTab] = useState("overview");

  // Check permissions for single company architecture
  // Fetch user details
  const fetchUser = useCallback(
    async (id: string) => {
      try {
        setIsLoading(true);
        const response = await fetch(`/api/users/${id}`);

        if (!response.ok) {
          throw new Error("Failed to fetch user details");
        }

        const data = await response.json();
        const normalizedUser = (data?.data?.data ?? data?.data ?? data) as
          | IUser
          | undefined;

        if (!normalizedUser || typeof normalizedUser !== "object") {
          throw new Error("Invalid user data received");
        }

        setUser(normalizedUser);
        if (normalizedUser._id) {
          setUserId(String(normalizedUser._id));
        }
      } catch (error) {
        console.error("Error fetching user:", error);
        toast.error(t("admin.userDetail.toast.loadFailed"));
        router.push("/dashboard/admin/users");
      } finally {
        setIsLoading(false);
      }
    },
    [router, t],
  );

  // Fetch user statistics from the real aggregation endpoint
  const fetchUserStats = useCallback(
    async (id: string) => {
      try {
        setIsStatsLoading(true);

        const response = await fetch(`/api/users/${id}/stats`);
        if (!response.ok) {
          throw new Error("Failed to fetch user stats");
        }

        const json = await response.json();
        const stats = (json?.data ?? json) as Partial<UserStats>;

        setUserStats({
          propertiesCount: stats.propertiesCount ?? 0,
          leasesCount: stats.leasesCount ?? 0,
          totalPayments: stats.totalPayments ?? 0,
          maintenanceRequests: stats.maintenanceRequests ?? 0,
          properties: stats.properties ?? [],
        });
      } catch (error) {
        console.error("Error fetching user stats:", error);
        toast.error(t("admin.userDetail.toast.statsFailed"));
      } finally {
        setIsStatsLoading(false);
      }
    },
    [t],
  );

  // Admin action: send a password reset email to the user
  const handleResetPassword = async () => {
    if (!user?.email) return;
    try {
      setActionLoading("reset");
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      if (!response.ok) {
        throw new Error("Failed to send reset email");
      }
      toast.success(t("admin.userDetail.adminActions.resetPasswordToast"));
    } catch (error) {
      console.error("Error sending reset email:", error);
      toast.error(t("admin.userDetail.toast.actionFailed"));
    } finally {
      setActionLoading(null);
    }
  };

  // Admin action: mark the user's email as verified
  const handleVerifyEmail = async () => {
    try {
      setActionLoading("verify");
      const response = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailVerified: new Date().toISOString() }),
      });
      if (!response.ok) {
        throw new Error("Failed to verify email");
      }
      toast.success(t("admin.userDetail.adminActions.verifyEmailToast"));
      await fetchUser(userId);
    } catch (error) {
      console.error("Error verifying email:", error);
      toast.error(t("admin.userDetail.toast.actionFailed"));
    } finally {
      setActionLoading(null);
    }
  };

  // Admin action: block or unblock account access
  const handleToggleAccountLock = async () => {
    if (!user || !userId) return;

    const shouldLockAccount = !user.isLocked;

    try {
      setActionLoading("lock");
      const response = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          shouldLockAccount
            ? { isLocked: true, lockedUntil: null }
            : {
                isLocked: false,
                lockedUntil: null,
                failedLoginAttempts: 0,
              },
        ),
      });
      if (!response.ok) {
        throw new Error("Failed to update account lock state");
      }
      toast.success(
        t(
          shouldLockAccount
            ? "admin.userDetail.adminActions.lockAccountToast"
            : "admin.userDetail.adminActions.unlockAccountToast",
        ),
      );
      await fetchUser(userId);
    } catch (error) {
      console.error("Error updating account lock state:", error);
      toast.error(t("admin.userDetail.toast.actionFailed"));
    } finally {
      setActionLoading(null);
    }
  };

  // Handle user deletion
  // DISABLED: Delete functionality temporarily disabled
  // const handleDeleteUser = async () => {
  //   try {
  //     setIsDeleting(true);
  //     const response = await fetch(`/api/users/${userId}`, {
  //       method: "DELETE",
  //     });

  //     if (!response.ok) {
  //       throw new Error("Failed to delete user");
  //     }

  //     toast.success("User deactivated successfully");
  //     router.push("/dashboard/admin/users");
  //   } catch (error) {
  //     console.error("Error deleting user:", error);
  //     toast.error("Failed to deactivate user");
  //   } finally {
  //     setIsDeleting(false);
  //     setShowDeleteDialog(false);
  //   }
  // };

  // Role badge color
  const getRoleColor = (
    role: UserRole,
  ):
    | "default"
    | "secondary"
    | "destructive"
    | "outline"
    | "success"
    | "warning"
    | "info" => {
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

  // The role by its name — a group's stored key ("group_2") says nothing.
  // The response carries the group's names beside the key.
  const formatRole = (role: UserRole) =>
    roleName(
      role,
      user?.roleLabel
        ? { label: user.roleLabel, labelAr: user.roleLabelAr }
        : null,
    );

  // Initialize component
  useEffect(() => {
    if (!id) {
      return;
    }

    setUserId(id);

    if (sessionStatus === "loading") {
      return;
    }

    if (!canViewUsers) {
      setIsLoading(false);
      return;
    }

    fetchUser(id);
  }, [id, canViewUsers, fetchUser, sessionStatus]);

  // Fetch stats when user data is loaded
  useEffect(() => {
    if (user && userId) {
      fetchUserStats(userId);
    }
  }, [user, userId, fetchUserStats]);

  if (sessionStatus === "loading" || isLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div className="flex items-center gap-4">
          <div className="h-9 w-16 bg-muted rounded animate-pulse" />
          <div className="space-y-2">
            <div className="h-8 w-64 bg-muted rounded animate-pulse" />
            <div className="h-4 w-48 bg-muted rounded animate-pulse" />
          </div>
        </div>

        {/* User Info Skeleton */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <div className="h-96 bg-muted rounded-lg animate-pulse" />
          </div>
          <div className="lg:col-span-2">
            <div className="h-96 bg-muted rounded-lg animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!canViewUsers) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold">
            {t("admin.userDetail.accessDenied.title")}
          </h3>
          <p className="text-muted-foreground">
            {t("admin.userDetail.accessDenied.description")}
          </p>
          <Button
            variant="outline"
            onClick={() => router.back()}
            className="mt-4"
          >
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("admin.userDetail.accessDenied.goBack")}
          </Button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold">
            {t("admin.userDetail.notFound.title")}
          </h3>
          <p className="text-muted-foreground">
            {t("admin.userDetail.notFound.description")}
          </p>
          <Button
            variant="outline"
            onClick={() => router.push("/dashboard/admin/users")}
            className="mt-4"
          >
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("admin.userDetail.notFound.backToUsers")}
          </Button>
        </div>
      </div>
    );
  }

  const isViewingSelf = userId === session?.user?.id;
  // Owners and tenants see only their own records by rules of their own;
  // building access is for employees, and the tab is not offered for them.
  // A stored group is staff whatever its key spells, so only a built-in
  // role (or an alias with no group behind it) can make this a client.
  const clientRole = user.roleLabel ? null : resolveSystemRole(user.role);
  const isClientAccount =
    clientRole === UserRole.OWNER || clientRole === UserRole.TENANT;
  const isLockActionDisabled =
    actionLoading === "lock" || (!user.isLocked && isViewingSelf);
  const userDisplayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {user?.firstName} {user?.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">{t("admin.userDetail.title")}</p>
        </div>

        <div className="flex items-center gap-2">
          {canEditUsers && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  router.push(`/dashboard/admin/users/${userId}/edit`)
                }
              >
                <Edit className="h-4 w-4 me-2" />
                {t("admin.userDetail.editUser")}
              </Button>
              {/* DISABLED: Delete functionality temporarily disabled */}
              {/* <Button
                variant="destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 me-2" />
                Deactivate
              </Button> */}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("admin.userDetail.back")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* User Profile Card */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={user?.avatar || ""} />
                  <AvatarFallback className="text-2xl">
                    {user?.firstName?.[0]}
                    {user?.lastName?.[0]}
                  </AvatarFallback>
                </Avatar>
              </div>
              <CardTitle className="text-xl">
                {user?.firstName} {user?.lastName}
              </CardTitle>
              <CardDescription className="flex items-center justify-center gap-2">
                <Badge variant={getRoleColor(user?.role as UserRole)}>
                  {formatRole(user?.role as UserRole)}
                </Badge>
                <Badge variant={user?.isActive ? "default" : "secondary"}>
                  {user?.isActive
                    ? t("admin.usersPage.table.active")
                    : t("admin.usersPage.table.inactive")}
                </Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{user?.email}</span>
                </div>
                {user?.phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{user?.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {t("admin.userDetail.joined")} {formatDate(user?.createdAt)}
                  </span>
                </div>
                {user?.lastLogin && (
                  <div className="flex items-center gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {t("admin.userDetail.lastLogin")}{" "}
                      {formatDate(user?.lastLogin)}
                    </span>
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <h4 className="text-sm font-medium">
                  {t("admin.userDetail.accountStatus")}
                </h4>
                <div className="flex items-center gap-2">
                  {user?.isActive ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-600" />
                  )}
                  <span className="text-sm">
                    {user?.isActive
                      ? t("admin.userDetail.accountActive")
                      : t("admin.userDetail.accountInactive")}
                  </span>
                </div>
                {!!user?.emailVerified && (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm">
                      {t("admin.userDetail.emailVerified")}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* User Details Tabs */}
        <div className="lg:col-span-2">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="space-y-4"
          >
            <TabsList>
              <TabsTrigger value="overview">
                {t("admin.userDetail.tabs.overview")}
              </TabsTrigger>
              <TabsTrigger value="activity">
                {t("admin.userDetail.tabs.activity")}
              </TabsTrigger>
              <TabsTrigger value="properties">
                {t("admin.userDetail.tabs.properties")}
              </TabsTrigger>
              {!isClientAccount && (
                <TabsTrigger value="access">
                  {t("admin.userDetail.tabs.access", {
                    defaultValue: "Access",
                  })}
                </TabsTrigger>
              )}
              <TabsTrigger value="settings">
                {t("admin.userDetail.tabs.settings")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t("admin.userDetail.accountInfo.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("admin.userDetail.accountInfo.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("admin.userDetail.accountInfo.userId")}
                      </label>
                      <p className="text-sm font-mono">
                        {user?._id?.toString() || "N/A"}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("admin.userDetail.accountInfo.role")}
                      </label>
                      <p className="text-sm">
                        {formatRole(user?.role as UserRole)}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("admin.userDetail.accountInfo.email")}
                      </label>
                      <p className="text-sm">{user?.email}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("admin.userDetail.accountInfo.phone")}
                      </label>
                      <p className="text-sm">
                        {user?.phone ||
                          t("admin.userDetail.accountInfo.phoneNotProvided")}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("admin.userDetail.accountInfo.accountCreated")}
                      </label>
                      <p className="text-sm">{formatDate(user?.createdAt)}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("admin.userDetail.accountInfo.lastUpdated")}
                      </label>
                      <p className="text-sm">{formatDate(user?.updatedAt)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    {t("admin.userDetail.quickStats.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("admin.userDetail.quickStats.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 border rounded-lg">
                      <Building2 className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold">
                        {isStatsLoading ? (
                          <div className="h-8 w-8 bg-muted rounded animate-pulse mx-auto" />
                        ) : (
                          userStats.propertiesCount
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {t("admin.userDetail.quickStats.properties")}
                      </div>
                    </div>
                    <div className="text-center p-4 border rounded-lg">
                      <FileText className="h-8 w-8 text-green-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold">
                        {isStatsLoading ? (
                          <div className="h-8 w-8 bg-muted rounded animate-pulse mx-auto" />
                        ) : (
                          userStats.leasesCount
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {t("admin.userDetail.quickStats.leases")}
                      </div>
                    </div>
                    <div className="text-center p-4 border rounded-lg">
                      <DollarSign className="h-8 w-8 text-purple-600 mx-auto mb-2" />
                      <div className="text-2xl font-bold">
                        {isStatsLoading ? (
                          <div className="h-8 w-8 bg-muted rounded animate-pulse mx-auto" />
                        ) : (
                          formatCurrency(userStats.totalPayments)
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {t("admin.userDetail.quickStats.payments")}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="space-y-4">
              <div className="grid gap-6 lg:grid-cols-1">
                <UserActivityLog userId={userId} />
                <UserSessionManagement userId={userId} />
              </div>
            </TabsContent>

            <TabsContent value="properties" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t("admin.userDetail.properties.title")}
                    </CardTitle>
                    <CardDescription>
                      {t("admin.userDetail.properties.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isStatsLoading ? (
                      <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="h-16 bg-muted rounded animate-pulse"
                          />
                        ))}
                      </div>
                    ) : userStats.properties.length > 0 ? (
                      <div className="space-y-3">
                        {userStats.properties.map((property) => (
                          <div
                            key={property._id}
                            className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                            onClick={() =>
                              router.push(
                                `/dashboard/properties/${property._id}`,
                              )
                            }
                          >
                            <Building2 className="h-8 w-8 text-blue-600 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">
                                {property.name}
                              </p>
                              {property.address && (
                                <p className="text-sm text-muted-foreground truncate">
                                  {property.address}
                                </p>
                              )}
                            </div>
                            {property.status && (
                              <Badge variant="outline" className="capitalize">
                                {t(`properties.status.${property.status}`, {
                                  defaultValue: property.status.replace(/_/g, " "),
                                })}
                              </Badge>
                            )}
                          </div>
                        ))}
                        {userStats.propertiesCount >
                          userStats.properties.length && (
                          <p className="text-sm text-muted-foreground text-center">
                            {t("admin.userDetail.properties.andMore", {
                              values: {
                                count:
                                  userStats.propertiesCount -
                                  userStats.properties.length,
                              },
                            })}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Building2 className="h-8 w-8 mx-auto mb-2" />
                        <p className="text-sm">
                          {t("admin.userDetail.properties.noProperties")}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t("admin.userDetail.propertyStats.title")}
                    </CardTitle>
                    <CardDescription>
                      {t("admin.userDetail.propertyStats.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t("admin.userDetail.propertyStats.totalProperties")}
                        </span>
                        <span className="text-sm">
                          {isStatsLoading ? (
                            <div className="h-4 w-8 bg-muted rounded animate-pulse" />
                          ) : (
                            userStats.propertiesCount
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t("admin.userDetail.propertyStats.activeLeases")}
                        </span>
                        <span className="text-sm">
                          {isStatsLoading ? (
                            <div className="h-4 w-8 bg-muted rounded animate-pulse" />
                          ) : (
                            userStats.leasesCount
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t(
                            "admin.userDetail.propertyStats.maintenanceRequests",
                          )}
                        </span>
                        <span className="text-sm">
                          {isStatsLoading ? (
                            <div className="h-4 w-8 bg-muted rounded animate-pulse" />
                          ) : (
                            userStats.maintenanceRequests
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t("admin.userDetail.propertyStats.totalRevenue")}
                        </span>
                        <span className="text-sm">
                          {isStatsLoading ? (
                            <div className="h-4 w-12 bg-muted rounded animate-pulse" />
                          ) : (
                            formatCurrency(userStats.totalPayments)
                          )}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {!isClientAccount && (
              <TabsContent value="access" className="space-y-4">
                {/* Which buildings this employee may see. Owners and tenants
                    are governed by their own rules, so the endpoint refuses
                    them and the tab is not offered. */}
                {userId && <BuildingScopeCard userId={userId} />}
              </TabsContent>
            )}

            <TabsContent value="settings" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t("admin.userDetail.accountSettings.title")}
                    </CardTitle>
                    <CardDescription>
                      {t("admin.userDetail.accountSettings.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">
                            {t(
                              "admin.userDetail.accountSettings.accountStatus",
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t(
                              "admin.userDetail.accountSettings.accountStatusDesc",
                            )}
                          </p>
                        </div>
                        <Badge
                          variant={user?.isActive ? "default" : "secondary"}
                        >
                          {user?.isActive
                            ? t("admin.userDetail.accountSettings.active")
                            : t("admin.userDetail.accountSettings.inactive")}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">
                            {t(
                              "admin.userDetail.accountSettings.emailVerification",
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t(
                              "admin.userDetail.accountSettings.emailVerificationDesc",
                            )}
                          </p>
                        </div>
                        <Badge
                          variant={
                            !!user?.emailVerified ? "default" : "secondary"
                          }
                        >
                          {!!user?.emailVerified
                            ? t("admin.userDetail.accountSettings.verified")
                            : t("admin.userDetail.accountSettings.unverified")}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">
                            {t("admin.userDetail.accountSettings.userRole")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("admin.userDetail.accountSettings.userRoleDesc")}
                          </p>
                        </div>
                        <Badge variant={getRoleColor(user?.role as UserRole)}>
                          {formatRole(user?.role as UserRole)}
                        </Badge>
                      </div>
                      {/* Two-Factor Auth omitted: 2FA is not implemented yet,
                          so we don't show a placeholder "Disabled" status. */}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t("admin.userDetail.security.title")}
                    </CardTitle>
                    <CardDescription>
                      {t("admin.userDetail.security.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">
                            {t("admin.userDetail.security.lastLogin")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("admin.userDetail.security.lastLoginDesc")}
                          </p>
                        </div>
                        <span className="text-sm">
                          {user?.lastLogin
                            ? formatDate(user.lastLogin)
                            : t("admin.userDetail.security.never")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">
                            {t("admin.userDetail.security.passwordChanged")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("admin.userDetail.security.passwordChangedDesc")}
                          </p>
                        </div>
                        <span className="text-sm">
                          {user?.passwordChangedAt
                            ? formatDate(user.passwordChangedAt)
                            : t("admin.userDetail.security.unknown")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">
                            {t("admin.userDetail.security.loginAttempts")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("admin.userDetail.security.loginAttemptsDesc")}
                          </p>
                        </div>
                        <span className="text-sm">
                          {user?.failedLoginAttempts ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">
                            {t("admin.userDetail.security.accountLocked")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("admin.userDetail.security.accountLockedDesc")}
                          </p>
                        </div>
                        <Badge
                          variant={user?.isLocked ? "destructive" : "default"}
                        >
                          {user?.isLocked
                            ? t("admin.userDetail.security.locked")
                            : t("admin.userDetail.security.unlocked")}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {canEditUsers && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t("admin.userDetail.adminActions.title")}
                    </CardTitle>
                    <CardDescription>
                      {t("admin.userDetail.adminActions.description")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          router.push(`/dashboard/admin/users/${userId}/edit`)
                        }
                      >
                        <Edit className="h-4 w-4 me-2" />
                        {t("admin.userDetail.adminActions.editProfile")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleResetPassword}
                        disabled={actionLoading === "reset"}
                      >
                        <Mail className="h-4 w-4 me-2" />
                        {t("admin.userDetail.adminActions.resetPassword")}
                      </Button>
                      <ConfirmationDialog
                        title={t(
                          user?.isLocked
                            ? "admin.userDetail.adminActions.unlockAccountDialogTitle"
                            : "admin.userDetail.adminActions.lockAccountDialogTitle",
                        )}
                        description={t(
                          user?.isLocked
                            ? "admin.userDetail.adminActions.unlockAccountDialogDescription"
                            : "admin.userDetail.adminActions.lockAccountDialogDescription",
                          { values: { name: userDisplayName } },
                        )}
                        confirmText={t(
                          user?.isLocked
                            ? "admin.userDetail.adminActions.unlockAccountDialogConfirm"
                            : "admin.userDetail.adminActions.lockAccountDialogConfirm",
                        )}
                        cancelText={t("common.cancel", {
                          defaultValue: "Cancel",
                        })}
                        variant={user?.isLocked ? "default" : "destructive"}
                        onConfirm={handleToggleAccountLock}
                        loading={actionLoading === "lock"}
                        disabled={isLockActionDisabled}
                      >
                        <Button
                          variant={user?.isLocked ? "outline" : "destructive"}
                          size="sm"
                          disabled={isLockActionDisabled}
                        >
                          <Shield className="h-4 w-4 me-2" />
                          {user?.isLocked
                            ? t("admin.userDetail.adminActions.unlockAccount")
                            : t("admin.userDetail.adminActions.lockAccount")}
                        </Button>
                      </ConfirmationDialog>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleVerifyEmail}
                        disabled={
                          !!user?.emailVerified || actionLoading === "verify"
                        }
                      >
                        <CheckCircle className="h-4 w-4 me-2" />
                        {t("admin.userDetail.adminActions.verifyEmail")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {/* <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate {user?.firstName}{" "}
              {user?.lastName}? This action will disable their access to the
              system but preserve their data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white me-2" />
                  Deactivating...
                </>
              ) : (
                "Deactivate"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog> */}
    </div>
  );
}
