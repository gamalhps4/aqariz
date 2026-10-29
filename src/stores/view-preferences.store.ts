/**
 * PropertyPro - View Preferences Store
 * Centralized Zustand store for managing view mode preferences across all modules
 * with localStorage persistence and SSR compatibility
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { z } from "zod";
import type {
  ViewPreferencesStore,
  PropertiesViewMode,
  StandardViewMode,
  UsersViewMode,
  CalendarViewMode,
  ExpiringLeasesViewMode,
} from "@/types/view-preferences.types";

// ============================================================================
// DEFAULT VALUES
// ============================================================================

/**
 * Default view preferences for all modules
 * These are used on first load and when resetting to defaults
 */
const DEFAULT_VIEW_PREFERENCES = {
  propertiesView: "grid" as PropertiesViewMode,
  availablePropertiesView: "grid" as PropertiesViewMode,
  tenantsView: "table" as StandardViewMode,
  leasesView: "table" as StandardViewMode,
  activeLeasesView: "table" as StandardViewMode,
  invoicesView: "table" as StandardViewMode,
  maintenanceView: "table" as StandardViewMode,
  usersView: "table" as UsersViewMode,
  calendarView: "dayGridMonth" as CalendarViewMode,
  expiringLeasesView: "list" as ExpiringLeasesViewMode,
  emergencyMaintenanceView: "table" as StandardViewMode,
  transactionsView: "table" as StandardViewMode,
  billsView: "table" as StandardViewMode,
  expensesView: "table" as StandardViewMode,
  vendorsView: "table" as StandardViewMode,
  inspectionsView: "table" as StandardViewMode,
  _hasHydrated: false,
} as const;

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

/**
 * Zod schema for runtime validation of persisted state
 * Ensures data integrity when loading from localStorage
 */
const ViewPreferencesSchema = z.object({
  propertiesView: z.enum(["grid", "rows", "list"]),
  availablePropertiesView: z.enum(["grid", "rows", "list"]),
  tenantsView: z.enum(["table", "cards"]),
  leasesView: z.enum(["table", "cards"]),
  activeLeasesView: z.enum(["table", "cards"]),
  invoicesView: z.enum(["table", "cards"]),
  maintenanceView: z.enum(["table", "cards"]),
  usersView: z.enum(["table", "grid"]),
  calendarView: z.enum([
    "dayGridMonth",
    "timeGridWeek",
    "timeGridDay",
    "listWeek",
  ]),
  expiringLeasesView: z.enum(["grid", "list"]),
  emergencyMaintenanceView: z.enum(["table", "cards"]),
  transactionsView: z.enum(["table", "cards"]),
  billsView: z.enum(["table", "cards"]),
  expensesView: z.enum(["table", "cards"]),
  vendorsView: z.enum(["table", "cards"]),
  inspectionsView: z.enum(["table", "cards"]),
  _hasHydrated: z.boolean(),
  version: z.number().optional(),
});

// ============================================================================
// SAFE STORAGE WRAPPER
// ============================================================================

/**
 * Creates a safe localStorage wrapper with error handling
 * Handles quota exceeded, corrupted data, and missing storage scenarios
 */
const createSafeStorage = () => {
  const testKey = "__propertypro_storage_test__";

  // Test if localStorage is available
  const isStorageAvailable = (): boolean => {
    try {
      if (typeof window === "undefined") return false;
      localStorage.setItem(testKey, "test");
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  };

  const storageAvailable = isStorageAvailable();

  return {
    getItem: (name: string): string | null => {
      if (!storageAvailable) return null;

      try {
        return localStorage.getItem(name);
      } catch (error) {
        console.warn(
          "[ViewPreferences] Failed to read from localStorage:",
          error
        );
        return null;
      }
    },

    setItem: (name: string, value: string): void => {
      if (!storageAvailable) return;

      try {
        localStorage.setItem(name, value);
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "QuotaExceededError"
        ) {
          console.error("[ViewPreferences] localStorage quota exceeded");
        } else {
          console.warn(
            "[ViewPreferences] Failed to write to localStorage:",
            error
          );
        }
      }
    },

    removeItem: (name: string): void => {
      if (!storageAvailable) return;

      try {
        localStorage.removeItem(name);
      } catch (error) {
        console.warn(
          "[ViewPreferences] Failed to remove from localStorage:",
          error
        );
      }
    },
  };
};

// ============================================================================
// ZUSTAND STORE
// ============================================================================

/**
 * View preferences store with persistence
 * Manages view mode preferences for all modules with localStorage persistence
 */
export const useViewPreferencesStore = create<ViewPreferencesStore>()(
  persist(
    (set) => ({
      // Initial state
      ...DEFAULT_VIEW_PREFERENCES,

      // Actions
      setPropertiesView: (view) => set({ propertiesView: view }),
      setAvailablePropertiesView: (view) =>
        set({ availablePropertiesView: view }),
      setTenantsView: (view) => set({ tenantsView: view }),
      setLeasesView: (view) => set({ leasesView: view }),
      setActiveLeasesView: (view) => set({ activeLeasesView: view }),
      setInvoicesView: (view) => set({ invoicesView: view }),
      setMaintenanceView: (view) => set({ maintenanceView: view }),
      setUsersView: (view) => set({ usersView: view }),
      setCalendarView: (view) => set({ calendarView: view }),
      setExpiringLeasesView: (view) => set({ expiringLeasesView: view }),
      setEmergencyMaintenanceView: (view) =>
        set({ emergencyMaintenanceView: view }),
      setTransactionsView: (view) => set({ transactionsView: view }),
      setBillsView: (view) => set({ billsView: view }),
      setExpensesView: (view) => set({ expensesView: view }),
      setVendorsView: (view) => set({ vendorsView: view }),
      setInspectionsView: (view) => set({ inspectionsView: view }),

      resetToDefaults: () => set(DEFAULT_VIEW_PREFERENCES),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: "propertypro-view-preferences",
      storage: createJSONStorage(() => createSafeStorage()),
      version: 1,

      // Skip hydration on server to prevent SSR mismatches
      skipHydration: true,

      // Migrate and validate persisted state
      migrate: (persistedState: unknown, version: number) => {
        // Validate persisted state with Zod
        const result = ViewPreferencesSchema.safeParse(persistedState);

        if (!result.success) {
          console.warn(
            "[ViewPreferences] Invalid persisted state, resetting to defaults:",
            result.error.errors
          );
          return DEFAULT_VIEW_PREFERENCES;
        }

        // Return validated state
        return result.data;
      },

      // Partial persistence - only persist view preferences, not hydration flag
      partialize: (state) => ({
        propertiesView: state.propertiesView,
        availablePropertiesView: state.availablePropertiesView,
        tenantsView: state.tenantsView,
        leasesView: state.leasesView,
        activeLeasesView: state.activeLeasesView,
        invoicesView: state.invoicesView,
        maintenanceView: state.maintenanceView,
        usersView: state.usersView,
        calendarView: state.calendarView,
        expiringLeasesView: state.expiringLeasesView,
        emergencyMaintenanceView: state.emergencyMaintenanceView,
        transactionsView: state.transactionsView,
        billsView: state.billsView,
        expensesView: state.expensesView,
        vendorsView: state.vendorsView,
        inspectionsView: state.inspectionsView,
        _hasHydrated: state._hasHydrated,
      }),

      // Called after rehydration
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true);
        }
      },
    }
  )
);

// ============================================================================
// HYDRATION HELPER
// ============================================================================

/**
 * Manually trigger hydration on client-side
 * Call this in a useEffect on app mount to ensure proper SSR compatibility
 */
if (typeof window !== "undefined") {
  // Rehydrate store on client mount
  useViewPreferencesStore.persist.rehydrate();
}
