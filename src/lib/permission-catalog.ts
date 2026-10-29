import { UserRole } from "@/types";

export const SYSTEM_PERMISSIONS = [
  "user_management",
  "user_view",
  "role_management",
  "property_management",
  "property_view",
  "property_create",
  "property_edit",
  "property_delete",
  "tenant_management",
  "tenant_view",
  "tenant_create",
  "tenant_edit",
  "lease_management",
  "lease_view",
  "lease_create",
  "lease_edit",
  "maintenance_management",
  "maintenance_view",
  "maintenance_create",
  "maintenance_assign",
  "maintenance_requests",
  "work_orders",
  "maintenance_history",
  "financial_management",
  "financial_reports",
  "payment_processing",
  "payment_portal",
  "payment_history",
  "system_settings",
  "audit_logs",
  "backup_restore",
  "bulk_operations",
  "company_settings",
  "data_export",
  "reports_all",
  "reports_property",
  "reports_own",
  "advanced_analytics",
  "application_processing",
  "screening_management",
  "document_access",
  "document_management",
  "profile_management",

  // --- Owners -------------------------------------------------------------
  // Owners are clients of the office and their records carry bank details and
  // tax numbers, so reaching them is its own permission rather than a corner
  // of tenant work.
  "owner_management",
  "owner_view",
  "owner_create",
  "owner_edit",
  "owner_delete",
  "agreement_management",
  "agreement_view",
  "agreement_delete",

  // --- Destructive actions, separated per module ---------------------------
  // "Can edit a contract" and "can delete a contract" are different trusts,
  // and until now only properties distinguished them. Every one of these is
  // additive: a role that holds `*_management` keeps working, because the
  // route accepts either.
  "tenant_delete",
  "lease_delete",
  "payment_delete",
  "invoice_delete",
  "maintenance_delete",

  // --- Export, separated per module ---------------------------------------
  // "Can see the tenants list" and "can carry it out of the building as a
  // spreadsheet" are different trusts, which is why the review asked for
  // Export as its own column beside View, Add, Edit and Delete. `data_export`
  // above remains the umbrella the billing plan gates on; these say *what*
  // may leave.
  //
  // Additive, like the delete permissions: a role holding the matching
  // `*_management` permission still exports, so no existing role loses a
  // capability when these arrive.
  "property_export",
  "tenant_export",
  "owner_export",
  "lease_export",
  "payment_export",
  "maintenance_export",

  // --- Archive ------------------------------------------------------------
  // Three distinct decisions, not one: seeing what was deleted, putting it
  // back, and destroying it for good. An office assistant may need the first
  // two and must never have the third.
  "archive_view",
  "archive_restore",
  // Destroying a record irreversibly. Held ALONGSIDE the role rule in
  // lib/archive-access.ts: this permission cannot grant what that rule
  // refuses, it can only withhold it from someone the rule would allow.
  "permanent_delete",

  // --- The rest of View / Add / Edit / Delete / Export ---------------------
  // The review asks for those five to be granted separately, and the modules
  // below were each missing some of them: payments had only delete and
  // export, agreements could not separate adding from editing, maintenance
  // had no edit, inspections rode on property and maintenance rights. Each
  // route accepts the specific permission OR the module's umbrella, so no
  // existing role loses anything.
  "payment_view",
  "payment_create",
  "payment_edit",
  "maintenance_edit",
  "agreement_create",
  "agreement_edit",
  "agreement_export",
  "inspection_view",
  "inspection_create",
  "inspection_edit",
  "inspection_delete",
  "inspection_export",

  // --- Employees and finance, the same five ------------------------------
  // The two areas that still had one right for everything: employees had
  // "View users" and "Manage users", and finance had "Manage finances" over
  // invoices, expenses and the ledger alike. Additive like the rest: every
  // route still accepts `user_management` or `financial_management`.
  "user_create",
  "user_edit",
  "user_delete",
  "user_export",
  "invoice_view",
  "invoice_create",
  "invoice_edit",
  "invoice_export",
  "expense_view",
  "expense_create",
  "expense_edit",
  "expense_delete",
  "expense_export",
  // The ledger and the revenue and income-and-expense reports: read-only,
  // so viewing and exporting are all there is to grant.
  "accounting_view",
  "accounting_export",
  // The double-entry books (lib/accounting): seeing them, keeping them —
  // the chart, journals, transfers, settlements, payouts — and closing a
  // period, which locks everything on or before a date.
  "ledger_view",
  "ledger_manage",
  "ledger_close_period",
  // Purchases and payments (lib/accounting/purchases): suppliers, the bills
  // they send and the vouchers that pay them. View / Add / Edit / Delete
  // (cancel) / Export like every module. Two rights move money and are held
  // apart: approving a bill makes it owed, and paying a supplier writes the
  // voucher that takes money out of an account.
  "purchase_view",
  "purchase_create",
  "purchase_edit",
  "purchase_delete",
  "purchase_export",
  "purchase_approve",
  "purchase_pay",

  // --- Property listings (Marketing) ---------------------------------------
  // An office advertises vacant units on its own public page and works the
  // messages that come back. View / Add / Edit / Delete (archive) / Export
  // like every module, with the umbrella; publishing is its own right because
  // it puts words and a licence number in front of the public, and the inbox
  // is its own because it holds strangers' phone numbers.
  "listing_management",
  "listing_view",
  "listing_create",
  "listing_edit",
  "listing_delete",
  "listing_export",
  "listing_publish",
  "listing_inquiries",
] as const;

export type SystemPermission = (typeof SYSTEM_PERMISSIONS)[number];

export const SYSTEM_ROLE_PERMISSIONS: Record<
  UserRole,
  readonly SystemPermission[]
> = {
  // Platform super-admin holds every permission (acts above all organizations)
  [UserRole.SUPER_ADMIN]: SYSTEM_PERMISSIONS,
  [UserRole.ADMIN]: [
    "user_management",
    "user_view",
    "role_management",
    "property_management",
    "property_view",
    "property_create",
    "property_edit",
    "property_delete",
    "tenant_management",
    "tenant_view",
    "tenant_create",
    "tenant_edit",
    "lease_management",
    "lease_view",
    "lease_create",
    "lease_edit",
    "maintenance_management",
    "maintenance_view",
    "maintenance_create",
    "maintenance_assign",
    "maintenance_requests",
    "work_orders",
    "maintenance_history",
    "financial_management",
    "financial_reports",
    "payment_processing",
    "payment_portal",
    "payment_history",
    "system_settings",
    "audit_logs",
    "backup_restore",
    "bulk_operations",
    "company_settings",
    "data_export",
    // The per-module export rights, granted here so no existing admin loses
    // a capability when Export became its own column.
    "property_export",
    "tenant_export",
    "owner_export",
    "lease_export",
    "payment_export",
    "maintenance_export",
    "reports_all",
    "reports_property",
    "reports_own",
    "advanced_analytics",
    "application_processing",
    "screening_management",
    "document_access",
    "document_management",
    "profile_management",
    "owner_management",
    "owner_view",
    "owner_create",
    "owner_edit",
    "owner_delete",
    "agreement_management",
    "agreement_view",
    "agreement_delete",
    "tenant_delete",
    "lease_delete",
    "payment_delete",
    "invoice_delete",
    "maintenance_delete",
    "archive_view",
    "archive_restore",
    "permanent_delete",
    "payment_view",
    "payment_create",
    "payment_edit",
    "maintenance_edit",
    "agreement_create",
    "agreement_edit",
    "agreement_export",
    "inspection_view",
    "inspection_create",
    "inspection_edit",
    "inspection_delete",
    "inspection_export",
    "user_create",
    "user_edit",
    "user_delete",
    "user_export",
    "invoice_view",
    "invoice_create",
    "invoice_edit",
    "invoice_export",
    "expense_view",
    "expense_create",
    "expense_edit",
    "expense_delete",
    "expense_export",
    "accounting_view",
    "accounting_export",
    "ledger_view",
    "ledger_manage",
    "ledger_close_period",
    "purchase_view",
    "purchase_create",
    "purchase_edit",
    "purchase_delete",
    "purchase_export",
    "purchase_approve",
    "purchase_pay",
    // Property listings: the office's own staff run the Marketing section.
    "listing_management",
    "listing_view",
    "listing_create",
    "listing_edit",
    "listing_delete",
    "listing_export",
    "listing_publish",
    "listing_inquiries",
  ],
  [UserRole.MANAGER]: [
    "user_view",
    "property_management",
    "property_view",
    "property_create",
    "property_edit",
    "tenant_management",
    "tenant_view",
    "tenant_create",
    "tenant_edit",
    "lease_management",
    "lease_view",
    "lease_create",
    "lease_edit",
    "maintenance_management",
    "maintenance_view",
    "maintenance_create",
    "maintenance_assign",
    "work_orders",
    "maintenance_history",
    "financial_management",
    "financial_reports",
    "payment_processing",
    "company_settings",
    "document_management",
    "document_access",
    "reports_all",
    "reports_property",
    "bulk_operations",
    "application_processing",
    "screening_management",
    "profile_management",
    "owner_management",
    "owner_view",
    "owner_create",
    "owner_edit",
    "agreement_management",
    "agreement_view",
    "tenant_delete",
    "lease_delete",
    "invoice_delete",
    "maintenance_delete",
    // A manager runs the office day to day and already reads all of this on
    // screen, so withholding the file would only push them to retype it.
    "property_export",
    "tenant_export",
    "owner_export",
    "lease_export",
    "payment_export",
    "maintenance_export",
    "archive_view",
    "archive_restore",
    // What a manager already did through payment_processing,
    // agreement_management and property/maintenance management, now also
    // held as the separate rights a custom group can be given one at a time.
    "payment_view",
    "payment_create",
    "payment_edit",
    "maintenance_edit",
    "agreement_create",
    "agreement_edit",
    "agreement_export",
    "inspection_view",
    "inspection_create",
    "inspection_edit",
    "inspection_delete",
    "inspection_export",
    // What `financial_management` already let a manager do with invoices,
    // expenses and the ledger, held as the rights a group can be given one
    // at a time. Employees are not among them: a manager sees the list
    // (`user_view`) and administers nobody.
    "invoice_view",
    "invoice_create",
    "invoice_edit",
    "invoice_export",
    "expense_view",
    "expense_create",
    "expense_edit",
    "expense_delete",
    "expense_export",
    "accounting_view",
    "accounting_export",
    // The books as finance management already reached them; closing a
    // period stays with the administrator.
    "ledger_view",
    "ledger_manage",
    // Purchases and payments, as finance management already reached them.
    "purchase_view",
    "purchase_create",
    "purchase_edit",
    "purchase_delete",
    "purchase_export",
    "purchase_approve",
    "purchase_pay",
    // Property listings: the office's own staff run the Marketing section.
    "listing_management",
    "listing_view",
    "listing_create",
    "listing_edit",
    "listing_delete",
    "listing_export",
    "listing_publish",
    "listing_inquiries",
  ],
  // A property owner is a client of the office, not a member of it: they read
  // their own buildings and the money attached to them, and change nothing.
  // Every one of these is narrowed to their own rows by lib/db/scopes.ts —
  // property_view alone would otherwise show them the whole portfolio.
  [UserRole.OWNER]: [
    "profile_management",
    "property_view",
    "lease_view",
    "payment_history",
    "maintenance_history",
    "document_access",
    "reports_own",
  ],
  [UserRole.TENANT]: [
    "profile_management",
    "maintenance_requests",
    "payment_portal",
    "document_access",
    "lease_view",
    "payment_history",
    "maintenance_history",
    "reports_own",
  ],
};

/**
 * What each permission is called and does, in English.
 *
 * The role screen used to carry its own hardcoded copy of this list. That made
 * the catalogue and the UI two sources of truth, and they drifted the moment a
 * permission was added here — a capability the server enforced but no operator
 * could grant, because the screen had never heard of it.
 *
 * Deriving the screen from this map is also what the scope means by "any new
 * module must be manageable through the permission system without redesigning
 * it": add the permission to SYSTEM_PERMISSIONS, describe it here, and it
 * appears on the role screen with no further work.
 *
 * These strings are FALLBACKS. The UI still prefers
 * `admin.roles.permissions.<id>.{name,description,category}` when a locale has
 * translated it, so nothing already translated regresses.
 */
export interface PermissionMeta {
  label: string;
  description: string;
  /** Heading the role screen groups this permission under. */
  group: string;
}

const GROUP = {
  users: "User Management",
  properties: "Property Management",
  owners: "Owners & Agreements",
  tenants: "Tenant Management",
  leases: "Lease Management",
  maintenance: "Maintenance",
  inspections: "Inspections",
  financial: "Financial",
  archive: "Archive & Deletion",
  reports: "Reports & Analytics",
  documents: "Documents",
  marketing: "Marketing & Sales",
  system: "System",
} as const;

export const PERMISSION_METADATA: Record<SystemPermission, PermissionMeta> = {
  user_management: { label: "Manage users", description: "Create, edit and deactivate user accounts", group: GROUP.users },
  user_view: { label: "View users", description: "See the user directory", group: GROUP.users },
  user_create: { label: "Add employees", description: "Create employee accounts and send invitations", group: GROUP.users },
  user_edit: { label: "Edit employees", description: "Change an employee's details and account status", group: GROUP.users },
  user_delete: { label: "Delete employees", description: "Deactivate or remove an employee account", group: GROUP.users },
  user_export: { label: "Export employees", description: "Download the employee list", group: GROUP.users },
  role_management: { label: "Manage roles", description: "Create roles and set what each one may do", group: GROUP.users },

  property_management: { label: "Manage properties", description: "Full access to properties and units", group: GROUP.properties },
  property_view: { label: "View properties", description: "See properties and units", group: GROUP.properties },
  property_create: { label: "Add properties", description: "Register a new property or unit", group: GROUP.properties },
  property_edit: { label: "Edit properties", description: "Change property and unit details", group: GROUP.properties },
  property_delete: { label: "Delete properties", description: "Move a property or unit to the archive", group: GROUP.properties },

  owner_management: { label: "Manage owners", description: "Full access to owner records and payout details", group: GROUP.owners },
  owner_view: { label: "View owners", description: "See owners and their portfolios", group: GROUP.owners },
  owner_create: { label: "Add owners", description: "Register a new property owner", group: GROUP.owners },
  owner_edit: { label: "Edit owners", description: "Change owner details, bank and tax information", group: GROUP.owners },
  owner_delete: { label: "Delete owners", description: "Move an owner record to the archive", group: GROUP.owners },
  agreement_management: { label: "Manage agreements", description: "Create and edit management agreements", group: GROUP.owners },
  agreement_view: { label: "View agreements", description: "See management and investment agreements", group: GROUP.owners },
  agreement_delete: { label: "Delete agreements", description: "Move an agreement to the archive", group: GROUP.owners },
  agreement_create: { label: "Add agreements", description: "Register a new management or investment agreement", group: GROUP.owners },
  agreement_edit: { label: "Edit agreements", description: "Change an agreement's terms, fees and dates", group: GROUP.owners },
  agreement_export: { label: "Export agreements", description: "Download the agreement register and statements", group: GROUP.owners },

  tenant_management: { label: "Manage tenants", description: "Full access to tenant records", group: GROUP.tenants },
  tenant_view: { label: "View tenants", description: "See tenant records", group: GROUP.tenants },
  tenant_create: { label: "Add tenants", description: "Register a new tenant", group: GROUP.tenants },
  tenant_edit: { label: "Edit tenants", description: "Change tenant details", group: GROUP.tenants },
  tenant_delete: { label: "Delete tenants", description: "Move a tenant record to the archive", group: GROUP.tenants },

  lease_management: { label: "Manage contracts", description: "Full access to lease contracts", group: GROUP.leases },
  lease_view: { label: "View contracts", description: "See lease contracts and their installments", group: GROUP.leases },
  lease_create: { label: "Create contracts", description: "Draw up a new lease on behalf of an owner", group: GROUP.leases },
  lease_edit: { label: "Edit contracts", description: "Change contract terms, dates and amounts", group: GROUP.leases },
  lease_delete: { label: "Delete contracts", description: "Move a contract to the archive", group: GROUP.leases },

  maintenance_management: { label: "Manage maintenance", description: "Full access to maintenance requests", group: GROUP.maintenance },
  maintenance_view: { label: "View maintenance", description: "See maintenance requests", group: GROUP.maintenance },
  maintenance_create: { label: "Raise maintenance requests", description: "Log a new maintenance request", group: GROUP.maintenance },
  maintenance_assign: { label: "Assign maintenance", description: "Assign requests and work orders to staff", group: GROUP.maintenance },
  maintenance_requests: { label: "Submit own requests", description: "Raise a request for their own unit", group: GROUP.maintenance },
  maintenance_delete: { label: "Delete maintenance requests", description: "Move a maintenance request to the archive", group: GROUP.maintenance },
  work_orders: { label: "Work orders", description: "Create and update work orders", group: GROUP.maintenance },
  maintenance_edit: { label: "Edit maintenance requests", description: "Change a request's details, priority and status", group: GROUP.maintenance },

  inspection_view: { label: "View inspections", description: "See scheduled and completed inspections", group: GROUP.inspections },
  inspection_create: { label: "Schedule inspections", description: "Schedule a new inspection", group: GROUP.inspections },
  inspection_edit: { label: "Edit inspections", description: "Change an inspection and record its findings", group: GROUP.inspections },
  inspection_delete: { label: "Delete inspections", description: "Remove an inspection", group: GROUP.inspections },
  inspection_export: { label: "Export inspections", description: "Download inspection lists", group: GROUP.inspections },
  maintenance_history: { label: "Maintenance history", description: "See past maintenance work", group: GROUP.maintenance },

  financial_management: { label: "Manage finances", description: "Full access to invoices, payments and expenses", group: GROUP.financial },
  financial_reports: { label: "Financial reports", description: "Run and export financial reports", group: GROUP.financial },
  payment_processing: { label: "Collect payments", description: "Record and settle tenant payments", group: GROUP.financial },
  payment_portal: { label: "Pay online", description: "Use the tenant payment portal", group: GROUP.financial },
  payment_history: { label: "Payment history", description: "See past payments and receipts", group: GROUP.financial },
  payment_delete: { label: "Delete payments", description: "Move a payment record to the archive", group: GROUP.financial },
  payment_view: { label: "View payments", description: "See payments and what each one paid", group: GROUP.financial },
  payment_create: { label: "Record payments", description: "Record a payment against an installment", group: GROUP.financial },
  payment_edit: { label: "Edit payments", description: "Change a payment's details — never the amount once money is recorded", group: GROUP.financial },
  invoice_delete: { label: "Delete invoices", description: "Move an invoice to the archive", group: GROUP.financial },
  invoice_view: { label: "View invoices", description: "See invoices and what is still owed on each", group: GROUP.financial },
  invoice_create: { label: "Create invoices", description: "Raise a new invoice", group: GROUP.financial },
  invoice_edit: { label: "Edit invoices", description: "Change an invoice, mark it sent and send reminders", group: GROUP.financial },
  invoice_export: { label: "Export invoices", description: "Download invoice lists", group: GROUP.financial },
  expense_view: { label: "View expenses", description: "See expenses and their status", group: GROUP.financial },
  expense_create: { label: "Record expenses", description: "Record a new expense", group: GROUP.financial },
  expense_edit: { label: "Edit expenses", description: "Change an expense and approve or pay it", group: GROUP.financial },
  expense_delete: { label: "Delete expenses", description: "Cancel and remove an expense", group: GROUP.financial },
  expense_export: { label: "Export expenses", description: "Download expense lists", group: GROUP.financial },
  accounting_view: { label: "View accounting", description: "See the transaction ledger, revenue and the income and expense reports", group: GROUP.financial },
  accounting_export: { label: "Export accounting", description: "Download the ledger and the financial reports", group: GROUP.financial },
  ledger_view: { label: "View the books", description: "See the chart of accounts, the journal, the bank accounts and owners' balances", group: GROUP.financial },
  ledger_manage: { label: "Keep the books", description: "Set up accounting, edit the chart of accounts, post journals, transfers, owner settlements and payouts", group: GROUP.financial },
  ledger_close_period: { label: "Close accounting periods", description: "Lock the books through a date so nothing can be posted on or before it", group: GROUP.financial },
  purchase_view: { label: "View purchases", description: "See suppliers, purchase bills, payment vouchers and the payables aging", group: GROUP.financial },
  purchase_create: { label: "Enter purchases", description: "Add a supplier and enter a supplier's bill", group: GROUP.financial },
  purchase_edit: { label: "Edit purchases", description: "Change a supplier, or a bill that is waiting for approval, and send an approved bill back", group: GROUP.financial },
  purchase_delete: { label: "Cancel purchases", description: "Cancel a bill nothing has been paid on, and remove a supplier never used", group: GROUP.financial },
  purchase_export: { label: "Export purchases", description: "Download the purchase lists, the payables aging and the registers", group: GROUP.financial },
  purchase_approve: { label: "Approve purchase bills", description: "Approve a supplier's bill, which makes it owed and puts it on the books", group: GROUP.financial },
  purchase_pay: { label: "Pay suppliers", description: "Write payment vouchers out of the bank and cash accounts, and cancel them", group: GROUP.financial },

  archive_view: { label: "View archive", description: "See records that have been deleted", group: GROUP.archive },
  archive_restore: { label: "Restore from archive", description: "Put a deleted record back", group: GROUP.archive },
  permanent_delete: { label: "Permanently delete", description: "Destroy an archived record for good — this cannot be undone", group: GROUP.archive },

  reports_all: { label: "All reports", description: "Run every report in the system", group: GROUP.reports },
  reports_property: { label: "Property reports", description: "Run reports for assigned properties", group: GROUP.reports },
  reports_own: { label: "Own reports", description: "Run reports covering only their own records", group: GROUP.reports },
  advanced_analytics: { label: "Advanced analytics", description: "Use the analytics dashboards", group: GROUP.reports },
  data_export: { label: "Export data", description: "Download reports and data as Excel, PDF or CSV", group: GROUP.reports },
  property_export: { label: "Export properties", description: "Download compound, building and unit lists", group: GROUP.reports },
  tenant_export: { label: "Export tenants", description: "Download tenant lists", group: GROUP.reports },
  owner_export: { label: "Export owners", description: "Download owner lists, agreements and statements", group: GROUP.reports },
  lease_export: { label: "Export contracts", description: "Download lease registers and installment schedules", group: GROUP.reports },
  payment_export: { label: "Export payments", description: "Download payment, invoice and collection figures", group: GROUP.reports },
  maintenance_export: { label: "Export maintenance", description: "Download maintenance and inspection lists", group: GROUP.reports },

  document_access: { label: "View documents", description: "Open stored documents", group: GROUP.documents },
  document_management: { label: "Manage documents", description: "Upload, replace and remove documents", group: GROUP.documents },

  application_processing: { label: "Process applications", description: "Review and decide tenant applications", group: GROUP.tenants },
  screening_management: { label: "Tenant screening", description: "Run and review screening checks", group: GROUP.tenants },

  system_settings: { label: "System settings", description: "Change organization-wide settings", group: GROUP.system },
  company_settings: { label: "Company settings", description: "Change company details and branding", group: GROUP.system },
  audit_logs: { label: "Audit log", description: "Read the record of who did what", group: GROUP.system },
  backup_restore: { label: "Backup and restore", description: "Take and restore backups", group: GROUP.system },
  bulk_operations: { label: "Bulk operations", description: "Import data and run bulk actions", group: GROUP.system },
  listing_management: { label: "Manage listings", description: "Full access to property listings, their publication and the inquiries they bring", group: GROUP.marketing },
  listing_view: { label: "View listings", description: "See the property listings and their inquiries count", group: GROUP.marketing },
  listing_create: { label: "Add listings", description: "Start an advertisement for a vacant unit", group: GROUP.marketing },
  listing_edit: { label: "Edit listings", description: "Change a listing's text, price, photos and licence", group: GROUP.marketing },
  listing_delete: { label: "Archive listings", description: "Archive a listing, which takes it off the public page", group: GROUP.marketing },
  listing_export: { label: "Export listings", description: "Download the listings and the inquiries lists", group: GROUP.marketing },
  listing_publish: { label: "Publish listings", description: "Put a listing on the public page, or take it off", group: GROUP.marketing },
  listing_inquiries: { label: "Handle listing inquiries", description: "Read the messages the public pages bring, assign them and note the follow-up", group: GROUP.marketing },

  profile_management: { label: "Own profile", description: "Edit their own profile and preferences", group: GROUP.system },
};
