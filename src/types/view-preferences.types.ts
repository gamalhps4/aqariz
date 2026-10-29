/**
 * PropertyPro - View Preferences Type Definitions
 * Type-safe view mode preferences for all modules
 */

// ============================================================================
// VIEW MODE CONSTANTS
// ============================================================================

/**
 * Properties module view modes (grid, rows, list)
 * Used by: Properties Page, Available Properties Page
 */
export const PROPERTIES_VIEW_MODES = ["grid", "rows", "list"] as const;

/**
 * Standard view modes (table, cards)
 * Used by: Tenants, Leases, Active Leases, Invoices, Maintenance
 */
export const STANDARD_VIEW_MODES = ["table", "cards"] as const;

/**
 * Users/Admin view modes (table, grid)
 * Used by: Admin Users Page
 */
export const USERS_VIEW_MODES = ["table", "grid"] as const;

/**
 * Calendar view modes
 * Used by: Calendar View Component
 */
export const CALENDAR_VIEW_MODES = [
  "dayGridMonth",
  "timeGridWeek",
  "timeGridDay",
  "listWeek",
] as const;

/**
 * Expiring leases view modes (grid, list)
 * Used by: Expiring Leases Page
 */
export const EXPIRING_LEASES_VIEW_MODES = ["grid", "list"] as const;

// ============================================================================
// DERIVED TYPES
// ============================================================================

/**
 * Properties view mode type
 */
export type PropertiesViewMode = (typeof PROPERTIES_VIEW_MODES)[number];

/**
 * Standard view mode type (table/cards)
 */
export type StandardViewMode = (typeof STANDARD_VIEW_MODES)[number];

/**
 * Users view mode type
 */
export type UsersViewMode = (typeof USERS_VIEW_MODES)[number];

/**
 * Calendar view mode type
 */
export type CalendarViewMode = (typeof CALENDAR_VIEW_MODES)[number];

/**
 * Expiring leases view mode type
 */
export type ExpiringLeasesViewMode =
  (typeof EXPIRING_LEASES_VIEW_MODES)[number];

// ============================================================================
// STORE STATE INTERFACE
// ============================================================================

/**
 * View preferences state
 * Each property represents a different module's view preference
 */
export interface ViewPreferencesState {
  /** Properties page view mode */
  propertiesView: PropertiesViewMode;

  /** Available properties page view mode */
  availablePropertiesView: PropertiesViewMode;

  /** Tenants page view mode */
  tenantsView: StandardViewMode;

  /** Leases page view mode */
  leasesView: StandardViewMode;

  /** Active leases page view mode */
  activeLeasesView: StandardViewMode;

  /** Invoices page view mode */
  invoicesView: StandardViewMode;

  /** Maintenance page view mode */
  maintenanceView: StandardViewMode;

  /** Admin users page view mode */
  usersView: UsersViewMode;

  /** Calendar view mode */
  calendarView: CalendarViewMode;

  /** Expiring leases page view mode */
  expiringLeasesView: ExpiringLeasesViewMode;

  /** Emergency maintenance page view mode */
  emergencyMaintenanceView: StandardViewMode;

  /** Transactions page view mode */
  transactionsView: StandardViewMode;

  /** Bills page view mode */
  billsView: StandardViewMode;

  /** Expenses page view mode */
  expensesView: StandardViewMode;

  /** Vendors page view mode */
  vendorsView: StandardViewMode;

  /** Inspections page view mode */
  inspectionsView: StandardViewMode;

  /** Internal flag for SSR hydration tracking */
  _hasHydrated: boolean;
}

// ============================================================================
// STORE ACTIONS INTERFACE
// ============================================================================

/**
 * View preferences actions
 * Type-safe setters for each view preference
 */
export interface ViewPreferencesActions {
  /** Set properties page view mode */
  setPropertiesView: (view: PropertiesViewMode) => void;

  /** Set available properties page view mode */
  setAvailablePropertiesView: (view: PropertiesViewMode) => void;

  /** Set tenants page view mode */
  setTenantsView: (view: StandardViewMode) => void;

  /** Set leases page view mode */
  setLeasesView: (view: StandardViewMode) => void;

  /** Set active leases page view mode */
  setActiveLeasesView: (view: StandardViewMode) => void;

  /** Set invoices page view mode */
  setInvoicesView: (view: StandardViewMode) => void;

  /** Set maintenance page view mode */
  setMaintenanceView: (view: StandardViewMode) => void;

  /** Set admin users page view mode */
  setUsersView: (view: UsersViewMode) => void;

  /** Set calendar view mode */
  setCalendarView: (view: CalendarViewMode) => void;

  /** Set expiring leases page view mode */
  setExpiringLeasesView: (view: ExpiringLeasesViewMode) => void;

  /** Set emergency maintenance page view mode */
  setEmergencyMaintenanceView: (view: StandardViewMode) => void;

  /** Set transactions page view mode */
  setTransactionsView: (view: StandardViewMode) => void;

  /** Set bills page view mode */
  setBillsView: (view: StandardViewMode) => void;

  /** Set expenses page view mode */
  setExpensesView: (view: StandardViewMode) => void;

  /** Set vendors page view mode */
  setVendorsView: (view: StandardViewMode) => void;

  /** Set inspections page view mode */
  setInspectionsView: (view: StandardViewMode) => void;

  /** Reset all preferences to default values */
  resetToDefaults: () => void;

  /** Set hydration state (internal use) */
  setHasHydrated: (state: boolean) => void;
}

// ============================================================================
// COMBINED STORE TYPE
// ============================================================================

/**
 * Complete view preferences store type
 * Combines state and actions
 */
export type ViewPreferencesStore = ViewPreferencesState &
  ViewPreferencesActions;
