/**
 * PropertyPro - Payment report client types
 *
 * Mirrors what `/api/payments/reports` returns for each report type. Kept
 * out of the service module so client components do not pull the Prisma
 * client into the browser bundle through a type import.
 */

export type PaymentReportType =
  | "overdue-tenants"
  | "overdue"
  | "outstanding"
  | "collections"
  | "collections-by-building"
  | "expenses-by-building";

/**
 * Who ended up holding the money: the office, or the owner directly — cash
 * to the owner, a transfer to the owner's account, Ejar. See
 * OWNER_RECEIVED_METHODS in lib/payments/methods.ts.
 */
export type PaymentReceiver = "office" | "owner";

/**
 * What an installment is for — see lib/payments/charge-category. The rent
 * registers list "rent" (with the utilities billed on it) unless asked
 * otherwise, and report the other groups beside it.
 */
export type ChargeGroup = "rent" | "deposit" | "other";
export type ChargeFilter = ChargeGroup | "all";

/** What is owed in one group of charges, under the same filters. */
export interface ChargeGroupTotal {
  group: ChargeGroup;
  invoiceCount: number;
  balance: number;
  overdueBalance: number;
}

/**
 * One payment on an installment. The arrears registers list these under the
 * installment they paid: "each payment should appear separately, with the
 * payment date clearly shown", as the client review puts it.
 */
export interface InstallmentPayment {
  paymentId: string;
  /** The payment number (RCP-000123), which is its receipt number. */
  paymentNumber: string | null;
  /** When the money arrived, not when someone typed it in. */
  paidDate: string;
  /** What this payment put on THIS installment. */
  amount: number;
  /** The stored method code; "unspecified" when none was recorded. */
  method: string;
  /** Transfer or cheque number the office typed, else the gateway's own. */
  reference: string | null;
  /** The employee who recorded it; null when nobody is on record. */
  recordedBy: string | null;
  /** Taken by a payment gateway rather than recorded at the desk. */
  online: boolean;
}

export interface ReceivableRow {
  invoiceId: string;
  invoiceNumber: string;
  contractNumber: string;
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string;
  propertyId: string;
  propertyName: string;
  unitId: string | null;
  unitNumber: string;
  /** The invoice's own category ("rent", "security_deposit"…). */
  category: string;
  chargeGroup: ChargeGroup;
  /** Electricity and water billed on this installment; zero when none. */
  utilitiesAmount: number;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  /** Due or overdue, read against the date the report was asked about. */
  state: "due" | "overdue";
  totalAmount: number;
  amountPaid: number;
  /** The latest payment's own date; null when nothing has been paid. */
  lastPaymentDate: string | null;
  /** The payments on this installment, oldest first. */
  payments: InstallmentPayment[];
  balance: number;
  status: string;
}

export interface AgingBuckets {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
}

export interface ReceivablesReport {
  rows: ReceivableRow[];
  summary: {
    category: ChargeFilter;
    /** Every group under the same filters, the listed one included. */
    byCategory: ChargeGroupTotal[];
    invoiceCount: number;
    tenantCount: number;
    totalBilled: number;
    totalPaid: number;
    totalBalance: number;
    overdueBalance: number;
    aging: AgingBuckets;
  };
}

/** One tenant with rent overdue — see getOverdueTenantsReport. */
export interface OverdueTenantRow {
  tenantId: string;
  tenantName: string;
  tenantPhone: string;
  tenantEmail: string;
  contracts: string[];
  units: string[];
  installmentCount: number;
  totalOverdue: number;
  oldestDueDate: string;
  maxDaysOverdue: number;
  /** The overdue installments behind the totals, oldest first. */
  installments: ReceivableRow[];
}

export interface OverdueTenantsReport {
  rows: OverdueTenantRow[];
  summary: {
    category: ChargeFilter;
    /** Every group's overdue money under the same filters. */
    byCategory: ChargeGroupTotal[];
    tenantCount: number;
    installmentCount: number;
    totalOverdue: number;
    over90: number;
    aging: AgingBuckets;
  };
}

/**
 * A line of the payment report: money received, or a refund — its own line,
 * with the amount negative.
 */
export type PaymentRegisterLineType = "receipt" | "refund";

export interface CollectionRow {
  paymentId: string;
  lineType: PaymentRegisterLineType;
  /** The payment number (RCP-000123), which is its receipt number. */
  paymentNumber: string | null;
  /** When the money arrived — or, on a refund line, when it went back. */
  paidDate: string;
  tenantId: string;
  tenantName: string;
  /** The tenant's mobile number; "" when none is on file. */
  tenantPhone: string;
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  contractNumber: string;
  /** The installment the payment was recorded against, when there is one. */
  invoiceId: string | null;
  invoiceNumber: string;
  installmentDueDate: string | null;
  method: string;
  receiver: PaymentReceiver;
  reference: string | null;
  recordedBy: string | null;
  online: boolean;
  type: string;
  status: string;
  amount: number;
  notes: string | null;
}

/** One group of a payment report breakdown: a method, a month, a building… */
export interface PaymentRegisterGroup {
  /** The method or type code, "office"/"owner", "2026-09", or an id. */
  key: string;
  /** The building's or tenant's name; the key again for codes and months. */
  label: string;
  /** Payments received. */
  count: number;
  received: number;
  /** Refunds, as a positive amount. */
  refunded: number;
  /** Received less refunded. */
  net: number;
}

export interface PaymentRegisterSummary {
  /** Payments received in the period. */
  paymentCount: number;
  refundCount: number;
  totalReceived: number;
  /** Refunds made in the period, as a positive amount. */
  totalRefunded: number;
  /** Received less refunded. */
  totalCollected: number;
  byMethod: PaymentRegisterGroup[];
  /** "office" and "owner" — see OWNER_RECEIVED_METHODS. */
  byReceiver: PaymentRegisterGroup[];
  /** Oldest month first. */
  byMonth: PaymentRegisterGroup[];
  byBuilding: PaymentRegisterGroup[];
  byTenant: PaymentRegisterGroup[];
  /** By kind of payment: rent, deposit, late fee… */
  byType: PaymentRegisterGroup[];
}

export interface CollectionsReport {
  /** The page asked for, newest first. */
  rows: CollectionRow[];
  /** Over every line the filters match, not only this page. */
  summary: PaymentRegisterSummary;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** What GET /api/payments/reports/analytics answers. */
export interface PaymentAnalytics {
  period: { startDate: string; endDate: string; days: number };
  /** Money received in the period, refunds taken off — the payment report's. */
  received: PaymentRegisterSummary;
  /** Installments that fell due in the period, and what has come in on them. */
  due: {
    installmentCount: number;
    billed: number;
    collected: number;
    outstanding: number;
    /** Collected ÷ billed, as a percentage. */
    collectionRate: number;
  };
  /** Owed now, whatever the period. */
  outstanding: { amount: number; count: number };
  /** The part of what is owed now that is already late. */
  overdue: { amount: number; count: number };
}

export interface BuildingCollectionRow {
  propertyId: string;
  propertyName: string;
  city: string;
  paymentCount: number;
  collected: number;
  outstanding: number;
}

export interface BuildingCollectionsReport {
  rows: BuildingCollectionRow[];
  summary: {
    buildingCount: number;
    totalCollected: number;
    totalOutstanding: number;
  };
}

export interface BuildingExpenseRow {
  propertyId: string;
  propertyName: string;
  city: string;
  expenseCount: number;
  total: number;
  topCategory: string;
  byCategory: Array<{ category: string; amount: number }>;
}

export interface BuildingExpensesReport {
  rows: BuildingExpenseRow[];
  summary: {
    buildingCount: number;
    expenseCount: number;
    totalExpenses: number;
    unassignedTotal: number;
    byCategory: Array<{ category: string; amount: number }>;
  };
}

/** Any row the reports page can render. */
export type PaymentReportRow =
  | OverdueTenantRow
  | ReceivableRow
  | CollectionRow
  | BuildingCollectionRow
  | BuildingExpenseRow;

/** Any payload the reports endpoint can return. */
export type PaymentReportData =
  | OverdueTenantsReport
  | ReceivablesReport
  | CollectionsReport
  | BuildingCollectionsReport
  | BuildingExpensesReport;

/**
 * Row identity across every report shape. Collections key on the payment
 * and the line (a refund is a second line of the same payment), receivables
 * on the invoice, the building rollups on the property; the index is the
 * last resort so a key is always produced. Payment first: a collection row
 * also names the installment it paid.
 */
export function paymentReportRowKey(
  row: PaymentReportRow,
  index: number,
): string {
  // A refunded payment is two lines: the money received, and the refund.
  if ("lineType" in row) return `${row.paymentId}:${row.lineType}`;
  if ("installmentCount" in row) return row.tenantId;
  if ("invoiceId" in row) return row.invoiceId;
  if ("propertyId" in row) return row.propertyId;
  return String(index);
}
