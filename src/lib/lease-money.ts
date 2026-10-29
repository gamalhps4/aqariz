/**
 * PropertyPro - Lease money accessors
 *
 * Rent and deposit are real Decimal columns on the Lease row (authoritative,
 * backfilled by the lease_money_and_pii_home migration). The `terms` JSON
 * keeps a mirror the write paths maintain for legacy readers; these helpers
 * read the column first and fall back to the mirror only when the column is
 * unset (rows written by paths that predate the columns).
 */

import { DEFAULT_CURRENCY } from "@/lib/regional/region";

interface LeaseMoneySource {
  rentAmount?: unknown;
  securityDepositAmount?: unknown;
  contractAmount?: unknown;
  currency?: unknown;
  terms?: unknown;
}

export function leaseRentAmount(lease: LeaseMoneySource): number {
  const column = Number(lease.rentAmount);
  if (Number.isFinite(column) && column > 0) return column;
  return Number((lease.terms as any)?.rentAmount) || 0;
}

/**
 * The rent for the whole term, for a contract written as one figure
 * ("12,000 for the year"), or null for one priced per installment.
 *
 * The column is nullable and every contract that predates it is null, which
 * keeps its per-installment schedule exactly as it was. Zero is not a price
 * anyone writes on a contract, so it reads as "not set" too.
 */
export function leaseContractAmount(lease: LeaseMoneySource): number | null {
  const value = lease.contractAmount;
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function leaseSecurityDeposit(lease: LeaseMoneySource): number {
  const column = Number(lease.securityDepositAmount);
  if (Number.isFinite(column) && column > 0) return column;
  return Number((lease.terms as any)?.securityDeposit) || 0;
}

export function leaseCurrency(lease: LeaseMoneySource): string {
  return String(lease.currency || DEFAULT_CURRENCY);
}
