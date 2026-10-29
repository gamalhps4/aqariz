/**
 * Shared dashboard data contracts between API routes and client components.
 */

export type DashboardAlertType = "payment" | "maintenance" | "lease" | "tenant";
export type DashboardAlertSeverity = "low" | "medium" | "high" | "critical";
export type DashboardActivityType = "payment" | "maintenance" | "lease" | "event";
export type DashboardTaskPriority = "low" | "medium" | "high" | "urgent";
export type DashboardRevenueTrendRange = "7d" | "30d" | "12m" | "lastYear";
export type DashboardTrendGranularity = "day" | "month";

export interface DashboardMaintenanceSummary {
  total: number;
  open: number;
  inProgress: number;
  completed: number;
  urgent: number;
}

/**
 * The money cards. Installment balances by due date, not payment rows:
 * `overdue` is rent overdue as at today, `pending` the rent falling due from
 * today to the end of the month, each with its number of installments;
 * `collected` is what came in this month, and `totalDue` what this month's
 * installments bill.
 */
export interface DashboardPaymentsSummary {
  collected: number;
  collectedCount: number;
  pending: number;
  pendingCount: number;
  overdue: number;
  overdueCount: number;
  totalDue: number;
}

/**
 * The days the money cards cover, as "2026-10-31", so each card opens its
 * report on exactly the window its figure was counted over.
 */
export interface DashboardWindows {
  /** Overdue is as at this day; revenue and expenses run to it. */
  today: string;
  /** Revenue, expenses and net income run from this day. */
  monthStart: string;
  /** Due runs from today to this day; the collection rate covers the month. */
  monthEnd: string;
}

export interface DashboardOverviewMetrics {
  totalProperties: number;
  /** Residential complexes the buildings are grouped into. */
  totalCompounds: number;
  /** A building is a property: the same count, in the client's word. */
  totalBuildings: number;
  /** Units, occupied and vacant as the occupancy report counts them today. */
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  /** Out of service with nobody in them; not counted as vacant. */
  maintenanceUnits: number;
  /** Occupied ÷ (occupied + vacant), as the occupancy report rates it. */
  occupancyRate: number;
  /** Money received from the first of the month to today. */
  monthlyRevenue: number;
  yearlyRevenue: number;
  /** Approved and paid expenses from the first of the month to today. */
  monthlyExpenses: number;
  /** monthlyRevenue − monthlyExpenses. */
  monthlyNetIncome: number;
  averageRent: number;
  collectionRate: number;
  totalTenants: number;
  activeTenants: number;
  pendingApplications: number;
  /** Contracts running today — the active register's count. */
  activeLeases: number;
  /** Contracts ending in the next thirty days — the expiring-soon register. */
  expiringLeases: number;
  /** Tenants with rent overdue — the overdue tenants report's count. */
  overdueTenants: number;
  windows: DashboardWindows;
  maintenanceRequests: DashboardMaintenanceSummary;
  payments: DashboardPaymentsSummary;
}

export interface DashboardAlert {
  id: string;
  type: DashboardAlertType;
  title: string;
  message: string;
  severity: DashboardAlertSeverity;
  count: number;
}

export interface DashboardTrendPoint {
  month: string;
  label?: string;
  periodStart?: string;
  granularity?: DashboardTrendGranularity;
  totalRevenue: number;
  totalExpenses: number;
  maintenance: number;
  occupancy: number;
}

export interface DashboardActivity {
  id: string;
  type: DashboardActivityType;
  /** English wording; the page words the line from `parts` when present. */
  description: string;
  parts?: {
    /** Tenant name. */
    party?: string;
    /** Payment type ("rent") or lease status ("terminated"), as stored. */
    kind?: string;
    /** Maintenance request title, as the tenant wrote it. */
    title?: string;
    /** Building name; absent when the record has none. */
    place?: string;
  };
  timestamp: string;
  status?: string;
  amount?: number;
  priority?: string;
  /** Deep link to the underlying record; rows without one render unclickable. */
  href?: string;
}

export interface DashboardTask {
  id: string;
  /** English wording; the page words the line from `parts` when present. */
  title: string;
  /**
   * The pieces of the title, as stored, so the page can word it in the
   * reader's language: `lease_renewal` → "{party} ({place})",
   * `maintenance` → "{title} ({place})", an event → its own `title`.
   */
  parts?: {
    /** The event's or maintenance request's own title, as typed. */
    title?: string;
    /** Tenant name. */
    party?: string;
    /** Building name; absent when the record has none. */
    place?: string;
  };
  dueDate: string;
  priority: DashboardTaskPriority;
  type: string;
}

export interface DashboardPropertyTypeSlice {
  /** English label; the page shows the category's name in its language. */
  name: string;
  /** The stored category slug ("villa", "apartment"), or "unknown". */
  type?: string;
  value: number;
  color: string;
}

export interface DashboardOverviewResponse {
  overview: DashboardOverviewMetrics;
  alerts: DashboardAlert[];
  trends: {
    revenue: DashboardTrendPoint[];
    revenueByRange?: Partial<
      Record<DashboardRevenueTrendRange, DashboardTrendPoint[]>
    >;
  };
  propertyTypes: DashboardPropertyTypeSlice[];
  recentActivities: DashboardActivity[];
  upcomingTasks: DashboardTask[];
}
