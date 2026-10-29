"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { refreshNotificationCounts } from "@/lib/sidebar-utils";

import type {
  NotificationCategory,
  NotificationItem,
  NotificationMetrics,
  NotificationPagination,
  NotificationResponsePayload,
  NotificationStatusFilter,
} from "@/types/notifications";

interface UseNotificationsOptions {
  limit?: number;
  page?: number;
  pollInterval?: number;
  includeRead?: boolean;
  status?: NotificationStatusFilter;
  category?: NotificationCategory;
  priority?: NotificationItem["priority"] | "all";
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  enabled?: boolean;
}

interface NotificationState {
  notifications: NotificationItem[];
  unreadCount: number;
  totalCount: number;
  metrics: NotificationMetrics;
  pagination: NotificationPagination;
}

const defaultPagination: NotificationPagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 1,
  hasNext: false,
  hasPrev: false,
};

const defaultState: NotificationState = {
  notifications: [],
  unreadCount: 0,
  totalCount: 0,
  metrics: {
    highPriority: 0,
    lastUpdated: null,
  },
  pagination: defaultPagination,
};

export function useNotifications(options: UseNotificationsOptions = {}) {
  const {
    limit = 10,
    page = 1,
    pollInterval = 60000,
    includeRead = true,
    status = "all",
    category = "all",
    priority = "all",
    search,
    dateFrom,
    dateTo,
    enabled = true,
  } = options;

  const [state, setState] = useState<NotificationState>(defaultState);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchRef = useRef<((silent?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortRef.current = null;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", limit.toString());
    params.set("includeRead", includeRead ? "true" : "false");
    if (status && status !== "all") {
      params.set("status", status);
    }
    if (category && category !== "all") {
      params.set("category", category);
    }
    if (priority && priority !== "all") {
      params.set("priority", priority);
    }
    if (search?.trim()) {
      params.set("search", search.trim());
    }
    if (dateFrom) {
      params.set("dateFrom", dateFrom);
    }
    if (dateTo) {
      params.set("dateTo", dateTo);
    }
    return params.toString();
  }, [
    page,
    limit,
    includeRead,
    status,
    category,
    priority,
    search,
    dateFrom,
    dateTo,
  ]);

  const fetchNotifications = useCallback(
    async (silent = false) => {
      if (!enabled) {
        if (!silent && isMountedRef.current) {
          setIsLoading(false);
        }

        if (isMountedRef.current) {
          setError(null);
          setState(defaultState);
        }

        return;
      }

      abortRef.current = null;

      const controller = new AbortController();
      abortRef.current = controller;

      if (!silent) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const response = await fetch(
          `/api/notifications?${queryString}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );

        // Check if request was aborted
        if (controller.signal.aborted || !isMountedRef.current) {
          return;
        }

        if (response.status === 403) {
          if (isMountedRef.current) {
            setState(defaultState);
            setError("Notifications are unavailable for your role.");
            setIsLoading(false);
          }
          return;
        }

        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Failed to load notifications");
        }

        const payload: {
          data?: NotificationResponsePayload;
          pagination?: NotificationPagination;
        } & NotificationResponsePayload = await response.json();

        const data =
          payload?.data ?? payload ?? ({} as NotificationResponsePayload);
        const pagination =
          payload?.pagination ??
          defaultState.pagination;

        if (!isMountedRef.current || controller.signal.aborted) {
          return;
        }

        setState({
          notifications: data.notifications ?? [],
          unreadCount: data.unreadCount ?? 0,
          totalCount: data.totalCount ?? 0,
          metrics: data.metrics ?? defaultState.metrics,
          pagination: {
            page: pagination.page ?? page,
            limit: pagination.limit ?? limit,
            total: pagination.total ?? data.totalCount ?? 0,
            totalPages: pagination.totalPages ?? 1,
            hasNext: pagination.hasNext ?? false,
            hasPrev: pagination.hasPrev ?? false,
          },
        });
      } catch (err) {
        if (!isMountedRef.current || controller.signal.aborted) {
          return;
        }

        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        if (
          err instanceof Error &&
          err.message.toLowerCase().includes("abort")
        ) {
          return;
        }

        if (isMountedRef.current) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [enabled, limit, page, queryString]
  );

  useEffect(() => {
    fetchRef.current = fetchNotifications;
  }, [fetchNotifications]);

  useEffect(() => {
    if (!enabled) {
      abortRef.current = null;

      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      setState(defaultState);
      setIsLoading(false);
      setError(null);
      return;
    }

    void fetchNotifications();
  }, [enabled, fetchNotifications]);

  useEffect(() => {
    if (!enabled || pollInterval <= 0) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(() => {
      fetchRef.current?.(true);
    }, pollInterval);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [enabled, pollInterval, queryString]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/notifications/stream");
      es.onmessage = (evt) => {
        if (!evt.data) return;
        try {
          const parsed = JSON.parse(evt.data);
          if (parsed?.type === "notification.created") {
            fetchRef.current?.(true);
            refreshNotificationCounts();
          }
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (!closed) retryTimer = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [enabled]);

  const applyLocalReadState = useCallback((ids: string[]) => {
    setState((prev) => {
      if (ids.length === 0) {
        return prev;
      }

      const timestamp = new Date().toISOString();

      const updatedNotifications = prev.notifications.map((notification) =>
        ids.includes(notification.id)
          ? {
              ...notification,
              read: true,
              readAt: timestamp,
            }
          : notification
      );

      const unreadCount = updatedNotifications.filter((n) => !n.read).length;

      return {
        ...prev,
        notifications: updatedNotifications,
        unreadCount,
      };
    });
  }, []);

  const markAsRead = useCallback(
    async (ids: string[]) => {
      if (!enabled) {
        return;
      }

      if (!ids || ids.length === 0) {
        return;
      }

      applyLocalReadState(ids);

      try {
        const response = await fetch("/api/notifications", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ notificationIds: ids, read: true }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        refreshNotificationCounts();
        await fetchRef.current?.(true);
      } catch (err) {
        console.error("Failed to mark notifications as read:", err);
        await fetchRef.current?.(true);
      }
    },
    [applyLocalReadState, enabled]
  );

  const markAsUnread = useCallback(
    async (ids: string[]) => {
      if (!enabled || !ids || ids.length === 0) {
        return;
      }

      setState((prev) => {
        const updatedNotifications = prev.notifications.map((notification) =>
          ids.includes(notification.id)
            ? { ...notification, read: false, readAt: null }
            : notification
        );
        return {
          ...prev,
          notifications: updatedNotifications,
          unreadCount: updatedNotifications.filter((n) => !n.read).length,
        };
      });

      try {
        const response = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationIds: ids, read: false }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        refreshNotificationCounts();
        await fetchRef.current?.(true);
      } catch (err) {
        console.error("Failed to mark notifications as unread:", err);
        await fetchRef.current?.(true);
      }
    },
    [enabled]
  );

  const markAllAsRead = useCallback(async () => {
    if (!enabled) {
      return;
    }

    const unreadIds = state.notifications
      .filter((n) => !n.read)
      .map((n) => n.id);

    applyLocalReadState(unreadIds);

    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ markAll: true, read: true }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      refreshNotificationCounts();
      await fetchRef.current?.(true);
    } catch (err) {
      console.error("Failed to mark all notifications as read:", err);
      await fetchRef.current?.(true);
    }
  }, [applyLocalReadState, enabled, state.notifications]);

  const deleteNotification = useCallback(
    async (id: string) => {
      if (!enabled) {
        return false;
      }

      setState((prev) => ({
        ...prev,
        notifications: prev.notifications.filter((n) => n.id !== id),
        totalCount: Math.max(prev.totalCount - 1, 0),
      }));

      try {
        const response = await fetch(`/api/notifications/${id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        refreshNotificationCounts();
        await fetchRef.current?.(true);
        return true;
      } catch (err) {
        console.error("Failed to delete notification:", err);
        await fetchRef.current?.(true);
        return false;
      }
    },
    [enabled]
  );

  const deleteNotifications = useCallback(
    async (ids: string[]) => {
      if (!enabled || ids.length === 0) {
        return false;
      }

      setState((prev) => ({
        ...prev,
        notifications: prev.notifications.filter((n) => !ids.includes(n.id)),
        totalCount: Math.max(prev.totalCount - ids.length, 0),
      }));

      try {
        const response = await fetch(
          `/api/notifications?ids=${ids.join(",")}`,
          { method: "DELETE" }
        );

        if (!response.ok) {
          throw new Error(await response.text());
        }

        refreshNotificationCounts();
        await fetchRef.current?.(true);
        return true;
      } catch (err) {
        console.error("Failed to delete notifications:", err);
        await fetchRef.current?.(true);
        return false;
      }
    },
    [enabled]
  );

  return {
    notifications: state.notifications,
    unreadCount: state.unreadCount,
    totalCount: state.totalCount,
    metrics: state.metrics,
    pagination: state.pagination,
    isLoading,
    error,
    refresh: () => {
      if (!enabled) {
        return;
      }

      return fetchRef.current?.(true);
    },
    markAsRead,
    markAsUnread,
    markAllAsRead,
    deleteNotification,
    deleteNotifications,
  };
}
