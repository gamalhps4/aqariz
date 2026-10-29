/**
 * PropertyPro - Sidebar Counts Hook
 * Custom hook for fetching and managing sidebar navigation counts
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "@/lib/auth-client";

export interface SidebarCounts {
  applications: number;
  expiringLeases: number;
  emergencyMaintenance: number;
  overduePayments: number;
  inbox: number;
  messages: number;
  notifications: number;
  announcements: number;
  tickets: number;
}

interface UseSidebarCountsReturn {
  counts: SidebarCounts;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const defaultCounts: SidebarCounts = {
  applications: 0,
  expiringLeases: 0,
  emergencyMaintenance: 0,
  overduePayments: 0,
  inbox: 0,
  messages: 0,
  notifications: 0,
  announcements: 0,
  tickets: 0,
};

export function useSidebarCounts(
  options: {
    refreshInterval?: number; // in milliseconds
    enabled?: boolean;
  } = {},
): UseSidebarCountsReturn {
  const { refreshInterval = 30000, enabled = true } = options; // Default 30 seconds
  const { data: session, status } = useSession();

  const [counts, setCounts] = useState<SidebarCounts>(defaultCounts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialFetchDoneRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Use stable reference for session check
  const isAuthenticated = status === "authenticated" && !!session?.user;

  const fetchCounts = useCallback(async () => {
    if (!isAuthenticated || !enabled) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/sidebar/counts", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch sidebar counts: ${response.statusText}`,
        );
      }

      const data = await response.json();
      const payload = data?.data;

      if (data?.success && payload) {
        setCounts({ ...defaultCounts, ...payload });
      } else {
        throw new Error(data?.message || "Failed to fetch sidebar counts");
      }
    } catch (err) {
      console.error("Error fetching sidebar counts:", err);
      setError(err instanceof Error ? err.message : "Unknown error occurred");
      // Keep previous counts on error
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, enabled]);

  // Keep a ref to fetchCounts to avoid dependency issues
  const fetchCountsRef = useRef(fetchCounts);
  fetchCountsRef.current = fetchCounts;

  // Initial fetch and interval setup - stable dependencies
  useEffect(() => {
    if (!isAuthenticated || !enabled) {
      return;
    }

    // Only do initial fetch once
    if (!initialFetchDoneRef.current) {
      initialFetchDoneRef.current = true;
      fetchCountsRef.current();
    }

    // Avoid creating multiple intervals
    if (intervalRef.current) {
      return;
    }

    // Set up refresh interval
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(() => {
        fetchCountsRef.current();
      }, refreshInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Don't reset initialFetchDoneRef here to prevent re-fetching
    };
  }, [isAuthenticated, enabled, refreshInterval]);

  // Listen for custom events to trigger refresh
  useEffect(() => {
    const handleRefresh = () => {
      fetchCountsRef.current();
    };

    // Listen for various events that might affect counts
    const events = [
      "sidebar-counts-refresh",
      "application-submitted",
      "lease-created",
      "lease-updated",
      "maintenance-created",
      "maintenance-updated",
      "payment-created",
      "payment-updated",
      "conversation-created",
      "conversation-updated",
      "message-created",
      "message-updated",
      "notification-created",
      "notification-updated",
      "announcement-created",
      "announcement-updated",
      "ticket-created",
      "ticket-updated",
    ];

    events.forEach((event) => {
      window.addEventListener(event, handleRefresh);
    });

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleRefresh);
      });
    };
  }, []); // Empty dependency array - we use ref to avoid stale closure

  return {
    counts,
    loading,
    error,
    refetch: fetchCounts,
  };
}

// Re-export utility functions for convenience
export {
  refreshSidebarCounts,
  refreshApplicationCounts,
  refreshLeaseCounts,
  refreshMaintenanceCounts,
  refreshPaymentCounts,
  refreshTicketCounts,
  refreshInboxCounts,
  refreshMessageCounts,
  refreshNotificationCounts,
  refreshAnnouncementCounts,
  debouncedRefreshSidebarCounts,
  useSidebarRefreshTriggers,
} from "@/lib/sidebar-utils";
