/**
 * PropertyPro - The permission-group page, laid out by department
 *
 * The client's reference page is a box per department of the office —
 * Dashboard, Finance & Accounts, Collections, Marketing & Sales, Properties &
 * Operations, Customer Affairs, Employee Management — each with a tick for
 * the whole box and its sub-permissions underneath, and a Select All over
 * everything. This file is that layout and nothing else: which right sits in
 * which box. The rights themselves stay in lib/permission-catalog.ts and the
 * module × action table in lib/permission-matrix.ts, which a box reuses for
 * every sub-permission that has View, Add, Edit, Delete and Export.
 *
 * Two boxes follow the client's seven: Archive, which the review keeps as a
 * menu of its own, and System, for the settings rights. Without them those
 * rights could not be granted from the page at all.
 *
 * Every permission in the catalogue is either in exactly one box or listed in
 * PERMISSIONS_NOT_ON_THE_PAGE with the reason — the test beside this file
 * holds that, so a permission added later cannot quietly go ungrantable.
 */

import type { SystemPermission } from "@/lib/permission-catalog";
import {
  PERMISSION_MODULES,
  isCovered,
  isGranted,
  isModuleFull,
  modulePermissions,
  toggleModule,
  type PermissionModule,
} from "@/lib/permission-matrix";

/** One line inside a box. */
export type DepartmentEntry =
  /** A module: one tick, and View / Add / Edit / Delete / Export beneath it. */
  | { kind: "module"; module: PermissionModule }
  /** One right, one tick. */
  | { kind: "single"; permission: SystemPermission }
  /**
   * Something every employee has, shown ticked and locked so the box reads
   * as the client drew it. It grants nothing and is never stored.
   */
  | { kind: "always"; id: string; fallback: string };

export interface PermissionDepartment {
  id: string;
  /** English name, used until a locale translates `admin.roles.departments.<id>`. */
  fallback: string;
  entries: readonly DepartmentEntry[];
}

function moduleEntry(id: string): DepartmentEntry {
  const found = PERMISSION_MODULES.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`No permission module "${id}"`);
  }
  return { kind: "module", module: found };
}

const single = (permission: SystemPermission): DepartmentEntry => ({
  kind: "single",
  permission,
});

export const PERMISSION_DEPARTMENTS: readonly PermissionDepartment[] = [
  {
    id: "dashboard",
    fallback: "Dashboard",
    entries: [
      // The overview is every employee's first screen, open to all staff on
      // purpose; what it shows is narrowed by their buildings, not by this.
      { kind: "always", id: "dashboardView", fallback: "View" },
      single("data_export"),
    ],
  },
  {
    id: "finance",
    fallback: "Finance & Accounts",
    entries: [
      single("financial_reports"),
      moduleEntry("invoices"),
      moduleEntry("expenses"),
      // Suppliers, their bills and the vouchers that pay them; approving a
      // bill and paying a supplier are rights of their own.
      moduleEntry("purchases"),
      single("purchase_approve"),
      single("purchase_pay"),
      moduleEntry("accounting"),
      // The double-entry books: seeing them, keeping them, closing a period.
      single("ledger_view"),
      single("ledger_manage"),
      single("ledger_close_period"),
      // All of finance, payments included, and whatever is added to it.
      single("financial_management"),
    ],
  },
  {
    id: "collections",
    fallback: "Collections",
    entries: [
      moduleEntry("payments"),
      single("payment_processing"),
      single("payment_history"),
    ],
  },
  {
    id: "marketing",
    fallback: "Marketing & Sales",
    entries: [
      moduleEntry("leases"),
      single("application_processing"),
      single("screening_management"),
      // Property listings: the ads, and the inbox their messages land in.
      moduleEntry("listings"),
      single("listing_publish"),
      single("listing_inquiries"),
    ],
  },
  {
    id: "operations",
    fallback: "Operations & Management",
    entries: [
      moduleEntry("properties"),
      moduleEntry("agreements"),
      moduleEntry("maintenance"),
      moduleEntry("inspections"),
    ],
  },
  {
    id: "customers",
    fallback: "Customer Affairs",
    entries: [moduleEntry("owners"), moduleEntry("tenants")],
  },
  {
    id: "employees",
    fallback: "Employee Management",
    entries: [
      moduleEntry("employees"),
      single("role_management"),
      // The client's "Maintenance crew": who is sent to a job.
      single("maintenance_assign"),
      single("work_orders"),
    ],
  },
  {
    id: "archive",
    fallback: "Archive",
    entries: [
      single("archive_view"),
      single("archive_restore"),
      single("permanent_delete"),
    ],
  },
  {
    id: "system",
    fallback: "System & Settings",
    entries: [
      single("system_settings"),
      single("company_settings"),
      single("bulk_operations"),
      single("audit_logs"),
      single("document_access"),
      single("document_management"),
    ],
  },
];

/**
 * Catalogue permissions the page does not offer, and why.
 *
 * They stay in the catalogue — stored groups may hold them and are saved
 * with them untouched — but a tick for any of these would either do nothing
 * or belong to a client rather than to staff.
 */
export const PERMISSIONS_NOT_ON_THE_PAGE: Readonly<
  Partial<Record<SystemPermission, string>>
> = {
  profile_management: "Everyone who signs in holds it.",
  payment_portal: "A tenant's: paying online.",
  maintenance_requests: "A tenant's: raising a request for their own unit.",
  reports_own: "A client's: reports over their own records.",
  reports_all: "No screen or route asks for it.",
  reports_property: "No screen or route asks for it.",
  advanced_analytics: "A plan feature, not a permission any route asks for.",
  backup_restore: "No screen or route asks for it.",
  maintenance_history: "No screen or route asks for it.",
};

export type SelectionState = "all" | "some" | "none";

/** Every right a box grants when it is ticked. */
export function departmentPermissions(
  department: PermissionDepartment,
): SystemPermission[] {
  return department.entries.flatMap((entry) => {
    if (entry.kind === "module") return modulePermissions(entry.module);
    if (entry.kind === "single") return [entry.permission];
    return [];
  });
}

/** Every right the page can grant. */
export const PAGE_PERMISSIONS: readonly SystemPermission[] = [
  ...new Set(PERMISSION_DEPARTMENTS.flatMap(departmentPermissions)),
];

/**
 * How much of a module is granted.
 *
 * "all" when the module is full — its umbrella, all five, or a wider right
 * that covers it — "some" when any action is, else "none".
 */
export function moduleState(
  selected: readonly string[],
  module: PermissionModule,
): SelectionState {
  if (isCovered(selected, module) || isModuleFull(selected, module)) {
    return "all";
  }
  const anyAction = Object.keys(module.actions).some((action) =>
    isGranted(selected, module, action as keyof PermissionModule["actions"]),
  );
  return anyAction ? "some" : "none";
}

function entryState(
  selected: readonly string[],
  entry: DepartmentEntry,
): SelectionState | null {
  if (entry.kind === "module") return moduleState(selected, entry.module);
  if (entry.kind === "single") {
    return selected.includes(entry.permission) ? "all" : "none";
  }
  return null;
}

function combine(states: readonly (SelectionState | null)[]): SelectionState {
  const counted = states.filter((state): state is SelectionState => state !== null);
  if (counted.length === 0) return "none";
  if (counted.every((state) => state === "all")) return "all";
  if (counted.every((state) => state === "none")) return "none";
  return "some";
}

/** How much of a box is ticked, for its tri-state heading. */
export function departmentState(
  selected: readonly string[],
  department: PermissionDepartment,
): SelectionState {
  return combine(department.entries.map((entry) => entryState(selected, entry)));
}

/** How much of the whole page is ticked, for Select All. */
export function pageState(selected: readonly string[]): SelectionState {
  return combine(
    PERMISSION_DEPARTMENTS.map((department) =>
      departmentState(selected, department),
    ),
  );
}

function applyEntry(
  selected: readonly string[],
  entry: DepartmentEntry,
  granted: boolean,
): string[] {
  if (entry.kind === "module") {
    return toggleModule(selected, entry.module, granted);
  }
  if (entry.kind === "single") {
    const next = new Set(selected);
    if (granted) next.add(entry.permission);
    else next.delete(entry.permission);
    return [...next];
  }
  return [...selected];
}

/**
 * Tick or untick a whole box.
 *
 * Only the box's own rights move: a right another box holds, or one the page
 * does not show at all, is left as it was.
 */
export function toggleDepartment(
  selected: readonly string[],
  department: PermissionDepartment,
  granted: boolean,
): string[] {
  return department.entries.reduce<string[]>(
    (next, entry) => applyEntry(next, entry, granted),
    [...selected],
  );
}

/**
 * Select All, or clear everything.
 *
 * Everything the page offers; what it does not offer is kept, so a stored
 * group saved from this page never loses a right nobody could see.
 */
export function togglePage(
  selected: readonly string[],
  granted: boolean,
): string[] {
  return PERMISSION_DEPARTMENTS.reduce<string[]>(
    (next, department) => toggleDepartment(next, department, granted),
    [...selected],
  );
}

/** Tick or untick one module's line — all its actions and its umbrella. */
export function toggleModuleEntry(
  selected: readonly string[],
  module: PermissionModule,
  granted: boolean,
): string[] {
  return toggleModule(selected, module, granted);
}
