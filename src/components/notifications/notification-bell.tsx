"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { dateFnsLocale } from "@/lib/utils/date-fns-locale";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { Bell, Loader2, Check, AlertTriangle, RotateCcw } from "lucide-react";
import { useSession } from "@/lib/auth-client";

import { useNotifications } from "@/hooks/useNotifications";
import type { NotificationItem } from "@/types/notifications";
import { cn } from "@/lib/utils";
import { useAuthorization } from "@/hooks/useAuthorization";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

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

/** Translation key and English for a priority. */
function priorityLabel(priority: NotificationItem["priority"]): [string, string] {
  switch (priority) {
    case "critical":
      return ["notifications.bell.priority.critical", "Critical"];
    case "high":
      return ["notifications.bell.priority.high", "High"];
    case "medium":
      return ["notifications.bell.priority.medium", "Medium"];
    case "low":
      return ["notifications.bell.priority.low", "Low"];
    default:
      return ["notifications.bell.priority.normal", "Normal"];
  }
}

export function NotificationBell() {
  const { t, language } = useLocalizationContext();
  const router = useRouter();
  const { data: session, status } = useSession();
  const { isAdmin, isManager, isTenant } = useAuthorization();
  const [open, setOpen] = useState(false);
  const isAuthorizedRole = isAdmin || isManager || isTenant;
  const canUseNotifications = status === "authenticated" && isAuthorizedRole;
  const isRoleRestricted = status === "authenticated" && !isAuthorizedRole;
  const {
    notifications,
    unreadCount,
    metrics,
    isLoading,
    error,
    markAsRead,
    markAllAsRead,
    refresh,
  } = useNotifications({
    limit: 12,
    includeRead: true,
    pollInterval: 60000,
    enabled: canUseNotifications,
  });

  const hasNotifications = notifications.length > 0;

  const unreadIds = useMemo(
    () => notifications.filter((notification) => !notification.read).map((n) => n.id),
    [notifications]
  );

  const handleNotificationClick = useCallback(
    (notification: NotificationItem) => {
      if (!canUseNotifications) {
        return;
      }

      if (!notification.read) {
        void markAsRead([notification.id]);
      }

      if (notification.actionUrl) {
        router.push(notification.actionUrl);
        setOpen(false);
      }
    },
    [canUseNotifications, markAsRead, router]
  );

  const handleMarkAll = useCallback(() => {
    if (!canUseNotifications) {
      return;
    }

    if (unreadIds.length === 0) {
      return;
    }
    void markAllAsRead();
  }, [canUseNotifications, markAllAsRead, unreadIds.length]);

  const isButtonLoading =
    status === "loading" || (canUseNotifications && isLoading);
  const showRestrictedState = isRoleRestricted || error === "Notifications are unavailable for your role.";
  const notificationsLink = "/dashboard/notifications";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={
            canUseNotifications && unreadCount > 0
              ? t("notifications.bell.unreadCount", { defaultValue: "Unread notifications: {count}", values: { count: unreadCount } })
              : t("notifications.bell.title", { defaultValue: "Notifications" })
          }
        >
          {isButtonLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Bell className="h-4 w-4" />
          )}
          {canUseNotifications && unreadCount > 0 && (
            <span className="absolute -top-1 -end-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t("notifications.bell.title", { defaultValue: "Notifications" })}</p>
            <p className="text-xs text-muted-foreground">
              {showRestrictedState
                ? t("notifications.bell.restricted", { defaultValue: "Notifications are not available for your role." })
                : unreadCount > 0
                  ? t("notifications.bell.summary", { defaultValue: "Unread: {unread} · High priority: {high}", values: { unread: unreadCount, high: metrics.highPriority } })
                  : t("notifications.bell.caughtUp", { defaultValue: "You're all caught up" })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => void refresh()}
              disabled={!canUseNotifications}
              aria-label={t("notifications.bell.refresh", { defaultValue: "Refresh notifications" })}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleMarkAll}
              disabled={!canUseNotifications || unreadIds.length === 0}
              aria-label={t("notifications.bell.markAll", { defaultValue: "Mark all as read" })}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <ScrollArea className="max-h-80">
          {showRestrictedState ? (
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 text-warning" />
              <p className="text-sm font-medium text-foreground">
                {t("notifications.bell.unavailable", { defaultValue: "Notifications unavailable" })}
              </p>
              <p className="text-xs">
                {t("notifications.bell.noAccess", { defaultValue: "You do not have access to notifications in this account." })}
              </p>
            </div>
          ) : isButtonLoading && !hasNotifications ? (
            <div className="space-y-3 px-4 py-4">
              {[...Array(3)].map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              ))}
            </div>
          ) : hasNotifications ? (
            <div className="divide-y">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-start transition",
                    notification.read
                      ? "bg-background hover:bg-muted/60"
                      : "bg-primary/5 hover:bg-primary/10"
                  )}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="mt-1">
                    {notification.priority === "critical" ||
                    notification.priority === "high" ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Bell className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-foreground">
                        {notification.title}
                      </h3>
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {formatDistanceToNow(new Date(notification.createdAt), {
                          addSuffix: true,
                          locale: dateFnsLocale(language),
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {notification.message}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={getPriorityVariant(notification.priority)}>
                        {(() => {
                          const [key, english] = priorityLabel(notification.priority);
                          return t(key, { defaultValue: english });
                        })()}
                      </Badge>
                      <Badge variant="outline">
                        {t(`notifications.bell.types.${notification.type}`, {
                          defaultValue: notification.type.replace(/_/g, " "),
                        })}
                      </Badge>
                      {!notification.read && (
                        <span className="text-[11px] font-semibold text-primary">
                          {t("notifications.bell.new", { defaultValue: "New" })}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-muted-foreground">
              <Bell className="h-8 w-8" />
              <p className="text-sm font-medium text-foreground">
                {t("notifications.bell.emptyTitle", { defaultValue: "No notifications yet" })}
              </p>
              <p className="text-xs">
                {t("notifications.bell.emptyDescription", { defaultValue: "Notifications you receive will appear here." })}
              </p>
            </div>
          )}
        </ScrollArea>

        <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs">
          <Link
            href={notificationsLink}
            className={cn(
              "font-medium text-primary hover:underline",
              !canUseNotifications && "pointer-events-none opacity-60"
            )}
            onClick={() => {
              if (!canUseNotifications) {
                return;
              }
              setOpen(false);
            }}
            aria-disabled={!canUseNotifications}
          >
            {t("notifications.bell.viewAll", { defaultValue: "View all notifications" })}
          </Link>
          <span className="text-muted-foreground">
            {metrics.lastUpdated
              ? t("notifications.bell.updated", { defaultValue: "Updated {when}", values: { when: formatDistanceToNow(new Date(metrics.lastUpdated), { addSuffix: true, locale: dateFnsLocale(language) }) } })
              : t("notifications.bell.updatedNow", { defaultValue: "Updated just now" })}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationBell;
