/**
 * PropertyPro - Permissions laid out as the review draws them
 *
 * "Allow permissions to be defined separately for View, Add, Edit, Delete,
 * and Export." The catalogue holds those rights as flat strings; this maps
 * each module to its five, so the permission-group screen can show a table —
 * a row per module, a column per action — instead of a wall of checkboxes.
 *
 * `full` is the module's umbrella right (`*_management`). Every route accepts
 * it in place of any of the five, so a group holding it can do everything in
 * that module, including actions added later. Modules without a clean
 * umbrella of their own have none: payments' nearest is
 * `financial_management`, which also covers invoices and expenses and so is
 * granted on its own, not as "all of payments".
 */

import type { SystemPermission } from "@/lib/permission-catalog";

export const PERMISSION_ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "export",
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export interface PermissionModule {
  id: string;
  /** English name, used until a locale translates `admin.roles.matrix.modules.<id>`. */
  fallback: string;
  actions: Partial<Record<PermissionAction, SystemPermission>>;
  full?: SystemPermission;
  /**
   * Wider rights that grant every action here without being this module's
   * own umbrella: `financial_management` is all of finance at once, so it
   * cannot be ticked off one module at a time. A module it covers reads as
   * granted, and its cells stay locked until the wider right is taken away.
   */
  coveredBy?: readonly SystemPermission[];
}

export const PERMISSION_MODULES: readonly PermissionModule[] = [
  {
    id: "properties",
    fallback: "Compounds, buildings & units",
    actions: {
      view: "property_view",
      create: "property_create",
      edit: "property_edit",
      delete: "property_delete",
      export: "property_export",
    },
    full: "property_management",
  },
  {
    id: "owners",
    fallback: "Owners",
    actions: {
      view: "owner_view",
      create: "owner_create",
      edit: "owner_edit",
      delete: "owner_delete",
      export: "owner_export",
    },
    full: "owner_management",
  },
  {
    id: "agreements",
    fallback: "Management agreements",
    actions: {
      view: "agreement_view",
      create: "agreement_create",
      edit: "agreement_edit",
      delete: "agreement_delete",
      export: "agreement_export",
    },
    full: "agreement_management",
  },
  {
    id: "tenants",
    fallback: "Clients (tenants)",
    actions: {
      view: "tenant_view",
      create: "tenant_create",
      edit: "tenant_edit",
      delete: "tenant_delete",
      export: "tenant_export",
    },
    full: "tenant_management",
  },
  {
    id: "leases",
    fallback: "Lease contracts",
    actions: {
      view: "lease_view",
      create: "lease_create",
      edit: "lease_edit",
      delete: "lease_delete",
      export: "lease_export",
    },
    full: "lease_management",
  },
  {
    id: "payments",
    fallback: "Payments & installments",
    actions: {
      view: "payment_view",
      create: "payment_create",
      edit: "payment_edit",
      delete: "payment_delete",
      export: "payment_export",
    },
    coveredBy: ["financial_management"],
  },
  {
    id: "maintenance",
    fallback: "Maintenance",
    actions: {
      view: "maintenance_view",
      create: "maintenance_create",
      edit: "maintenance_edit",
      delete: "maintenance_delete",
      export: "maintenance_export",
    },
    full: "maintenance_management",
  },
  {
    id: "inspections",
    fallback: "Inspections",
    actions: {
      view: "inspection_view",
      create: "inspection_create",
      edit: "inspection_edit",
      delete: "inspection_delete",
      export: "inspection_export",
    },
  },
  {
    id: "employees",
    fallback: "Employees",
    actions: {
      view: "user_view",
      create: "user_create",
      edit: "user_edit",
      delete: "user_delete",
      export: "user_export",
    },
    full: "user_management",
  },
  {
    id: "invoices",
    fallback: "Invoices",
    actions: {
      view: "invoice_view",
      create: "invoice_create",
      edit: "invoice_edit",
      delete: "invoice_delete",
      export: "invoice_export",
    },
    coveredBy: ["financial_management"],
  },
  {
    id: "expenses",
    fallback: "Expenses",
    actions: {
      view: "expense_view",
      create: "expense_create",
      edit: "expense_edit",
      delete: "expense_delete",
      export: "expense_export",
    },
    coveredBy: ["financial_management"],
  },
  {
    // Suppliers, the bills they send and the vouchers that pay them. Approving
    // a bill and paying a supplier are rights of their own (see
    // permission-departments.ts), because they put money on the books and take
    // it out of an account.
    id: "purchases",
    fallback: "Purchases & payments",
    actions: {
      view: "purchase_view",
      create: "purchase_create",
      edit: "purchase_edit",
      // Cancelling: a bill or a voucher is never destroyed, it is cancelled.
      delete: "purchase_delete",
      export: "purchase_export",
    },
    coveredBy: ["financial_management"],
  },
  {
    id: "listings",
    fallback: "Property listings",
    actions: {
      view: "listing_view",
      create: "listing_create",
      edit: "listing_edit",
      // Archiving: a listing is taken off the public page, never destroyed.
      delete: "listing_delete",
      export: "listing_export",
    },
    full: "listing_management",
  },
  {
    // Read-only: the ledger and the reports are views over what the other
    // modules recorded, so there is nothing to add, edit or delete here.
    id: "accounting",
    fallback: "Accounting ledger",
    actions: {
      view: "accounting_view",
      export: "accounting_export",
    },
    coveredBy: ["financial_management"],
  },
];

/** Every permission the table shows, so the rest can be listed beneath it. */
export const MATRIX_PERMISSIONS: ReadonlySet<string> = new Set(
  PERMISSION_MODULES.flatMap((module) => [
    ...Object.values(module.actions),
    ...(module.full ? [module.full] : []),
  ]),
);

/** The permissions a module's row grants when everything in it is ticked. */
export function modulePermissions(module: PermissionModule): SystemPermission[] {
  return [
    ...(Object.values(module.actions) as SystemPermission[]),
    ...(module.full ? [module.full] : []),
  ];
}

/**
 * Whether a cell reads as granted: held itself, or covered by the module's
 * umbrella — which the routes accept in its place.
 */
export function isGranted(
  selected: readonly string[],
  module: PermissionModule,
  action: PermissionAction,
): boolean {
  const permission = module.actions[action];
  if (!permission) return false;
  return (
    selected.includes(permission) ||
    Boolean(module.full && selected.includes(module.full))
  );
}

/** Whether a wider right the caller holds already grants the whole module. */
export function isCovered(
  selected: readonly string[],
  module: PermissionModule,
): boolean {
  return (module.coveredBy ?? []).some((permission) =>
    selected.includes(permission),
  );
}

/**
 * Tick or untick one cell.
 *
 * Unticking a cell the umbrella was covering drops the umbrella and keeps the
 * other actions — the group loses exactly the one right, not the module.
 */
export function toggleAction(
  selected: readonly string[],
  module: PermissionModule,
  action: PermissionAction,
  granted: boolean,
): string[] {
  const permission = module.actions[action];
  if (!permission) return [...selected];
  const next = new Set(selected);
  if (granted) {
    next.add(permission);
    return [...next];
  }
  if (module.full && next.has(module.full)) {
    next.delete(module.full);
    for (const other of Object.values(module.actions)) {
      if (other) next.add(other);
    }
  }
  next.delete(permission);
  return [...next];
}

/** Tick or untick a whole row, umbrella included. */
export function toggleModule(
  selected: readonly string[],
  module: PermissionModule,
  granted: boolean,
): string[] {
  const next = new Set(selected);
  for (const permission of modulePermissions(module)) {
    if (granted) next.add(permission);
    else next.delete(permission);
  }
  return [...next];
}

/** A row is fully granted when its umbrella is held, or all five are. */
export function isModuleFull(
  selected: readonly string[],
  module: PermissionModule,
): boolean {
  if (module.full && selected.includes(module.full)) return true;
  return PERMISSION_ACTIONS.every(
    (action) => !module.actions[action] || isGranted(selected, module, action),
  );
}
