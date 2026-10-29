/**
 * PropertyPro - Leasing report client types
 *
 * Mirrors what `/api/leases/reports` returns. Kept out of the service module
 * so client components do not pull the Prisma client into the browser bundle
 * through a type import.
 */

import type { PaymentFrequencyKey } from "@/lib/lease-installments";

export type LeaseReportType =
  | "active"
  | "expiring-soon"
  | "expiring"
  | "renewed"
  | "expired"
  | "terminated";

export interface LeaseReportRow {
  leaseId: string;
  contractNumber: string | null;
  tenantName: string;
  tenantEmail: string;
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  startDate: string;
  endDate: string;
  status: string;
  frequency: PaymentFrequencyKey;
  frequencyLabel: string;
  rentAmount: number;
  annualValue: number;
  currency: string;
  taxEnabled: boolean;
  taxRate: number;
  daysRemaining: number;
  terminatedDate: string | null;
  terminationReason: string | null;
  /** End date has passed but the nightly status sweep has not run yet. */
  awaitingStatusSweep: boolean;
  /**
   * Renewed register only: the contract that took over and the day the
   * renewal was made; null when its successor cannot be found.
   */
  renewal: LeaseRenewal | null;
}

export interface LeaseRenewal {
  leaseId: string;
  contractNumber: string | null;
  startDate: string;
  endDate: string;
  status: string;
  /** When the renewal was made — the day the new contract was created. */
  renewedOn: string;
}

export interface LeaseReport {
  rows: LeaseReportRow[];
  summary: {
    contractCount: number;
    tenantCount: number;
    propertyCount: number;
    totalRentPerInstallment: number;
    totalAnnualValue: number;
    withContractNumber: number;
    awaitingStatusSweep: number;
    endingSoon: number;
  };
}
