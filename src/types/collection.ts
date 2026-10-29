/**
 * PropertyPro - Collection client types
 *
 * Mirrors what `/api/payments/collection` returns. Kept out of the service
 * module so client components do not pull the Prisma client into the browser
 * bundle through a type import.
 */

import type { InstallmentPayment } from "@/types/payment-report";

export type CollectionScope = "by-contract" | "by-tenant";

/** One payment under a contract or tenant, with the installment it paid. */
export interface CollectionPaymentLine extends InstallmentPayment {
  invoiceId: string;
  invoiceNumber: string;
  installmentDueDate: string;
}

export interface CollectionRecord {
  /** Contract id, or tenant id when grouping by tenant. */
  id: string;
  label: string;
  sublabel: string;
  leaseId: string | null;
  contractNumber: string | null;
  tenantId: string;
  tenantName: string;
  /** The tenant's mobile number; "" when none is on file. */
  tenantPhone: string;
  propertyName: string;
  /** One each on a contract's row; every one the tenant rents in on a tenant's. */
  buildings: string[];
  units: string[];
  status: string;
  invoiceCount: number;
  billed: number;
  collected: number;
  outstanding: number;
  overdue: number;
  overdueCount: number;
  collectionRate: number;
  oldestDueDate: string | null;
  currency: string;
  /** The payments behind "collected", oldest first. */
  payments: CollectionPaymentLine[];
}

export interface CollectionSummary {
  recordCount: number;
  invoiceCount: number;
  totalBilled: number;
  totalCollected: number;
  totalOutstanding: number;
  totalOverdue: number;
  collectionRate: number;
  fullyCollected: number;
  withArrears: number;
}

export interface CollectionReport {
  scope: CollectionScope;
  records: CollectionRecord[];
  summary: CollectionSummary;
}
