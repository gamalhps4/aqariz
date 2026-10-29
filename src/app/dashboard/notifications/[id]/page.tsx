"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bell,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Tag,
  Trash2,
} from "lucide-react";

import type {
  NotificationCategory,
  NotificationItem,
} from "@/types/notifications";
import { useAuthorization } from "@/hooks/useAuthorization";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { timeAgo } from "@/lib/utils/date-fns-locale";

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

function formatTypeLabel(type: string) {
  return type
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function getCategory(type: string): Exclude<NotificationCategory, "all"> {
  if (type.startsWith("payment_")) return "payments";
  if (type.startsWith("lease_")) return "leases";
  if (type.startsWith("maintenance_")) return "maintenance";
  return "system";
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

export default function NotificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { isAdmin, isManager, isTenant } = useAuthorization();
  const { t, formatDate } = useLocalizationContext();
  const [notification, setNotification] = useState<NotificationItem | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const canManage =
    sessionStatus === "authenticated" && (isAdmin || isManager || isTenant);

  const fetchNotification = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/notifications/${id}`);
      const data = await res.json();

      if (res.ok && data?.success) {
        setNotification(data?.data ?? null);
      } else {
        toast.error(
          data?.error || t("dashboard.notifications.detail.notFound"),
        );
        router.push("/dashboard/notifications");
      }
    } catch {
      toast.error(t("dashboard.notifications.detail.loadFailed"));
      router.push("/dashboard/notifications");
    } finally {
      setLoading(false);
    }
  }, [id, router, t]);

  useEffect(() => {
    if (id && sessionStatus === "authenticated") {
      fetchNotification();
    }
  }, [id, sessionStatus, fetchNotification]);

  const handleToggleRead = async () => {
    if (!notification) return;

    setToggling(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationIds: [notification.id],
          read: !notification.read,
        }),
      });

      if (!res.ok) throw new Error();

      const newRead = !notification.read;
      setNotification((prev) =>
        prev
          ? {
              ...prev,
              read: newRead,
              readAt: newRead ? new Date().toISOString() : null,
            }
          : prev,
      );
      toast.success(
        newRead
          ? t("dashboard.notifications.toasts.markedRead")
          : t("dashboard.notifications.toasts.markedUnread"),
      );
    } catch {
      toast.error(t("dashboard.notifications.detail.statusUpdateFailed"));
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!notification) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/notifications/${notification.id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error();

      toast.success(t("dashboard.notifications.toasts.deleted"));
      router.push("/dashboard/notifications");
    } catch {
      toast.error(t("dashboard.notifications.toasts.deleteFailed"));
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!notification) return null;

  const category = getCategory(notification.type);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("dashboard.notifications.detail.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("dashboard.notifications.detail.idPrefix")}:{" "}
            {notification.id.slice(0, 8)}... &middot;{" "}
            {t(getCategoryLabelKey(category))}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="hover:bg-blue-50 hover:text-blue-600 border transition-colors"
            onClick={() => router.push("/dashboard/notifications")}
          >
            <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
            {t("dashboard.notifications.detail.back")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Bell className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-foreground">
                      {notification.title}
                    </h2>
                    {!notification.read && (
                      <Badge variant="default" className="text-xs">
                        {t("dashboard.notifications.status.unread")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={getPriorityVariant(notification.priority)}>
                      {t(getPriorityLabelKey(notification.priority))}
                    </Badge>
                    <Badge variant="outline">
                      {formatTypeLabel(notification.type)}
                    </Badge>
                    <Badge variant="secondary">
                      {t(getCategoryLabelKey(category))}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Separator className="mb-4" />
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">
                    {t("dashboard.notifications.detail.message")}
                  </h3>
                  <p className="text-foreground leading-relaxed whitespace-pre-wrap">
                    {notification.message}
                  </p>
                </div>

                {notification.metadata &&
                  Object.keys(notification.metadata).length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <h3 className="text-sm font-medium text-muted-foreground mb-3">
                          {t(
                            "dashboard.notifications.detail.additionalDetails",
                          )}
                        </h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {Object.entries(notification.metadata).map(
                            ([key, value]) => (
                              <div
                                key={key}
                                className="rounded-lg border p-3 bg-muted/30"
                              >
                                <p className="text-xs font-medium text-muted-foreground capitalize">
                                  {key
                                    .replace(/([A-Z])/g, " $1")
                                    .replace(/[_-]/g, " ")
                                    .trim()}
                                </p>
                                <p className="text-sm font-medium text-foreground mt-0.5">
                                  {String(value)}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </>
                  )}

                {notification.actionUrl && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="text-sm font-medium text-muted-foreground mb-2">
                        {t("dashboard.notifications.detail.relatedResource")}
                      </h3>
                      <Button
                        onClick={() => router.push(notification.actionUrl!)}
                      >
                        <ExternalLink className="h-4 w-4 me-2" />
                        {t(
                          "dashboard.notifications.actions.openRelatedResource",
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Actions */}
          {canManage && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-foreground">
                  {t("dashboard.notifications.table.actions")}
                </h3>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={handleToggleRead}
                  disabled={toggling}
                >
                  {toggling ? (
                    <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  ) : notification.read ? (
                    <EyeOff className="h-4 w-4 me-2" />
                  ) : (
                    <Eye className="h-4 w-4 me-2" />
                  )}
                  {notification.read
                    ? t("dashboard.notifications.actions.markAsUnread")
                    : t("dashboard.notifications.actions.markAsRead")}
                </Button>

                {notification.actionUrl && (
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => router.push(notification.actionUrl!)}
                  >
                    <ExternalLink className="h-4 w-4 me-2" />
                    {t("dashboard.notifications.actions.openResource")}
                  </Button>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={deleting}
                    >
                      {deleting ? (
                        <Loader2 className="h-4 w-4 me-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 me-2" />
                      )}
                      {t("dashboard.notifications.actions.deleteNotification")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("dashboard.notifications.deleteDialog.singleTitle")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t(
                          "dashboard.notifications.deleteDialog.detailDescription",
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {t("common.cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-red-600 hover:bg-red-700 text-white"
                      >
                        {t("dashboard.notifications.actions.delete")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          )}

          {/* Info */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-foreground">
                {t("dashboard.notifications.detail.information")}
              </h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("dashboard.notifications.table.status")}
                  </p>
                  <Badge
                    variant={notification.read ? "secondary" : "default"}
                    className="mt-0.5"
                  >
                    {notification.read
                      ? t("dashboard.notifications.status.read")
                      : t("dashboard.notifications.status.unread")}
                  </Badge>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("dashboard.notifications.table.received")}
                  </p>
                  <p className="text-sm font-medium">
                    {formatDate(new Date(notification.createdAt), {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {timeAgo(new Date(notification.createdAt))}
                  </p>
                </div>
              </div>

              {notification.readAt && (
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                    <Check className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("dashboard.notifications.detail.readAt")}
                    </p>
                    <p className="text-sm font-medium">
                      {formatDate(new Date(notification.readAt), {
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("dashboard.notifications.detail.lastUpdated")}
                  </p>
                  <p className="text-sm font-medium">
                    {formatDate(new Date(notification.updatedAt), {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
