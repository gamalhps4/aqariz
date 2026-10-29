/**
 * PropertyPro - Sidebar Utilities
 * Helper functions for managing sidebar counts and notifications
 */

/**
 * Triggers a refresh of sidebar counts
 * Call this after actions that might affect the counts
 */
export function refreshSidebarCounts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("sidebar-counts-refresh"));
  }
}

/**
 * Triggers sidebar refresh after application-related actions
 */
export function refreshApplicationCounts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("application-submitted"));
  }
}

/**
 * Triggers sidebar refresh after lease-related actions
 */
export function refreshLeaseCounts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("lease-updated"));
  }
}

/**
 * Triggers sidebar refresh after maintenance-related actions
 */
export function refreshMaintenanceCounts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("maintenance-updated"));
  }
}

/**
 * Triggers sidebar refresh after payment-related actions
 */
export function refreshPaymentCounts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("payment-updated"));
  }
}

/**
 * Triggers sidebar refresh after ticket-related actions
 */
export function refreshTicketCounts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ticket-updated"));
  }
}

/**
 * Triggers sidebar refresh after inbox-related actions
 */
export function refreshInboxCounts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("sidebar-counts-refresh"));
  }
}

/**
 * Triggers sidebar refresh after conversation/message actions
 */
export function refreshMessageCounts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("message-updated"));
  }
}

/**
 * Triggers sidebar refresh after notification actions
 */
export function refreshNotificationCounts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("notification-updated"));
  }
}

/**
 * Triggers sidebar refresh after announcement actions
 */
export function refreshAnnouncementCounts(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("announcement-updated"));
  }
}

/**
 * Debounced version of refresh function to prevent excessive API calls
 */
let refreshTimeout: NodeJS.Timeout | null = null;

export function debouncedRefreshSidebarCounts(delay: number = 1000): void {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
  }

  refreshTimeout = setTimeout(() => {
    refreshSidebarCounts();
    refreshTimeout = null;
  }, delay);
}

/**
 * Hook into common actions that should trigger sidebar refresh
 * Call this in components that perform actions affecting counts
 */
export function useSidebarRefreshTriggers() {
  return {
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
  };
}
