/**
 * PropertyPro - The menu, and the modules a package can include
 *
 * One tree, read by everything that has to agree on it:
 *
 *   - the sidebar and the ⌘K palette draw it;
 *   - the page guard (components/layout/module-guard.tsx) decides from it
 *     whether a dashboard URL opens or shows the upgrade card;
 *   - the API gate (lib/api-utils.ts) decides from it whether a request is
 *     answered or refused with 402;
 *   - the Super Admin's package form (/admin/plans) shows it as the module
 *     tree a package is built from.
 *
 * Every SECTION and every ITEM carries a module `key`. A package stores the
 * keys it includes in `Plan.features` (see lib/billing/modules.ts for how the
 * list is read: a section key alone means the whole section, today's items and
 * any added later). Keys are permanent — they are stored data. Rename a label
 * freely; never rename a key.
 *
 * Keys always contain a dot. The flat keys a package stored before this tree
 * existed ("maintenance", "advanced_analytics", ...) never do, which is how a
 * stored list is recognised as the old format and translated (`legacy` below).
 *
 * Pure data: no React, no database. The icon is a name the sidebar maps to a
 * component, so the API gate can import this file without pulling a UI kit.
 *
 * ADDING A SECTION: add it in menu order, with `section.<id>` as its key and
 * `<id>.<item>` keys for its items, the i18n keys in every locale (common.json,
 * or the module's own namespace — modules.test.ts reads common, platform and
 * marketing), and the API and page prefixes it owns. No `legacy` entry: a new
 * module starts switched off in every existing package until the Super Admin
 * ticks it — unless it names `defaultPlans`, the packages it starts on in
 * (lib/billing/modules.ts, "Modules added later").
 */

import { UserRole } from "@/types";
import type { SidebarCounts } from "@/hooks/useSidebarCounts";
import {
  ACCOUNTING_READ_PERMISSIONS,
  EXPENSE_READ_PERMISSIONS,
  INVOICE_LIST_PERMISSIONS,
  LEDGER_VIEW_PERMISSIONS,
  PURCHASE_VIEW_PERMISSIONS,
} from "@/lib/finance-permissions";

/** The lucide icons the menu uses, by name (mapped in the sidebar). */
export type MenuIconName =
  | "AlertTriangle"
  | "Archive"
  | "ArrowLeftRight"
  | "Ban"
  | "BarChart3"
  | "Bell"
  | "Briefcase"
  | "Building"
  | "Building2"
  | "Calculator"
  | "Calendar"
  | "CalendarClock"
  | "CalendarX"
  | "ClipboardCheck"
  | "Clock"
  | "CreditCard"
  | "DoorOpen"
  | "Download"
  | "FileBarChart"
  | "FilePlus"
  | "FileSignature"
  | "FileText"
  | "FileUp"
  | "Grid3X3"
  | "HandCoins"
  | "Handshake"
  | "Home"
  | "Inbox"
  | "KeyRound"
  | "Mail"
  | "Megaphone"
  | "MessageSquare"
  | "MessageSquareHeart"
  | "Palette"
  | "Percent"
  | "Plus"
  | "Receipt"
  | "RefreshCw"
  | "ScrollText"
  | "Settings"
  | "Shield"
  | "ShieldCheck"
  | "Tags"
  | "TicketCheck"
  | "TrendingDown"
  | "TrendingUp"
  | "User"
  | "UserCog"
  | "UserPlus"
  | "UserRound"
  | "Users"
  | "Wallet"
  | "Wrench";

/**
 * The report pages that pick their report from `?type=`, and the API behind
 * each. A report with its own menu entry is its own module, so the page guard
 * and the API gate both read the type — with the page's own default when the
 * link carries none (the page opens its default report then).
 */
export const REPORT_ENDPOINTS = [
  {
    page: "/dashboard/payments/reports",
    api: "/api/payments/reports",
    defaultType: "overdue",
  },
  {
    page: "/dashboard/leases/reports",
    api: "/api/leases/reports",
    defaultType: "active",
  },
  {
    page: "/dashboard/properties/reports",
    api: "/api/properties/reports",
    defaultType: "occupancy",
  },
] as const;

export type ReportEndpointPage = (typeof REPORT_ENDPOINTS)[number]["page"];

export interface MenuNode {
  /** Module key, stored in Plan.features. Permanent; always contains a dot. */
  key: string;
  /** i18n key of the label (common.json `nav.*`). */
  title: string;
  /** English label: the fallback, the API's 402 message and ⌘K matching. */
  label: string;
  /** Where the entry leads. A group's href is only its expansion key; a
   * capability has none (""). */
  href: string;
  icon: MenuIconName;
  roles: UserRole[];
  /** For permission groups: at least one of these is required to see it. */
  requiredPermissions?: readonly string[];
  /** The sidebar badge this entry shows. */
  countKey?: keyof SidebarCounts;
  /**
   * In every package, never switched off: the Super Admin sees it locked on.
   */
  alwaysOn?: boolean;
  /**
   * The keys a package stored before this tree existed that include this
   * module, so no office loses a screen on deploy. "*" stands for "every
   * package in the old format": the screens that were never plan-gated.
   */
  legacy?: readonly string[];
  /** A module that is not a menu entry (a report reached from a page, a
   * capability such as export). The package form still lists it. */
  hidden?: boolean;
  /**
   * Further page prefixes this module owns, beyond its own href — detail
   * pages a tenant reaches under a staff path, a page with no menu entry.
   */
  pages?: readonly string[];
  /** API prefixes this module owns (matched on segment boundaries). */
  apis?: readonly string[];
  /** Further report types it owns on a report endpoint, beyond its href's. */
  reports?: ReadonlyArray<{
    endpoint: ReportEndpointPage;
    types: readonly string[];
  }>;
  /** The Super Admin is warned before saving a package without it. */
  essential?: boolean;
  /**
   * For a module added after packages were saved: the packages (plan keys)
   * it starts on in, until the Super Admin saves one without it.
   */
  defaultPlans?: readonly string[];
  children?: MenuNode[];
}

export interface MenuSection {
  /** `section.<id>`, or null for a single entry drawn without a heading. */
  key: string | null;
  /** i18n key of the heading. */
  title?: string;
  label?: string;
  /** The section's tile on the collapsed rail, and its header when open. */
  icon?: MenuIconName;
  essential?: boolean;
  /** As on an item: the packages a section added later starts on in. */
  defaultPlans?: readonly string[];
  items: MenuNode[];
}

const STAFF = [UserRole.ADMIN, UserRole.MANAGER];
const LEASE_REPORT_PERMISSIONS = [
  "lease_view",
  "lease_management",
  "financial_reports",
];
const PROPERTY_REPORT_PERMISSIONS = [
  "property_view",
  "property_management",
  "financial_reports",
];
const COLLECTION_REPORT_PERMISSIONS = [
  "financial_reports",
  "financial_management",
];

export const NAV_SECTIONS: MenuSection[] = [
  {
    key: null,
    items: [
      {
        key: "home.dashboard",
        title: "nav.dashboard",
        label: "Dashboard",
        href: "/dashboard",
        icon: "Home",
        roles: [
          UserRole.ADMIN,
          UserRole.MANAGER,
          UserRole.OWNER,
          UserRole.TENANT,
        ],
        alwaysOn: true,
        apis: [
          "/api/dashboard/overview",
          "/api/sidebar/counts",
          "/api/tenant/dashboard",
        ],
      },
      {
        // The owner portal, and the whole of it: one screen with their
        // buildings and what those buildings earned. Owners see nothing else
        // in the sidebar — every other entry is staff or tenant work.
        key: "home.portfolio",
        title: "nav.portfolio",
        label: "Owner portfolio",
        href: "/dashboard/portfolio",
        icon: "Wallet",
        roles: [UserRole.OWNER],
        requiredPermissions: ["reports_own", "property_view"],
        legacy: ["owner_portal"],
        apis: ["/api/owners"],
      },
    ],
  },
  // The structure the client review sets out, in its order: a menu grouped by
  // the job being done — leasing, collections, operations — with each report
  // under the area it belongs to rather than in one shared "Reports" section.
  {
    key: "section.leasing",
    title: "nav.section.leasing",
    label: "Leasing",
    icon: "FileSignature",
    essential: true,
    items: [
      {
        key: "leasing.reports",
        title: "nav.leasing.reports",
        label: "Leasing reports",
        href: "/dashboard/leases/reports",
        icon: "FileBarChart",
        roles: STAFF,
        requiredPermissions: [
          "lease_view",
          "lease_management",
          "financial_reports",
          "property_view",
          "property_management",
        ],
        children: [
          {
            key: "leasing.reports.occupancy",
            title: "nav.reports.occupancy",
            label: "Occupancy report",
            href: "/dashboard/properties/reports?type=occupancy",
            icon: "Percent",
            roles: STAFF,
            requiredPermissions: PROPERTY_REPORT_PERMISSIONS,
            legacy: ["properties"],
          },
          // The review lists these under the occupancy report by name: the
          // same report, narrowed to one state of unit.
          {
            key: "leasing.reports.vacant",
            title: "nav.reports.vacantUnits",
            label: "Vacant units",
            href: "/dashboard/properties/reports?type=occupancy&occupancy=vacant",
            icon: "DoorOpen",
            roles: STAFF,
            requiredPermissions: PROPERTY_REPORT_PERMISSIONS,
            legacy: ["properties"],
          },
          {
            key: "leasing.reports.leased",
            title: "nav.reports.leasedUnits",
            label: "Leased units",
            href: "/dashboard/properties/reports?type=occupancy&occupancy=leased",
            icon: "KeyRound",
            roles: STAFF,
            requiredPermissions: PROPERTY_REPORT_PERMISSIONS,
            legacy: ["properties"],
          },
          // Separate entries rather than one "registers" link: an operator
          // looks for "cancelled contracts" by that name, not by knowing it
          // is a tab behind something else. In the review's order; the two
          // it does not list come last.
          {
            key: "leasing.reports.renewed",
            title: "nav.reports.renewedContracts",
            label: "Renewed contracts",
            href: "/dashboard/leases/reports?type=renewed",
            icon: "RefreshCw",
            roles: STAFF,
            requiredPermissions: LEASE_REPORT_PERMISSIONS,
            legacy: ["advanced_analytics"],
          },
          {
            key: "leasing.reports.cancelled",
            title: "nav.reports.cancelledContracts",
            label: "Cancelled contracts",
            href: "/dashboard/leases/reports?type=terminated",
            icon: "Ban",
            roles: STAFF,
            requiredPermissions: LEASE_REPORT_PERMISSIONS,
            legacy: ["advanced_analytics"],
          },
          {
            key: "leasing.reports.expiring",
            title: "nav.reports.expiringContracts",
            label: "Contracts approaching expiry",
            href: "/dashboard/leases/reports?type=expiring",
            icon: "CalendarClock",
            roles: STAFF,
            requiredPermissions: LEASE_REPORT_PERMISSIONS,
            legacy: ["advanced_analytics"],
          },
          {
            key: "leasing.reports.expiring_soon",
            title: "nav.reports.expiringSoonContracts",
            label: "Contracts expiring soon",
            href: "/dashboard/leases/reports?type=expiring-soon",
            icon: "CalendarClock",
            roles: STAFF,
            requiredPermissions: LEASE_REPORT_PERMISSIONS,
            legacy: ["advanced_analytics"],
          },
          {
            key: "leasing.reports.expired",
            title: "nav.reports.expiredContracts",
            label: "Expired contracts",
            href: "/dashboard/leases/reports?type=expired",
            icon: "CalendarX",
            roles: STAFF,
            requiredPermissions: LEASE_REPORT_PERMISSIONS,
            legacy: ["advanced_analytics"],
          },
          {
            // No type: the page opens on its default register, active
            // contracts — which is what this entry owns.
            key: "leasing.reports.registers",
            title: "nav.reports.leaseRegisters",
            label: "Lease contracts register",
            href: "/dashboard/leases/reports",
            icon: "FileText",
            roles: STAFF,
            requiredPermissions: ["lease_management", "lease_view"],
            legacy: ["advanced_analytics"],
          },
        ],
      },
      {
        key: "leasing.contracts",
        title: "nav.leases.all",
        label: "All lease contracts",
        href: "/dashboard/leases",
        icon: "FileSignature",
        roles: STAFF,
        requiredPermissions: ["lease_management", "lease_view"],
        legacy: ["leases"],
        apis: ["/api/leases"],
      },
      {
        key: "leasing.new",
        title: "nav.leases.new",
        label: "New lease contract",
        href: "/dashboard/leases/new",
        icon: "FilePlus",
        roles: STAFF,
        requiredPermissions: ["lease_management", "lease_create"],
        legacy: ["leases"],
        apis: ["/api/leases"],
      },
      {
        key: "leasing.mine",
        title: "nav.leases.my",
        label: "My leases",
        href: "/dashboard/leases/my-leases",
        icon: "FileSignature",
        roles: [UserRole.TENANT],
        requiredPermissions: ["lease_view"],
        legacy: ["leases"],
        // A tenant opens their contract at /dashboard/leases/<id>.
        pages: ["/dashboard/leases"],
        apis: ["/api/leases"],
      },
      {
        key: "leasing.documents",
        title: "nav.leases.documents",
        label: "Lease documents",
        href: "/dashboard/leases/documents",
        icon: "FileText",
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
        requiredPermissions: ["document_access", "lease_view"],
        legacy: ["leases"],
        apis: ["/api/leases", "/api/tenant/documents"],
      },
    ],
  },
  {
    key: "section.collections",
    title: "nav.section.collections",
    label: "Collections",
    icon: "HandCoins",
    items: [
      {
        // The Collections menu, in the review's order: overdue tenants, due
        // rent, overdue rent.
        key: "collections.overdue_tenants",
        title: "nav.collections.overdueTenants",
        label: "Overdue tenants",
        href: "/dashboard/payments/reports?type=overdue-tenants",
        icon: "AlertTriangle",
        countKey: "overduePayments",
        roles: STAFF,
        requiredPermissions: COLLECTION_REPORT_PERMISSIONS,
        legacy: ["advanced_analytics"],
      },
      {
        key: "collections.due",
        title: "nav.collections.due",
        label: "Due rent payments",
        href: "/dashboard/payments/reports?type=outstanding",
        icon: "Clock",
        roles: STAFF,
        requiredPermissions: COLLECTION_REPORT_PERMISSIONS,
        legacy: ["advanced_analytics"],
      },
      {
        key: "collections.overdue",
        title: "nav.collections.overduePayments",
        label: "Overdue rent payments",
        href: "/dashboard/payments/reports?type=overdue",
        icon: "AlertTriangle",
        roles: STAFF,
        requiredPermissions: COLLECTION_REPORT_PERMISSIONS,
        legacy: ["advanced_analytics"],
      },
      {
        // Was labelled "التحصيل", the section's own name, so the section
        // held an entry called the same as itself.
        key: "collections.follow_up",
        title: "nav.collections.followUp",
        label: "Collection follow-up",
        href: "/dashboard/payments/collection",
        icon: "Wallet",
        roles: STAFF,
        requiredPermissions: [
          "payment_processing",
          "financial_management",
          "financial_reports",
        ],
        legacy: ["payments"],
        // Recording a payment is PATCH /api/invoices/<id> (the installment
        // dialog), so collections owns the invoice API alongside accounting.
        apis: ["/api/payments", "/api/invoices"],
      },
      {
        key: "collections.payments",
        title: "nav.collections.payments",
        label: "Payments",
        href: "/dashboard/payments",
        icon: "CreditCard",
        roles: STAFF,
        requiredPermissions: [
          "payment_view",
          "payment_processing",
          "financial_management",
          "financial_reports",
        ],
        legacy: ["payments"],
        apis: ["/api/payments", "/api/invoices"],
      },
      {
        key: "collections.payment_report",
        title: "nav.collections.paymentReport",
        label: "Payment report",
        href: "/dashboard/payments/reports?type=collections",
        icon: "Receipt",
        roles: STAFF,
        requiredPermissions: COLLECTION_REPORT_PERMISSIONS,
        legacy: ["advanced_analytics"],
        reports: [
          {
            endpoint: "/dashboard/payments/reports",
            types: ["collections-by-building"],
          },
        ],
        // The payments analytics screen and its API.
        pages: ["/dashboard/payments/analytics"],
        apis: ["/api/payments/reports/analytics"],
      },
      {
        key: "collections.pay_rent",
        title: "nav.accounting.payRent",
        label: "Pay rent",
        href: "/dashboard/payments/pay-rent",
        icon: "CreditCard",
        roles: [UserRole.TENANT],
        requiredPermissions: ["payment_portal"],
        legacy: ["payments"],
        // A tenant's payment, receipt and checkout pages sit under
        // /dashboard/payments/<id>.
        pages: ["/dashboard/payments"],
        apis: [
          "/api/payments",
          "/api/invoices",
          "/api/tenant/payments",
          "/api/tenant/invoices",
          "/api/tenant/receipts",
          "/api/tenant/recurring-payments",
        ],
      },
    ],
  },
  {
    // The finance screens had no menu entry at all; the final review asks for
    // a section of their own.
    key: "section.accounting",
    title: "nav.section.accounting",
    label: "Accounting",
    icon: "Calculator",
    items: [
      {
        key: "accounting.invoices",
        title: "nav.accounting.invoices",
        label: "Invoices",
        href: "/dashboard/accounting/invoices",
        icon: "FileText",
        roles: STAFF,
        requiredPermissions: INVOICE_LIST_PERMISSIONS,
        legacy: ["accounting"],
        apis: ["/api/invoices"],
      },
      {
        key: "accounting.expenses",
        title: "nav.accounting.expenses",
        label: "Expenses",
        href: "/dashboard/accounting/expenses",
        icon: "TrendingDown",
        roles: STAFF,
        requiredPermissions: EXPENSE_READ_PERMISSIONS,
        legacy: ["accounting"],
        // An expense names its supplier: the supplier list is part of it.
        apis: ["/api/accounting/expenses", "/api/accounting/suppliers"],
      },
      {
        key: "accounting.revenues",
        title: "nav.accounting.revenues",
        label: "Revenues",
        href: "/dashboard/accounting/revenues",
        icon: "TrendingUp",
        roles: STAFF,
        requiredPermissions: ACCOUNTING_READ_PERMISSIONS,
        legacy: ["accounting"],
        apis: ["/api/accounting/revenues"],
      },
      {
        key: "accounting.transactions",
        title: "nav.accounting.transactions",
        label: "Transactions",
        href: "/dashboard/accounting/transactions",
        icon: "ArrowLeftRight",
        roles: STAFF,
        requiredPermissions: ACCOUNTING_READ_PERMISSIONS,
        legacy: ["accounting"],
        apis: ["/api/accounting/transactions"],
      },
      {
        key: "accounting.reports",
        title: "nav.accounting.financialReports",
        label: "Financial reports",
        href: "/dashboard/accounting/reports",
        icon: "BarChart3",
        roles: STAFF,
        requiredPermissions: ACCOUNTING_READ_PERMISSIONS,
        legacy: ["advanced_analytics"],
        apis: ["/api/reports"],
        // Expenses per building sits on the payments report page (the
        // dashboard's expenses card opens it) but is a financial report.
        reports: [
          {
            endpoint: "/dashboard/payments/reports",
            types: ["expenses-by-building"],
          },
        ],
      },
      {
        // The receipt vouchers (سندات القبض): the payment register, whose
        // payment number is each receipt's voucher number. The same report
        // as Collections → Payment report, reached from Accounting too.
        key: "accounting.receipts",
        title: "nav.accounting.receipts",
        label: "Receipt vouchers",
        // Its own link to the same report (`view` is read by no one), so
        // the page belongs to this entry when opened from here.
        href: "/dashboard/payments/reports?type=collections&view=receipts",
        icon: "Receipt",
        roles: STAFF,
        requiredPermissions: COLLECTION_REPORT_PERMISSIONS,
        legacy: ["advanced_analytics"],
      },
      {
        // Output VAT by category from invoices, input VAT from expenses
        // (accounting phase 0, before the ledger keeps the VAT accounts).
        key: "accounting.vat_summary",
        title: "nav.accounting.vatSummary",
        label: "VAT summary",
        href: "/dashboard/accounting/vat-summary",
        icon: "Percent",
        roles: STAFF,
        requiredPermissions: ACCOUNTING_READ_PERMISSIONS,
        legacy: ["accounting"],
        apis: ["/api/accounting/vat-summary"],
      },
      // The double-entry books (lib/accounting). Each screen also owns the
      // ledger reads it needs from another's API — the account pickers, the
      // set-up check, the bank list — so one module on is enough to use it.
      {
        key: "accounting.journals",
        title: "nav.accounting.journals",
        label: "Journal entries",
        href: "/dashboard/accounting/journals",
        icon: "ScrollText",
        roles: STAFF,
        requiredPermissions: LEDGER_VIEW_PERMISSIONS,
        legacy: ["accounting"],
        apis: [
          "/api/accounting/ledger/journals",
          "/api/accounting/ledger/opening-balances",
          "/api/accounting/ledger/parties",
          "/api/accounting/ledger/accounts",
          "/api/accounting/ledger/setup",
        ],
      },
      {
        key: "accounting.chart_of_accounts",
        title: "nav.accounting.chartOfAccounts",
        label: "Chart of accounts",
        href: "/dashboard/accounting/chart-of-accounts",
        icon: "Grid3X3",
        roles: STAFF,
        requiredPermissions: LEDGER_VIEW_PERMISSIONS,
        legacy: ["accounting"],
        apis: ["/api/accounting/ledger/accounts", "/api/accounting/ledger/balances"],
      },
      {
        key: "accounting.banks",
        title: "nav.accounting.banks",
        label: "Banks and cash",
        href: "/dashboard/accounting/banks",
        icon: "Wallet",
        roles: STAFF,
        requiredPermissions: LEDGER_VIEW_PERMISSIONS,
        legacy: ["accounting"],
        apis: ["/api/accounting/ledger/banks", "/api/accounting/ledger/transfers"],
      },
      {
        // Ticking the lines of a bank or cash account off against its
        // statement, by hand: the book balance beside the reconciled one.
        key: "accounting.bank_reconciliation",
        title: "nav.accounting.bankReconciliation",
        label: "Bank reconciliation",
        href: "/dashboard/accounting/banks/reconcile",
        icon: "ClipboardCheck",
        roles: STAFF,
        requiredPermissions: LEDGER_VIEW_PERMISSIONS,
        legacy: ["accounting"],
        apis: [
          "/api/accounting/ledger/reconciliation",
          "/api/accounting/ledger/banks",
          "/api/accounting/ledger/setup",
        ],
      },
      {
        key: "accounting.owner_payouts",
        title: "nav.accounting.ownerPayouts",
        label: "Owner payouts",
        href: "/dashboard/accounting/payouts",
        icon: "HandCoins",
        roles: STAFF,
        requiredPermissions: LEDGER_VIEW_PERMISSIONS,
        legacy: ["accounting"],
        apis: [
          "/api/accounting/ledger/payouts",
          "/api/accounting/ledger/settlements",
          "/api/accounting/ledger/banks",
        ],
      },
      // What the office buys and how it pays for it (lib/accounting/purchases):
      // suppliers, the bills they send, the vouchers that pay them, and what is
      // owed by how long it has been due. Each screen also owns the reads it
      // needs from another's API — the supplier picker, and the purchases
      // lookups (the accounts a bill can be charged to, the bank accounts a
      // voucher is drawn on, the set-up check) — so one module on is enough
      // to use it, and no screen asks for the right to view the books.
      {
        key: "accounting.purchases",
        title: "nav.accounting.purchases",
        label: "Purchases",
        href: "/dashboard/accounting/purchases/suppliers",
        icon: "Briefcase",
        roles: STAFF,
        requiredPermissions: PURCHASE_VIEW_PERMISSIONS,
        children: [
          {
            key: "accounting.purchases.suppliers",
            title: "nav.accounting.suppliers",
            label: "Suppliers",
            href: "/dashboard/accounting/purchases/suppliers",
            icon: "Users",
            roles: STAFF,
            requiredPermissions: PURCHASE_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: ["/api/accounting/purchases/suppliers"],
          },
          {
            key: "accounting.purchases.bills",
            title: "nav.accounting.purchaseBills",
            label: "Purchase bills",
            href: "/dashboard/accounting/purchases/bills",
            icon: "FileText",
            roles: STAFF,
            requiredPermissions: PURCHASE_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: [
              "/api/accounting/purchases/bills",
              "/api/accounting/purchases/suppliers",
              "/api/accounting/purchases/lookups",
              "/api/reports/filter-options",
            ],
          },
          {
            key: "accounting.purchases.vouchers",
            title: "nav.accounting.paymentVouchers",
            label: "Payment vouchers",
            href: "/dashboard/accounting/purchases/vouchers",
            icon: "Receipt",
            roles: STAFF,
            requiredPermissions: PURCHASE_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: [
              "/api/accounting/purchases/vouchers",
              "/api/accounting/purchases/bills",
              "/api/accounting/purchases/suppliers",
              "/api/accounting/purchases/lookups",
            ],
          },
          {
            key: "accounting.purchases.aging",
            title: "nav.accounting.payablesAging",
            label: "Payables aging",
            href: "/dashboard/accounting/purchases/aging",
            icon: "Clock",
            roles: STAFF,
            requiredPermissions: PURCHASE_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: ["/api/accounting/purchases/aging", "/api/accounting/purchases/suppliers"],
          },
        ],
      },
      // The two registers: every document of sales and receipts, and of
      // purchases and payments, in date order, by period and party.
      {
        key: "accounting.registers",
        title: "nav.accounting.registers",
        label: "Registers",
        href: "/dashboard/accounting/registers/sales",
        icon: "ScrollText",
        roles: STAFF,
        requiredPermissions: [...ACCOUNTING_READ_PERMISSIONS, ...PURCHASE_VIEW_PERMISSIONS],
        children: [
          {
            key: "accounting.registers.sales",
            title: "nav.accounting.salesRegister",
            label: "Sales & receipts",
            href: "/dashboard/accounting/registers/sales",
            icon: "TrendingUp",
            roles: STAFF,
            requiredPermissions: ACCOUNTING_READ_PERMISSIONS,
            legacy: ["accounting"],
            apis: ["/api/accounting/sales/register", "/api/reports/filter-options"],
          },
          {
            key: "accounting.registers.purchases",
            title: "nav.accounting.purchasesRegister",
            label: "Purchases & payments",
            href: "/dashboard/accounting/registers/purchases",
            icon: "TrendingDown",
            roles: STAFF,
            requiredPermissions: PURCHASE_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: [
              "/api/accounting/purchases/register",
              "/api/accounting/purchases/suppliers",
              "/api/reports/filter-options",
            ],
          },
        ],
      },
      // The ledger's reports (lib/accounting/reports), each read from the
      // journal alone: its own entry, page and API, all under the books'
      // view right.
      {
        key: "accounting.ledger_reports",
        title: "nav.accounting.ledgerReports",
        label: "Ledger reports",
        href: "/dashboard/accounting/ledger-reports/account-statement",
        icon: "FileBarChart",
        roles: STAFF,
        requiredPermissions: LEDGER_VIEW_PERMISSIONS,
        children: [
          {
            key: "accounting.ledger_reports.account_statement",
            title: "nav.accounting.accountStatement",
            label: "General account statement",
            href: "/dashboard/accounting/ledger-reports/account-statement",
            icon: "ScrollText",
            roles: STAFF,
            requiredPermissions: LEDGER_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            // Its account picker reads the chart.
            apis: ["/api/accounting/ledger/reports/account-statement", "/api/accounting/ledger/accounts"],
          },
          {
            key: "accounting.ledger_reports.party_statement",
            title: "nav.accounting.partyStatement",
            label: "Party statement",
            href: "/dashboard/accounting/ledger-reports/party-statement",
            icon: "UserRound",
            roles: STAFF,
            requiredPermissions: LEDGER_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: [
              "/api/accounting/ledger/reports/party-statement",
              "/api/accounting/ledger/reports/parties",
            ],
          },
          {
            key: "accounting.ledger_reports.trial_balance",
            title: "nav.accounting.trialBalance",
            label: "Trial balance",
            href: "/dashboard/accounting/ledger-reports/trial-balance",
            icon: "Calculator",
            roles: STAFF,
            requiredPermissions: LEDGER_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: ["/api/accounting/ledger/reports/trial-balance"],
          },
          {
            key: "accounting.ledger_reports.profit_loss",
            title: "nav.accounting.profitLoss",
            label: "Profit and loss",
            href: "/dashboard/accounting/ledger-reports/profit-loss",
            icon: "TrendingUp",
            roles: STAFF,
            requiredPermissions: LEDGER_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: ["/api/accounting/ledger/reports/profit-loss"],
          },
          {
            key: "accounting.ledger_reports.balance_sheet",
            title: "nav.accounting.balanceSheet",
            label: "Balance sheet",
            href: "/dashboard/accounting/ledger-reports/balance-sheet",
            icon: "BarChart3",
            roles: STAFF,
            requiredPermissions: LEDGER_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: ["/api/accounting/ledger/reports/balance-sheet"],
          },
          {
            key: "accounting.ledger_reports.banks",
            title: "nav.accounting.banksReport",
            label: "Banks report",
            href: "/dashboard/accounting/ledger-reports/banks",
            icon: "Wallet",
            roles: STAFF,
            requiredPermissions: LEDGER_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: ["/api/accounting/ledger/reports/banks"],
          },
          {
            key: "accounting.ledger_reports.vat_return",
            title: "nav.accounting.vatReturn",
            label: "VAT return",
            href: "/dashboard/accounting/ledger-reports/vat-return",
            icon: "Percent",
            roles: STAFF,
            requiredPermissions: LEDGER_VIEW_PERMISSIONS,
            legacy: ["accounting"],
            apis: ["/api/accounting/ledger/reports/vat-return"],
          },
        ],
      },
      {
        key: "accounting.setup",
        title: "nav.accounting.setup",
        label: "Accounting setup",
        href: "/dashboard/accounting/setup",
        icon: "Settings",
        roles: STAFF,
        requiredPermissions: LEDGER_VIEW_PERMISSIONS,
        legacy: ["accounting"],
        apis: [
          "/api/accounting/ledger/setup",
          "/api/accounting/ledger/period",
          "/api/accounting/ledger/sweep",
          "/api/accounting/ledger/accounts",
        ],
      },
    ],
  },
  {
    // The Property Listing module: staff pages for the office's adverts and
    // the inquiries they bring. The public pages (/o/**) and the public
    // inquiry API are NOT gated here — they follow the office's package in
    // lib/listings/public.ts, since a visitor has no session to check.
    key: "section.marketing",
    title: "nav.section.marketing",
    label: "Marketing",
    icon: "Megaphone",
    // Added after the packages were saved: on in the two top tiers from the
    // day it ships, off in the others until the Super Admin ticks it.
    defaultPlans: ["professional", "business"],
    items: [
      {
        key: "marketing.listings",
        title: "nav.marketing.listings",
        label: "Listings",
        href: "/dashboard/marketing/listings",
        icon: "Megaphone",
        roles: STAFF,
        requiredPermissions: ["listing_view", "listing_management"],
        pages: ["/dashboard/marketing"],
        apis: ["/api/marketing"],
      },
      {
        key: "marketing.inquiries",
        title: "nav.marketing.inquiries",
        label: "Inquiries",
        href: "/dashboard/marketing/inquiries",
        icon: "Inbox",
        roles: STAFF,
        requiredPermissions: ["listing_inquiries", "listing_management"],
        apis: ["/api/marketing/inquiries"],
      },
    ],
  },
  {
    key: "section.operations",
    title: "nav.section.operations",
    label: "Operations & Management",
    icon: "Briefcase",
    items: [
      {
        key: "operations.reports",
        title: "nav.operations.reports",
        label: "Operations reports",
        href: "/dashboard/agreements/reports",
        icon: "FileBarChart",
        roles: STAFF,
        requiredPermissions: [
          "financial_reports",
          "financial_management",
          "agreement_view",
          "agreement_management",
          "property_view",
          "property_management",
        ],
        children: [
          {
            // The report over every agreement: reached from the agreements
            // screens, not from the menu (the group above only opens).
            key: "operations.reports.agreements",
            title: "nav.agreements.reports",
            label: "Agreement report",
            href: "/dashboard/agreements/reports",
            icon: "FileBarChart",
            roles: STAFF,
            requiredPermissions: [
              "financial_reports",
              "financial_management",
              "agreement_view",
              "agreement_management",
            ],
            hidden: true,
            legacy: ["advanced_analytics"],
            apis: ["/api/agreements/reports"],
          },
          {
            // One agreement's statement, picked on the page.
            key: "operations.reports.agreement_statement",
            title: "nav.reports.agreementStatement",
            label: "Management agreement statement",
            href: "/dashboard/agreements/statement",
            icon: "Handshake",
            roles: STAFF,
            requiredPermissions: ["agreement_view", "agreement_management"],
            legacy: ["agreements"],
            apis: ["/api/agreements"],
          },
          {
            key: "operations.reports.compound_statement",
            title: "nav.reports.compoundStatement",
            label: "Compound statement",
            href: "/dashboard/properties/reports?type=compound-statement",
            icon: "Building",
            roles: STAFF,
            requiredPermissions: PROPERTY_REPORT_PERMISSIONS,
            legacy: ["properties"],
            apis: ["/api/properties/statement-subjects"],
          },
          {
            key: "operations.reports.property_statement",
            title: "nav.reports.propertyStatement",
            label: "Property statement",
            href: "/dashboard/properties/reports?type=property-statement",
            icon: "Building2",
            roles: STAFF,
            requiredPermissions: PROPERTY_REPORT_PERMISSIONS,
            legacy: ["properties"],
            apis: ["/api/properties/statement-subjects"],
          },
          {
            key: "operations.reports.unit_statement",
            title: "nav.reports.unitStatement",
            label: "Unit statement",
            href: "/dashboard/properties/reports?type=unit-statement",
            icon: "DoorOpen",
            roles: STAFF,
            requiredPermissions: PROPERTY_REPORT_PERMISSIONS,
            legacy: ["properties"],
            apis: ["/api/properties/statement-subjects"],
          },
          {
            key: "operations.reports.maintenance",
            title: "nav.reports.maintenance",
            label: "Maintenance report",
            href: "/dashboard/properties/reports?type=maintenance",
            icon: "Wrench",
            roles: STAFF,
            requiredPermissions: PROPERTY_REPORT_PERMISSIONS,
            legacy: ["properties"],
          },
        ],
      },
      {
        key: "operations.agreements",
        title: "nav.agreements.all",
        label: "Management agreements",
        href: "/dashboard/agreements",
        icon: "Handshake",
        roles: STAFF,
        requiredPermissions: ["agreement_management", "agreement_view"],
        legacy: ["agreements"],
        apis: ["/api/agreements"],
      },
      // The review's archive names investment agreements as a record type of
      // their own; they are listed on the same page, filtered to that kind.
      {
        key: "operations.investment",
        title: "nav.agreements.investment",
        label: "Investment agreements",
        href: "/dashboard/agreements?kind=investment",
        icon: "Wallet",
        roles: STAFF,
        requiredPermissions: ["agreement_management", "agreement_view"],
        legacy: ["agreements"],
        apis: ["/api/agreements"],
      },
      {
        key: "operations.new_agreement",
        title: "nav.agreements.new",
        label: "New agreement",
        href: "/dashboard/agreements/new",
        icon: "FilePlus",
        roles: STAFF,
        requiredPermissions: ["agreement_create", "agreement_management"],
        legacy: ["agreements"],
        apis: ["/api/agreements"],
      },
    ],
  },
  {
    key: "section.properties",
    title: "nav.section.properties",
    label: "Properties",
    icon: "Building2",
    essential: true,
    items: [
      {
        key: "properties.compounds",
        title: "nav.compounds",
        label: "Compounds",
        href: "/dashboard/compounds",
        icon: "Building2",
        roles: STAFF,
        requiredPermissions: ["property_management", "property_view"],
        children: [
          {
            key: "properties.compounds.list",
            title: "nav.compounds.all",
            label: "All compounds",
            href: "/dashboard/compounds",
            icon: "Building2",
            roles: STAFF,
            requiredPermissions: ["property_management", "property_view"],
            legacy: ["properties"],
            apis: ["/api/compounds"],
          },
          {
            key: "properties.compounds.new",
            title: "nav.compounds.new",
            label: "Add compound",
            href: "/dashboard/compounds/new",
            icon: "Plus",
            roles: STAFF,
            requiredPermissions: ["property_management", "property_create"],
            legacy: ["properties"],
            apis: ["/api/compounds"],
          },
        ],
      },
      {
        key: "properties.buildings",
        title: "nav.properties",
        label: "Buildings",
        href: "/dashboard/properties",
        icon: "Building",
        roles: STAFF,
        requiredPermissions: ["property_management", "property_view"],
        children: [
          {
            key: "properties.buildings.list",
            title: "nav.properties.all",
            label: "All buildings",
            href: "/dashboard/properties",
            icon: "Building",
            roles: STAFF,
            requiredPermissions: ["property_management", "property_view"],
            legacy: ["properties"],
            apis: ["/api/properties", "/api/units", "/api/property-categories"],
          },
          {
            key: "properties.buildings.new",
            title: "nav.properties.new",
            label: "Add property",
            href: "/dashboard/properties/new",
            icon: "Plus",
            roles: STAFF,
            requiredPermissions: ["property_management", "property_create"],
            legacy: ["properties"],
            apis: ["/api/properties", "/api/units", "/api/property-categories"],
          },
          {
            key: "properties.buildings.available",
            title: "nav.properties.available",
            label: "Available units",
            href: "/dashboard/properties/available",
            icon: "DoorOpen",
            roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
            requiredPermissions: ["property_view"],
            legacy: ["properties"],
            apis: ["/api/properties", "/api/units"],
          },
        ],
      },
      {
        key: "properties.units",
        title: "nav.properties.allUnits",
        label: "All units",
        href: "/dashboard/properties/units",
        icon: "Grid3X3",
        roles: STAFF,
        requiredPermissions: ["property_management", "property_view"],
        legacy: ["properties"],
        apis: ["/api/properties", "/api/units"],
      },
    ],
  },
  {
    key: "section.maintenance",
    title: "nav.section.maintenanceOps",
    label: "Maintenance",
    icon: "Wrench",
    items: [
      {
        key: "maintenance.requests",
        title: "nav.maintenance.all",
        label: "All maintenance requests",
        href: "/dashboard/maintenance",
        icon: "Wrench",
        roles: STAFF,
        requiredPermissions: ["maintenance_management", "maintenance_view"],
        legacy: ["maintenance"],
        apis: ["/api/maintenance"],
      },
      {
        key: "maintenance.emergency",
        title: "nav.maintenance.emergency",
        label: "Emergencies",
        href: "/dashboard/maintenance/emergency",
        icon: "AlertTriangle",
        countKey: "emergencyMaintenance",
        roles: STAFF,
        requiredPermissions: [
          "maintenance_view",
          "maintenance_management",
          "maintenance_requests",
        ],
        legacy: ["maintenance"],
        apis: ["/api/maintenance"],
      },
      {
        key: "maintenance.new",
        title: "nav.maintenance.submit",
        label: "New maintenance request",
        href: "/dashboard/maintenance/new",
        icon: "Plus",
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
        requiredPermissions: ["maintenance_create", "maintenance_requests"],
        legacy: ["maintenance"],
        apis: ["/api/maintenance", "/api/tenant/maintenance"],
      },
      {
        key: "maintenance.mine",
        title: "nav.maintenance.mine",
        label: "My maintenance requests",
        href: "/dashboard/maintenance/my-requests",
        icon: "Wrench",
        roles: [UserRole.TENANT],
        requiredPermissions: ["maintenance_requests"],
        legacy: ["maintenance"],
        // A tenant opens their request at /dashboard/maintenance/<id>.
        pages: ["/dashboard/maintenance"],
        apis: ["/api/maintenance", "/api/tenant/maintenance"],
      },
    ],
  },
  {
    key: "section.inspections",
    title: "nav.section.inspections",
    label: "Inspections",
    icon: "ClipboardCheck",
    items: [
      {
        key: "inspections.list",
        title: "nav.inspections.all",
        label: "All inspections",
        href: "/dashboard/inspections",
        icon: "ClipboardCheck",
        roles: STAFF,
        requiredPermissions: [
          "inspection_view",
          "property_view",
          "property_management",
          "maintenance_view",
          "maintenance_management",
        ],
        legacy: ["inspections"],
        apis: ["/api/inspections"],
      },
      {
        key: "inspections.new",
        title: "nav.inspections.schedule",
        label: "Schedule inspection",
        href: "/dashboard/inspections/new",
        icon: "Calendar",
        roles: STAFF,
        requiredPermissions: [
          "inspection_create",
          "property_management",
          "maintenance_management",
        ],
        legacy: ["inspections"],
        apis: ["/api/inspections"],
      },
    ],
  },
  {
    key: "section.clients",
    title: "nav.section.clientAffairs",
    label: "Client affairs",
    icon: "Users",
    essential: true,
    items: [
      {
        key: "clients.overview",
        title: "nav.clients.overview",
        label: "Clients overview",
        href: "/dashboard/clients",
        icon: "Users",
        roles: STAFF,
        requiredPermissions: [
          "owner_view",
          "owner_management",
          "tenant_view",
          "tenant_management",
        ],
        legacy: ["owner_portal"],
        apis: ["/api/clients", "/api/owners"],
      },
      {
        key: "clients.owners",
        title: "nav.clients.owners",
        label: "Owners",
        href: "/dashboard/clients/owners",
        icon: "UserRound",
        roles: STAFF,
        requiredPermissions: ["owner_management", "owner_view"],
        legacy: ["owner_portal"],
        apis: ["/api/owners", "/api/clients"],
      },
      {
        key: "clients.tenants",
        title: "nav.tenants",
        label: "Tenants",
        href: "/dashboard/tenants",
        icon: "Users",
        roles: STAFF,
        requiredPermissions: ["tenant_management", "tenant_view"],
        children: [
          {
            key: "clients.tenants.list",
            title: "nav.tenants.all",
            label: "All tenants",
            href: "/dashboard/tenants",
            icon: "Users",
            roles: STAFF,
            requiredPermissions: ["tenant_management", "tenant_view"],
            legacy: ["tenants"],
            apis: ["/api/tenants", "/api/clients"],
          },
          {
            key: "clients.tenants.new",
            title: "nav.tenants.new",
            label: "Add tenant",
            href: "/dashboard/tenants/new",
            icon: "Plus",
            roles: STAFF,
            requiredPermissions: ["tenant_management", "tenant_create"],
            legacy: ["tenants"],
            apis: ["/api/tenants"],
          },
          {
            key: "clients.tenants.applications",
            title: "nav.tenants.applications",
            label: "Applications",
            href: "/dashboard/tenants/applications",
            icon: "FileText",
            countKey: "applications",
            roles: STAFF,
            requiredPermissions: ["application_processing", "tenant_view"],
            legacy: ["applications"],
            pages: ["/dashboard/applications"],
            apis: ["/api/applications"],
          },
        ],
      },
    ],
  },
  {
    key: "section.employees",
    title: "nav.section.employees",
    label: "Employees",
    icon: "UserCog",
    items: [
      {
        key: "employees.list",
        title: "nav.employees.list",
        label: "Employees list",
        href: "/dashboard/admin/users",
        icon: "Users",
        roles: [UserRole.ADMIN],
        requiredPermissions: ["user_view", "user_management"],
        alwaysOn: true,
        apis: ["/api/users"],
      },
      {
        key: "employees.groups",
        title: "nav.employees.groups",
        label: "Permission groups",
        href: "/dashboard/admin/users/roles",
        icon: "Shield",
        roles: [UserRole.ADMIN],
        requiredPermissions: ["role_management"],
        legacy: ["custom_roles"],
        apis: ["/api/roles"],
      },
    ],
  },
  {
    key: "section.communication",
    title: "nav.section.communication",
    label: "Communication",
    icon: "Inbox",
    items: [
      {
        key: "communication.inbox",
        title: "nav.inbox",
        label: "Inbox",
        href: "/dashboard/messages",
        icon: "Inbox",
        countKey: "inbox",
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
        children: [
          {
            key: "communication.messages",
            title: "nav.messages",
            label: "Messages",
            href: "/dashboard/messages",
            icon: "MessageSquare",
            countKey: "messages",
            roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
            legacy: ["messaging"],
            apis: ["/api/conversations", "/api/messages"],
          },
          {
            key: "communication.notifications",
            title: "nav.notifications",
            label: "Notifications",
            href: "/dashboard/notifications",
            icon: "Bell",
            countKey: "notifications",
            roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
            alwaysOn: true,
            apis: ["/api/notifications", "/api/tenant/notifications"],
          },
          {
            key: "communication.announcements",
            title: "nav.announcements",
            label: "Announcements",
            href: "/dashboard/announcements",
            icon: "Megaphone",
            countKey: "announcements",
            roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
            legacy: ["announcements"],
            apis: ["/api/announcements"],
          },
          {
            key: "communication.tickets",
            title: "nav.tickets",
            label: "Support tickets",
            href: "/dashboard/tickets",
            icon: "TicketCheck",
            countKey: "tickets",
            roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
            legacy: ["tickets"],
            apis: ["/api/tickets", "/api/tenant/tickets"],
          },
        ],
      },
      {
        key: "communication.calendar",
        title: "nav.calendar",
        label: "Calendar",
        href: "/dashboard/calendar",
        icon: "Calendar",
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
        legacy: ["calendar"],
        apis: ["/api/calendar"],
      },
    ],
  },
  {
    key: "section.administration",
    title: "nav.section.administration",
    label: "Administration",
    icon: "ShieldCheck",
    items: [
      {
        key: "administration.admin",
        title: "nav.admin",
        label: "Admin",
        href: "/dashboard/admin",
        icon: "Shield",
        roles: [UserRole.ADMIN],
        requiredPermissions: [
          "user_view",
          "user_management",
          "user_create",
          "role_management",
          "audit_logs",
        ],
        children: [
          {
            key: "administration.overview",
            title: "nav.admin.overview",
            label: "Administration overview",
            href: "/dashboard/admin",
            icon: "Shield",
            roles: [UserRole.ADMIN],
            requiredPermissions: ["user_management"],
            legacy: ["*"],
          },
          {
            // The employees list again, under its old name: one page, so it
            // is on whenever the list is.
            key: "administration.users",
            title: "nav.admin.users",
            label: "All users",
            href: "/dashboard/admin/users",
            icon: "Users",
            roles: [UserRole.ADMIN],
            requiredPermissions: ["user_management", "user_view"],
            alwaysOn: true,
            apis: ["/api/users"],
          },
          {
            key: "administration.new_user",
            title: "nav.admin.users.new",
            label: "Add user",
            href: "/dashboard/admin/users/new",
            icon: "UserPlus",
            roles: [UserRole.ADMIN],
            requiredPermissions: ["user_create", "user_management"],
            legacy: ["*"],
          },
          {
            key: "administration.roles",
            title: "nav.admin.users.roles",
            label: "User roles",
            href: "/dashboard/admin/users/roles",
            icon: "Shield",
            roles: [UserRole.ADMIN],
            requiredPermissions: ["role_management"],
            legacy: ["custom_roles"],
            apis: ["/api/roles"],
          },
          {
            key: "administration.audit",
            title: "nav.admin.audit",
            label: "Audit trail",
            href: "/dashboard/admin/audit",
            icon: "ScrollText",
            roles: [UserRole.ADMIN],
            requiredPermissions: ["audit_logs"],
            legacy: ["audit_log"],
            apis: ["/api/audit"],
          },
        ],
      },
      {
        key: "administration.import",
        title: "nav.import",
        label: "Import data",
        href: "/dashboard/import",
        icon: "FileUp",
        roles: STAFF,
        requiredPermissions: ["bulk_operations"],
        legacy: ["bulk_import"],
        apis: ["/api/import"],
      },
      {
        key: "administration.feedback",
        title: "nav.feedback",
        label: "Feedback",
        href: "/dashboard/feedback",
        icon: "MessageSquareHeart",
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
        legacy: ["*"],
        apis: ["/api/feedback"],
      },
      {
        key: "administration.settings",
        title: "nav.settings",
        label: "Settings",
        href: "/dashboard/settings",
        icon: "Settings",
        roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
        children: [
          {
            key: "settings.profile",
            title: "nav.settings.profile",
            label: "Profile",
            href: "/dashboard/settings/profile",
            icon: "User",
            roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
            alwaysOn: true,
            apis: ["/api/settings/profile"],
          },
          {
            key: "settings.security",
            title: "nav.settings.security",
            label: "Security",
            href: "/dashboard/settings/security",
            icon: "Shield",
            roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT],
            alwaysOn: true,
          },
          {
            key: "settings.categories",
            title: "nav.settings.categories",
            label: "Property categories",
            href: "/dashboard/settings/categories",
            icon: "Tags",
            roles: STAFF,
            requiredPermissions: ["property_management", "system_settings"],
            legacy: ["*"],
            apis: ["/api/property-categories"],
          },
          {
            // Display & branding is a single global setting managed by
            // admins only; every account inherits it.
            key: "settings.display",
            title: "nav.settings.display",
            label: "Display & branding",
            href: "/dashboard/settings/appearance",
            icon: "Palette",
            roles: [UserRole.ADMIN],
            requiredPermissions: ["system_settings"],
            alwaysOn: true,
            apis: ["/api/settings/display"],
          },
          {
            // SMS and WhatsApp: the office's own gateway or the platform's,
            // the per-event switches and the message log. Added after the
            // packages were set up, so it starts on in each of them; what an
            // office sends through the platform's gateway is capped by the
            // package's monthly message quota instead.
            key: "settings.messaging",
            title: "nav.settings.messaging",
            label: "SMS & WhatsApp",
            href: "/dashboard/settings/messaging",
            icon: "MessageSquare",
            roles: [UserRole.ADMIN],
            requiredPermissions: ["system_settings"],
            legacy: ["*"],
            defaultPlans: ["free", "starter", "professional", "business"],
            apis: ["/api/settings/messaging"],
          },
          {
            key: "settings.payment",
            title: "nav.settings.payment",
            label: "Payment settings",
            href: "/dashboard/settings/payment",
            icon: "CreditCard",
            roles: [UserRole.ADMIN],
            requiredPermissions: ["system_settings"],
            legacy: ["*"],
            apis: ["/api/settings/payment"],
          },
          {
            // No requiredPermissions, on purpose: the subscription is the
            // Administrator's (or the organization owner's) to manage and no
            // permission grants it. Always on: it is where a missing module
            // is bought.
            key: "settings.billing",
            title: "nav.settings.billing",
            label: "Billing & plans",
            href: "/dashboard/settings/billing",
            icon: "CreditCard",
            roles: [UserRole.ADMIN],
            alwaysOn: true,
          },
        ],
      },
    ],
  },
  {
    // A section of its own holding one entry: "Archive must be a separate
    // top-level menu item and must not be nested under another menu." Last
    // in the menu, below Administration, at the client's request (2026-10-16).
    key: null,
    items: [
      {
        key: "archive.records",
        title: "nav.archive",
        label: "Archive",
        href: "/dashboard/archive",
        icon: "Archive",
        roles: STAFF,
        // `archive_view` first: it is the archive's own right and what
        // GET /api/archive accepts.
        requiredPermissions: [
          "archive_view",
          "property_management",
          "tenant_management",
        ],
        legacy: ["*"],
        apis: ["/api/archive"],
      },
    ],
  },
];

/**
 * Modules that are not menu entries: capabilities a package can include or
 * leave out, shown in their own block of the package form.
 */
export const CAPABILITY_NODES: MenuNode[] = [
  {
    key: "capability.data_export",
    title: "platform.modules.capability.dataExport",
    label: "Data export",
    // No page of its own: a capability shows on other screens.
    href: "",
    icon: "Download",
    roles: STAFF,
    hidden: true,
    legacy: ["data_export"],
    apis: ["/api/dashboard/export"],
  },
  {
    key: "capability.security_deposits",
    title: "platform.modules.capability.securityDeposits",
    label: "Security deposits",
    href: "",
    icon: "Wallet",
    roles: STAFF,
    hidden: true,
    legacy: ["security_deposits"],
    apis: ["/api/security-deposits"],
  },
  {
    // The gateways an office may collect through, one leaf each (the
    // registry's `moduleKey`, lib/payments/gateway-registry.ts). Each office
    // connects its own merchant account; the package and the platform switch
    // decide which it may connect. No page or API of its own: checkout and
    // the payment settings ask (lib/payments/gateway-availability.ts).
    key: "capability.payment_gateways",
    title: "platform.modules.capability.paymentGateways",
    label: "Online payment gateways",
    href: "",
    icon: "CreditCard",
    roles: STAFF,
    hidden: true,
    // Stripe and PayPal were never plan-gated, so every package — custom
    // ones too — starts with all five until the Super Admin saves it
    // otherwise; an office keeps the gateway it collects through today.
    legacy: ["*"],
    defaultPlans: ["*"],
    children: (
      [
        ["stripe", "gatewayStripe", "Stripe"],
        ["paypal", "gatewayPaypal", "PayPal"],
        ["moyasar", "gatewayMoyasar", "Moyasar"],
        ["paytabs", "gatewayPaytabs", "PayTabs"],
        ["tap", "gatewayTap", "Tap Payments"],
      ] as const
    ).map(([id, titleKey, label]) => ({
      key: `capability.gateway_${id}`,
      title: `platform.modules.capability.${titleKey}`,
      label,
      href: "",
      icon: "CreditCard" as const,
      roles: STAFF,
      hidden: true,
    })),
  },
];

/**
 * API paths that stay open on every package even though a gated prefix covers
 * them: lookups every screen needs whatever the package holds. The longest
 * match wins, so these beat "/api/roles" and "/api/payments".
 */
export const OPEN_API_PREFIXES: readonly string[] = [
  // Group names, for the role label on every screen's account menu.
  "/api/roles/names",
  // Building, owner and contract names for the filter boxes of reports in
  // several sections, not only Collections.
  "/api/payments/filter-options",
  "/api/reports/filter-options",
];
